import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { ObservabilityService } from '../../common/observability/observability.service';
import { productEvent } from '../../common/observability/product-event';
import type {
  CreateSavedViewDto,
  SavedViewConfigurationValue,
  SavedViewResponseDto,
  UpdateSavedViewDto,
} from './dto/saved-view.dto';

type SavedViewContext = { membershipId: string; workspaceId: string };
type ResourceType = 'ISSUES' | 'MY_WORK';

const ISSUE_STATUSES = new Set([
  'UNSORTED',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'PAUSED',
  'CANCELED',
]);
const ISSUE_PRIORITIES = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const STATE_CATEGORIES = new Set(['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED']);
const ISSUE_SORTS = new Set(['updatedAt', 'createdAt', 'priority', 'status', 'progress']);
const MY_WORK_SORTS = new Set(['executionOrder', 'priority', 'createdAt', 'updatedAt', 'status']);
const SORT_DIRECTIONS = new Set(['asc', 'desc']);
const MAX_ISSUE_SORTS = 3;
const ISSUE_VISIBLE_FIELDS = [
  'project',
  'labels',
  'status',
  'priority',
  'teamWorkCount',
  'progress',
  'createdBy',
  'createdAt',
  'updatedAt',
] as const;
const MY_WORK_VISIBLE_FIELDS = [
  'project',
  'team',
  'labels',
  'status',
  'priority',
  'createdAt',
  'updatedAt',
] as const;
const ISSUE_GROUP_FIELDS = new Set([
  'assigneeMembershipId',
  'projectId',
  'status',
  'priority',
  'createdByMembershipId',
]);
const MY_WORK_GROUP_FIELDS = new Set([
  'projectId',
  'teamId',
  'stateCategory',
  'workflowStateId',
  'priority',
]);

type NormalizedConfiguration = Record<string, SavedViewConfigurationValue>;

function notFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '저장된 보기를 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function conflict(code: string, message: string, currentVersion?: number): never {
  throw new ApiError({
    code,
    ...(currentVersion ? { currentVersion } : {}),
    message,
    status: HttpStatus.CONFLICT,
  });
}

function invalidConfiguration(message: string): never {
  throw new ApiError({
    code: 'SAVED_VIEW_CONFIGURATION_INVALID',
    message,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

function normalizeName(value: string): { name: string; normalizedName: string } {
  const name = value.normalize('NFC').trim();
  return { name, normalizedName: name.toLocaleLowerCase('ko-KR') };
}

function normalizeCsv(
  value: unknown,
  message: string,
  valid: (candidate: string) => boolean,
): string {
  if (typeof value !== 'string') invalidConfiguration(message);
  const candidates = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (candidates.length === 0 || candidates.some((candidate) => !valid(candidate))) {
    invalidConfiguration(message);
  }
  return candidates.sort().join(',');
}

function normalizeVisibleFields(value: unknown, resourceType: ResourceType): string[] {
  const allowed = new Set(
    resourceType === 'ISSUES' ? ISSUE_VISIBLE_FIELDS : MY_WORK_VISIBLE_FIELDS,
  );
  if (
    !Array.isArray(value) ||
    value.some((field) => typeof field !== 'string' || !allowed.has(field as never))
  ) {
    invalidConfiguration('표시 필드 구성을 저장할 수 없습니다.');
  }
  const selected = new Set(value as string[]);
  return [...allowed].filter((field) => selected.has(field));
}

function normalizeConfiguration(
  resourceType: ResourceType,
  value: Record<string, unknown>,
): NormalizedConfiguration {
  const allowed =
    resourceType === 'ISSUES'
      ? new Set([
          'query',
          'projectId',
          'status',
          'priority',
          'labelId',
          'createdByMembershipId',
          'assigneeMembershipId',
          'unassigned',
          'sort',
          'sortDirection',
          'sorts',
          'density',
          'visibleFields',
          'groupBy',
          'subGroupBy',
        ])
      : new Set([
          'query',
          'projectId',
          'teamId',
          'workflowStateId',
          'stateCategory',
          'priority',
          'sort',
          'sortDirection',
          'density',
          'visibleFields',
          'groupBy',
          'subGroupBy',
        ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalidConfiguration('지원하지 않는 보기 설정이 포함되어 있습니다.');
  }

  const configuration: NormalizedConfiguration = {};
  if (value.query !== undefined) {
    if (typeof value.query !== 'string' || value.query.normalize('NFC').trim().length > 200) {
      invalidConfiguration('검색어 형식이 올바르지 않습니다.');
    }
    const query = value.query.normalize('NFC').trim();
    if (query) configuration.query = query;
  }
  if (value.projectId !== undefined) {
    configuration.projectId = normalizeCsv(
      value.projectId,
      '프로젝트 필터 형식이 올바르지 않습니다.',
      (candidate) => isUUID(candidate, '4'),
    ).toLowerCase();
  }
  if (value.status !== undefined) {
    if (resourceType !== 'ISSUES') {
      invalidConfiguration('이슈 상태 필터를 저장할 수 없습니다.');
    }
    configuration.status = normalizeCsv(
      value.status,
      '이슈 상태 필터를 저장할 수 없습니다.',
      (candidate) => ISSUE_STATUSES.has(candidate),
    );
  }
  if (value.stateCategory !== undefined) {
    if (resourceType !== 'MY_WORK') {
      invalidConfiguration('작업 상태 필터를 저장할 수 없습니다.');
    }
    configuration.stateCategory = normalizeCsv(
      value.stateCategory,
      '작업 상태 필터를 저장할 수 없습니다.',
      (candidate) => STATE_CATEGORIES.has(candidate),
    );
  }
  if (value.priority !== undefined) {
    configuration.priority = normalizeCsv(
      value.priority,
      '우선순위 필터를 저장할 수 없습니다.',
      (candidate) => ISSUE_PRIORITIES.has(candidate),
    );
  }
  for (const key of [
    'labelId',
    'createdByMembershipId',
    'assigneeMembershipId',
    'teamId',
    'workflowStateId',
  ] as const) {
    if (value[key] === undefined) continue;
    configuration[key] = normalizeCsv(value[key], 'ID 필터를 저장할 수 없습니다.', (candidate) =>
      isUUID(candidate, '4'),
    ).toLowerCase();
  }
  if (value.unassigned !== undefined) {
    if (resourceType !== 'ISSUES' || value.unassigned !== 'true') {
      invalidConfiguration('담당자 없음 필터를 저장할 수 없습니다.');
    }
    configuration.unassigned = 'true';
  }
  if (resourceType === 'ISSUES') {
    if (
      value.sorts !== undefined &&
      (value.sort !== undefined || value.sortDirection !== undefined)
    ) {
      invalidConfiguration('다중 정렬과 기존 단일 정렬 조건을 함께 저장할 수 없습니다.');
    }
    if (value.sorts !== undefined) {
      if (
        !Array.isArray(value.sorts) ||
        value.sorts.length < 1 ||
        value.sorts.length > MAX_ISSUE_SORTS
      ) {
        invalidConfiguration(`정렬 조건은 1개 이상 ${MAX_ISSUE_SORTS}개 이하여야 합니다.`);
      }
      const fields = new Set<string>();
      const sorts = value.sorts.map((sort) => {
        if (
          typeof sort !== 'object' ||
          sort === null ||
          Array.isArray(sort) ||
          Object.keys(sort).some((key) => key !== 'field' && key !== 'direction') ||
          !('field' in sort) ||
          typeof sort.field !== 'string' ||
          !ISSUE_SORTS.has(sort.field) ||
          !('direction' in sort) ||
          typeof sort.direction !== 'string' ||
          !SORT_DIRECTIONS.has(sort.direction) ||
          fields.has(sort.field)
        ) {
          invalidConfiguration('정렬 조건을 저장할 수 없습니다.');
        }
        fields.add(sort.field);
        return {
          direction: sort.direction as 'asc' | 'desc',
          field: sort.field,
        };
      });
      configuration.sorts = sorts;
    } else if (value.sort !== undefined || value.sortDirection !== undefined) {
      const field = value.sort ?? 'updatedAt';
      const direction = value.sortDirection ?? 'desc';
      if (
        typeof field !== 'string' ||
        !ISSUE_SORTS.has(field) ||
        typeof direction !== 'string' ||
        !SORT_DIRECTIONS.has(direction)
      ) {
        invalidConfiguration('정렬 조건을 저장할 수 없습니다.');
      }
      configuration.sorts = [{ direction: direction as 'asc' | 'desc', field }];
    }
  } else {
    if (value.sort !== undefined) {
      if (typeof value.sort !== 'string' || !MY_WORK_SORTS.has(value.sort))
        invalidConfiguration('정렬 기준을 저장할 수 없습니다.');
      configuration.sort = value.sort;
    }
    if (value.sortDirection !== undefined) {
      if (value.sortDirection !== 'asc' && value.sortDirection !== 'desc')
        invalidConfiguration('정렬 방향을 저장할 수 없습니다.');
      configuration.sortDirection = value.sortDirection;
    }
  }
  if (value.density !== undefined) {
    if (value.density !== 'comfortable' && value.density !== 'compact')
      invalidConfiguration('표시 옵션을 저장할 수 없습니다.');
    configuration.density = value.density;
  }
  if (value.visibleFields !== undefined) {
    configuration.visibleFields = normalizeVisibleFields(value.visibleFields, resourceType);
  }
  const groupFields = resourceType === 'ISSUES' ? ISSUE_GROUP_FIELDS : MY_WORK_GROUP_FIELDS;
  if (value.groupBy !== undefined) {
    if (typeof value.groupBy !== 'string' || !groupFields.has(value.groupBy)) {
      invalidConfiguration('메인 그룹 구성을 저장할 수 없습니다.');
    }
    configuration.groupBy = value.groupBy;
  }
  if (value.subGroupBy !== undefined) {
    if (
      typeof value.subGroupBy !== 'string' ||
      !groupFields.has(value.subGroupBy) ||
      configuration.groupBy === undefined ||
      configuration.groupBy === value.subGroupBy
    ) {
      invalidConfiguration('서브 그룹 구성을 저장할 수 없습니다.');
    }
    configuration.subGroupBy = value.subGroupBy;
  }
  return configuration;
}

@Injectable()
export class SavedViewsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly observability: ObservabilityService,
  ) {}

  async list(
    context: SavedViewContext,
    resourceType: ResourceType,
  ): Promise<SavedViewResponseDto[]> {
    const rows = await this.database.client.savedView.findMany({
      where: { membershipId: context.membershipId, resourceType, workspaceId: context.workspaceId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.response(row));
  }

  async get(context: SavedViewContext, id: string): Promise<SavedViewResponseDto> {
    const row = await this.find(context, id);
    return this.response(row);
  }

  async create(context: SavedViewContext, dto: CreateSavedViewDto): Promise<SavedViewResponseDto> {
    const { name, normalizedName } = normalizeName(dto.name);
    const configuration = normalizeConfiguration(dto.resourceType, dto.configuration);
    try {
      const response = await this.database.client.$transaction(async (transaction) => {
        const row = await transaction.savedView.create({
          data: {
            configuration: configuration as Prisma.InputJsonValue,
            membershipId: context.membershipId,
            name,
            normalizedName,
            resourceType: dto.resourceType,
            workspaceId: context.workspaceId,
          },
        });
        if (!dto.isDefault) return this.response(row);
        return this.setDefaultInTransaction(transaction, context, row.id, row.version);
      });
      this.observability.capture(
        productEvent(
          context,
          'saved_view_created',
          { resourceType: response.resourceType },
          { eventId: response.id, occurredAt: response.createdAt },
        ),
      );
      return response;
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async update(
    context: SavedViewContext,
    id: string,
    dto: UpdateSavedViewDto,
  ): Promise<SavedViewResponseDto> {
    const current = await this.find(context, id);
    if (current.version !== dto.version)
      conflict(
        'SAVED_VIEW_VERSION_CONFLICT',
        '다른 변경이 있어 최신 보기를 다시 불러와야 합니다.',
        current.version,
      );
    const normalized = dto.name === undefined ? undefined : normalizeName(dto.name);
    const configuration =
      dto.configuration === undefined
        ? undefined
        : normalizeConfiguration(current.resourceType, dto.configuration);
    try {
      const result = await this.database.client.savedView.updateMany({
        where: {
          id,
          membershipId: context.membershipId,
          version: dto.version,
          workspaceId: context.workspaceId,
        },
        data: {
          ...(normalized ? normalized : {}),
          ...(configuration ? { configuration: configuration as Prisma.InputJsonValue } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) {
        const latest = await this.find(context, id);
        conflict(
          'SAVED_VIEW_VERSION_CONFLICT',
          '다른 변경이 있어 최신 보기를 다시 불러와야 합니다.',
          latest.version,
        );
      }
      return this.get(context, id);
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async remove(context: SavedViewContext, id: string, version: number): Promise<void> {
    const current = await this.find(context, id);
    if (current.version !== version)
      conflict(
        'SAVED_VIEW_VERSION_CONFLICT',
        '다른 변경이 있어 삭제하지 않았습니다.',
        current.version,
      );
    const result = await this.database.client.savedView.deleteMany({
      where: { id, membershipId: context.membershipId, version, workspaceId: context.workspaceId },
    });
    if (result.count === 0) {
      const latest = await this.find(context, id);
      conflict(
        'SAVED_VIEW_VERSION_CONFLICT',
        '다른 변경이 있어 삭제하지 않았습니다.',
        latest.version,
      );
    }
  }

  async setDefault(
    context: SavedViewContext,
    id: string,
    version: number,
  ): Promise<SavedViewResponseDto> {
    try {
      return await this.database.client.$transaction((transaction) =>
        this.setDefaultInTransaction(transaction, context, id, version),
      );
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  private async setDefaultInTransaction(
    transaction: Prisma.TransactionClient,
    context: SavedViewContext,
    id: string,
    version: number,
  ): Promise<SavedViewResponseDto> {
    const current = await transaction.savedView.findFirst({
      where: { id, membershipId: context.membershipId, workspaceId: context.workspaceId },
    });
    if (!current) notFound();
    if (current.version !== version)
      conflict(
        'SAVED_VIEW_VERSION_CONFLICT',
        '다른 변경이 있어 기본 보기로 지정하지 않았습니다.',
        current.version,
      );
    await transaction.savedView.updateMany({
      where: {
        isDefault: true,
        membershipId: context.membershipId,
        resourceType: current.resourceType,
        workspaceId: context.workspaceId,
      },
      data: { isDefault: false },
    });
    const row = await transaction.savedView.update({
      where: { id },
      data: { isDefault: true, version: { increment: 1 } },
    });
    return this.response(row);
  }

  private async find(context: SavedViewContext, id: string) {
    const row = await this.database.client.savedView.findFirst({
      where: { id, membershipId: context.membershipId, workspaceId: context.workspaceId },
    });
    if (!row) notFound();
    return row;
  }

  private response(row: {
    configuration: Prisma.JsonValue;
    createdAt: Date;
    id: string;
    isDefault: boolean;
    name: string;
    resourceType: ResourceType;
    updatedAt: Date;
    version: number;
  }): SavedViewResponseDto {
    return {
      configuration: normalizeConfiguration(
        row.resourceType,
        row.configuration as Record<string, unknown>,
      ),
      createdAt: row.createdAt,
      id: row.id,
      isDefault: row.isDefault,
      name: row.name,
      resourceType: row.resourceType,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  }

  private handleWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target.join(',')
        : String(error.meta?.target ?? '');
      const constraint = `${target} ${error.message}`;
      if (/normalized[_ -]?name/i.test(constraint))
        conflict('SAVED_VIEW_NAME_IN_USE', '같은 이름의 저장된 보기가 이미 있습니다.');
      conflict(
        'SAVED_VIEW_DEFAULT_CONFLICT',
        '기본 보기가 동시에 변경되었습니다. 최신 목록을 다시 확인해 주세요.',
      );
    }
    throw error;
  }
}
