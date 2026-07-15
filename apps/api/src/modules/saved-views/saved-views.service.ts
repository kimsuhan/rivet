import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import type {
  CreateSavedViewDto,
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
const STATE_CATEGORIES = new Set(['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED']);
const ISSUE_SORTS = new Set(['updatedAt', 'createdAt', 'priority']);
const MY_WORK_SORTS = new Set(['executionOrder', 'priority', 'createdAt', 'updatedAt', 'status']);

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

function normalizeConfiguration(
  resourceType: ResourceType,
  value: Record<string, unknown>,
): Record<string, string | boolean> {
  const allowed =
    resourceType === 'ISSUES'
      ? new Set(['query', 'projectId', 'status', 'sort', 'sortDirection', 'density'])
      : new Set(['query', 'projectId', 'stateCategory', 'sort', 'sortDirection', 'density']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalidConfiguration('지원하지 않는 보기 설정이 포함되어 있습니다.');
  }

  const configuration: Record<string, string | boolean> = {};
  if (value.query !== undefined) {
    if (typeof value.query !== 'string' || value.query.normalize('NFC').trim().length > 200) {
      invalidConfiguration('검색어 형식이 올바르지 않습니다.');
    }
    const query = value.query.normalize('NFC').trim();
    if (query) configuration.query = query;
  }
  if (value.projectId !== undefined) {
    if (typeof value.projectId !== 'string' || !isUUID(value.projectId, '4')) {
      invalidConfiguration('프로젝트 필터 형식이 올바르지 않습니다.');
    }
    configuration.projectId = value.projectId.toLowerCase();
  }
  if (value.status !== undefined) {
    if (
      resourceType !== 'ISSUES' ||
      typeof value.status !== 'string' ||
      !ISSUE_STATUSES.has(value.status)
    ) {
      invalidConfiguration('이슈 상태 필터를 저장할 수 없습니다.');
    }
    configuration.status = value.status;
  }
  if (value.stateCategory !== undefined) {
    if (resourceType !== 'MY_WORK' || typeof value.stateCategory !== 'string') {
      invalidConfiguration('작업 상태 필터를 저장할 수 없습니다.');
    }
    const categories = [
      ...new Set(value.stateCategory.split(',').filter((item) => STATE_CATEGORIES.has(item))),
    ].sort();
    if (
      categories.length === 0 ||
      categories.join(',') !== value.stateCategory.split(',').filter(Boolean).sort().join(',')
    ) {
      invalidConfiguration('작업 상태 필터를 저장할 수 없습니다.');
    }
    configuration.stateCategory = categories.join(',');
  }
  if (value.sort !== undefined) {
    const sorts = resourceType === 'ISSUES' ? ISSUE_SORTS : MY_WORK_SORTS;
    if (typeof value.sort !== 'string' || !sorts.has(value.sort))
      invalidConfiguration('정렬 기준을 저장할 수 없습니다.');
    configuration.sort = value.sort;
  }
  if (value.sortDirection !== undefined) {
    if (value.sortDirection !== 'asc' && value.sortDirection !== 'desc')
      invalidConfiguration('정렬 방향을 저장할 수 없습니다.');
    configuration.sortDirection = value.sortDirection;
  }
  if (value.density !== undefined) {
    if (value.density !== 'comfortable' && value.density !== 'compact')
      invalidConfiguration('표시 옵션을 저장할 수 없습니다.');
    configuration.density = value.density;
  }
  return configuration;
}

@Injectable()
export class SavedViewsService {
  constructor(private readonly database: DatabaseService) {}

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
      return await this.database.client.$transaction(async (transaction) => {
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
      configuration: row.configuration as Record<string, string | boolean>,
      createdAt: row.createdAt,
      id: row.id,
      isDefault: row.isDefault,
      name: row.name,
      resourceType: row.resourceType,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  }

  private handleWriteError(
    error: unknown,
  ): never {
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
