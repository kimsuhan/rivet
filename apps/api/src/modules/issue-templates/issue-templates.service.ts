import { HttpStatus, Injectable } from '@nestjs/common';

import { IssuePriority, Prisma, type ProjectRole } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { parseMarkdown } from '../../common/validation/markdown';
import type {
  ApplyIssueTemplateDto,
  ArchiveIssueTemplateDto,
  CreateIssueTemplateDto,
  IssueTemplateListResponseDto,
  IssueTemplateResponseDto,
  IssueTemplateUnavailableReason,
  RestoreIssueTemplateDto,
  UpdateIssueTemplateDto,
} from './dto/issue-template.dto';

const ISSUE_TEMPLATE_SELECT = {
  archivedAt: true,
  descriptionMarkdown: true,
  id: true,
  initialRole: true,
  labels: {
    orderBy: { labelId: 'asc' },
    select: { labelId: true },
  },
  name: true,
  normalizedName: true,
  priority: true,
  projectId: true,
  updatedAt: true,
  version: true,
  workspaceId: true,
} satisfies Prisma.IssueTemplateSelect;

type IssueTemplateRow = Prisma.IssueTemplateGetPayload<{
  select: typeof ISSUE_TEMPLATE_SELECT;
}>;
type TargetReader = Pick<Prisma.TransactionClient, 'label' | 'project' | 'projectRoleTeam'>;
type TemplateTargets = {
  initialRole: ProjectRole | null;
  labelIds: string[];
  projectId: string | null;
};

function resourceNotFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '이슈 템플릿을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function versionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '이슈 템플릿이 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function templateUnavailable(reason: IssueTemplateUnavailableReason): never {
  throw new ApiError({
    code: 'ISSUE_TEMPLATE_UNAVAILABLE',
    details: { unavailableReason: reason },
    message: '더 이상 적용할 수 없는 이슈 템플릿입니다. 입력을 유지한 채 다시 선택해 주세요.',
    status: HttpStatus.CONFLICT,
  });
}

function targetUnavailable(reason: IssueTemplateUnavailableReason): never {
  throw new ApiError({
    code: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
    details: { unavailableReason: reason },
    message: '템플릿의 기본 라벨, 프로젝트 또는 역할을 현재 사용할 수 없습니다.',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

function normalizeName(value: string): { name: string; normalizedName: string } {
  const name = value.normalize('NFC').trim();
  const length = [...name].length;
  if (length < 1 || length > 100) {
    throw new ApiError({
      code: 'VALIDATION_ERROR',
      fieldErrors: { name: ['템플릿 이름은 1~100자로 입력해 주세요.'] },
      message: '템플릿 이름을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }
  return { name, normalizedName: name.toLocaleLowerCase('ko-KR') };
}

function parseDescription(value: string): string {
  const description = parseMarkdown(value, 100_000);
  if (description.fileIds.length > 0) {
    throw new ApiError({
      code: 'MARKDOWN_INVALID',
      message: '이슈 템플릿 설명에는 업로드 파일 이미지를 넣을 수 없습니다.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }
  return description.bodyMarkdown;
}

function stableIds(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toResponse(
  row: IssueTemplateRow,
  unavailableReason: IssueTemplateUnavailableReason | null,
): IssueTemplateResponseDto {
  return {
    archived: row.archivedAt !== null,
    available: unavailableReason === null,
    descriptionMarkdown: row.descriptionMarkdown,
    id: row.id,
    initialRole: row.initialRole,
    labelIds: row.labels.map(({ labelId }) => labelId),
    name: row.name,
    priority: row.priority,
    projectId: row.projectId,
    unavailableReason,
    version: row.version,
  };
}

@Injectable()
export class IssueTemplatesService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    workspaceId: string,
    includeArchived: boolean,
    membershipRole: 'ADMIN' | 'MEMBER',
  ): Promise<IssueTemplateListResponseDto> {
    if (includeArchived && membershipRole !== 'ADMIN') {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '보관된 이슈 템플릿은 관리자만 조회할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    const rows = await this.database.client.issueTemplate.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: ISSUE_TEMPLATE_SELECT,
      where: { ...(includeArchived ? {} : { archivedAt: null }), workspaceId },
    });
    const availability = await this.resolveAvailability(this.database.client, workspaceId, rows);
    return { items: rows.map((row) => toResponse(row, availability.get(row.id) ?? null)) };
  }

  async create(
    workspaceId: string,
    dto: CreateIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    const normalized = normalizeName(dto.name);
    const descriptionMarkdown = parseDescription(dto.descriptionMarkdown);
    const targets: TemplateTargets = {
      initialRole: dto.initialRole ?? null,
      labelIds: stableIds(dto.labelIds ?? []),
      projectId: dto.projectId ?? null,
    };
    this.assertRoleHasProject(targets);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        await this.assertTargetsAvailable(transaction, workspaceId, targets, true);
        const created = await transaction.issueTemplate.create({
          data: {
            descriptionMarkdown,
            initialRole: targets.initialRole,
            ...normalized,
            priority: dto.priority ?? IssuePriority.NONE,
            projectId: targets.projectId,
            workspaceId,
          },
          select: { id: true },
        });
        if (targets.labelIds.length > 0) {
          await transaction.issueTemplateLabel.createMany({
            data: targets.labelIds.map((labelId) => ({
              issueTemplateId: created.id,
              labelId,
              workspaceId,
            })),
          });
        }
        return toResponse(await this.findTemplate(transaction, workspaceId, created.id), null);
      });
    } catch (error) {
      return this.throwNameConflict(error, workspaceId, normalized.normalizedName);
    }
  }

  async update(
    workspaceId: string,
    templateId: string,
    dto: UpdateIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    if (
      dto.name === undefined &&
      dto.descriptionMarkdown === undefined &&
      dto.priority === undefined &&
      dto.labelIds === undefined &&
      dto.projectId === undefined &&
      dto.initialRole === undefined
    ) {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        fieldErrors: { template: ['변경할 템플릿 필드를 하나 이상 입력해 주세요.'] },
        message: '변경할 이슈 템플릿 정보를 입력해 주세요.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }

    const normalized = dto.name === undefined ? undefined : normalizeName(dto.name);
    const description =
      dto.descriptionMarkdown === undefined ? undefined : parseDescription(dto.descriptionMarkdown);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const locked = await this.lockTemplate(transaction, workspaceId, templateId);
        if (locked.version !== dto.version) versionConflict(locked.version);
        if (locked.archivedAt !== null) templateUnavailable('ARCHIVED');
        const current = await this.findTemplate(transaction, workspaceId, templateId);
        const nextTargets: TemplateTargets = {
          initialRole: dto.initialRole === undefined ? current.initialRole : dto.initialRole,
          labelIds:
            dto.labelIds === undefined
              ? current.labels.map(({ labelId }) => labelId)
              : stableIds(dto.labelIds),
          projectId: dto.projectId === undefined ? current.projectId : dto.projectId,
        };
        this.assertRoleHasProject(nextTargets);
        await this.assertTargetsAvailable(transaction, workspaceId, nextTargets, true);

        const nameChanged = normalized !== undefined && normalized.name !== current.name;
        const descriptionChanged =
          description !== undefined && description !== current.descriptionMarkdown;
        const priorityChanged = dto.priority !== undefined && dto.priority !== current.priority;
        const projectChanged = dto.projectId !== undefined && dto.projectId !== current.projectId;
        const roleChanged =
          dto.initialRole !== undefined && dto.initialRole !== current.initialRole;
        const labelsChanged = !sameValues(
          stableIds(current.labels.map(({ labelId }) => labelId)),
          nextTargets.labelIds,
        );
        if (
          !nameChanged &&
          !descriptionChanged &&
          !priorityChanged &&
          !projectChanged &&
          !roleChanged &&
          !labelsChanged
        ) {
          const availability = await this.resolveAvailability(transaction, workspaceId, [current]);
          return toResponse(current, availability.get(current.id) ?? null);
        }

        const [updated] = await transaction.issueTemplate.updateManyAndReturn({
          data: {
            ...(descriptionChanged ? { descriptionMarkdown: description } : {}),
            ...(roleChanged ? { initialRole: dto.initialRole } : {}),
            ...(nameChanged ? normalized : {}),
            ...(priorityChanged ? { priority: dto.priority } : {}),
            ...(projectChanged ? { projectId: dto.projectId } : {}),
            version: { increment: 1 },
          },
          select: { id: true },
          where: { id: templateId, version: dto.version, workspaceId },
        });
        if (!updated) {
          const latest = await transaction.issueTemplate.findFirst({
            select: { version: true },
            where: { id: templateId, workspaceId },
          });
          if (!latest) resourceNotFound();
          versionConflict(latest.version);
        }
        if (labelsChanged) {
          await transaction.issueTemplateLabel.deleteMany({
            where: { issueTemplateId: templateId, workspaceId },
          });
          if (nextTargets.labelIds.length > 0) {
            await transaction.issueTemplateLabel.createMany({
              data: nextTargets.labelIds.map((labelId) => ({
                issueTemplateId: templateId,
                labelId,
                workspaceId,
              })),
            });
          }
        }
        return toResponse(await this.findTemplate(transaction, workspaceId, templateId), null);
      });
    } catch (error) {
      return this.throwNameConflict(error, workspaceId, normalized?.normalizedName);
    }
  }

  async archive(
    workspaceId: string,
    templateId: string,
    dto: ArchiveIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const locked = await this.lockTemplate(transaction, workspaceId, templateId);
      if (locked.version !== dto.version) versionConflict(locked.version);
      const current = await this.findTemplate(transaction, workspaceId, templateId);
      if (current.archivedAt !== null) {
        return toResponse(current, 'ARCHIVED');
      }
      const [archived] = await transaction.issueTemplate.updateManyAndReturn({
        data: { archivedAt: new Date(), version: { increment: 1 } },
        select: { id: true },
        where: { archivedAt: null, id: templateId, version: dto.version, workspaceId },
      });
      if (!archived) {
        const latest = await transaction.issueTemplate.findFirst({
          select: { version: true },
          where: { id: templateId, workspaceId },
        });
        if (!latest) resourceNotFound();
        versionConflict(latest.version);
      }
      return toResponse(await this.findTemplate(transaction, workspaceId, templateId), 'ARCHIVED');
    });
  }

  async restore(
    workspaceId: string,
    templateId: string,
    dto: RestoreIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    let normalizedName: string | undefined;

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const locked = await this.lockTemplate(transaction, workspaceId, templateId);
        if (locked.version !== dto.version) versionConflict(locked.version);
        const current = await this.findTemplate(transaction, workspaceId, templateId);
        normalizedName = current.normalizedName;
        if (current.archivedAt === null) {
          const availability = await this.resolveAvailability(transaction, workspaceId, [current]);
          return toResponse(current, availability.get(current.id) ?? null);
        }
        await this.assertTargetsAvailable(
          transaction,
          workspaceId,
          {
            initialRole: current.initialRole,
            labelIds: current.labels.map(({ labelId }) => labelId),
            projectId: current.projectId,
          },
          true,
        );
        const [restored] = await transaction.issueTemplate.updateManyAndReturn({
          data: { archivedAt: null, version: { increment: 1 } },
          select: { id: true },
          where: {
            archivedAt: { not: null },
            id: templateId,
            version: dto.version,
            workspaceId,
          },
        });
        if (!restored) {
          const latest = await transaction.issueTemplate.findFirst({
            select: { version: true },
            where: { id: templateId, workspaceId },
          });
          if (!latest) resourceNotFound();
          versionConflict(latest.version);
        }
        return toResponse(await this.findTemplate(transaction, workspaceId, templateId), null);
      });
    } catch (error) {
      return this.throwNameConflict(error, workspaceId, normalizedName);
    }
  }

  async apply(
    workspaceId: string,
    templateId: string,
    dto: ApplyIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const row = await this.assertApplicableInTransaction(
        transaction,
        workspaceId,
        templateId,
        dto.version,
      );
      return toResponse(row, null);
    });
  }

  async assertApplicableInTransaction(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    templateId: string,
    version: number,
  ): Promise<IssueTemplateRow> {
    const locked = await this.lockTemplate(transaction, workspaceId, templateId);
    if (locked.version !== version) versionConflict(locked.version);
    if (locked.archivedAt !== null) templateUnavailable('ARCHIVED');
    const row = await this.findTemplate(transaction, workspaceId, templateId);
    await this.assertTargetsAvailable(
      transaction,
      workspaceId,
      {
        initialRole: row.initialRole,
        labelIds: row.labels.map(({ labelId }) => labelId),
        projectId: row.projectId,
      },
      true,
    );
    return row;
  }

  private async lockTemplate(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    templateId: string,
  ): Promise<{ archivedAt: Date | null; version: number }> {
    const rows = await transaction.$queryRaw<Array<{ archivedAt: Date | null; version: number }>>(
      Prisma.sql`
        SELECT "archived_at" AS "archivedAt", "version"
        FROM "issue_templates"
        WHERE "workspace_id" = ${workspaceId}::uuid
          AND "id" = ${templateId}::uuid
        FOR UPDATE
      `,
    );
    if (!rows[0]) resourceNotFound();
    return rows[0];
  }

  private async findTemplate(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    templateId: string,
  ): Promise<IssueTemplateRow> {
    const row = await transaction.issueTemplate.findFirst({
      select: ISSUE_TEMPLATE_SELECT,
      where: { id: templateId, workspaceId },
    });
    if (!row) resourceNotFound();
    return row;
  }

  private assertRoleHasProject(targets: TemplateTargets): void {
    if (targets.initialRole !== null && targets.projectId === null) {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        fieldErrors: { initialRole: ['최초 역할을 선택하려면 기본 프로젝트가 필요합니다.'] },
        message: '템플릿의 기본 프로젝트와 최초 역할을 확인해 주세요.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
  }

  private async assertTargetsAvailable(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    targets: TemplateTargets,
    lockTargets: boolean,
  ): Promise<void> {
    if (targets.labelIds.length > 0) {
      const labels = lockTargets
        ? await transaction.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`
              SELECT "id"
              FROM "labels"
              WHERE "workspace_id" = ${workspaceId}::uuid
                AND "id" IN (${Prisma.join(
                  targets.labelIds.map((labelId) => Prisma.sql`${labelId}::uuid`),
                )})
                AND "archived_at" IS NULL
              ORDER BY "id"
              FOR UPDATE
            `,
          )
        : await transaction.label.findMany({
            select: { id: true },
            where: { archivedAt: null, id: { in: targets.labelIds }, workspaceId },
          });
      if (labels.length !== targets.labelIds.length) targetUnavailable('LABEL_UNAVAILABLE');
    }

    if (targets.projectId === null) return;
    const projects = lockTargets
      ? await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT "id"
            FROM "projects"
            WHERE "workspace_id" = ${workspaceId}::uuid
              AND "id" = ${targets.projectId}::uuid
              AND "archived_at" IS NULL
              AND "deleted_at" IS NULL
            FOR UPDATE
          `,
        )
      : await transaction.project.findMany({
          select: { id: true },
          where: {
            archivedAt: null,
            deletedAt: null,
            id: targets.projectId,
            workspaceId,
          },
        });
    if (projects.length !== 1) targetUnavailable('PROJECT_UNAVAILABLE');
    if (targets.initialRole === null) return;

    if (lockTargets) {
      const roleTeams = await transaction.$queryRaw<Array<{ teamId: string }>>(
        Prisma.sql`
          SELECT role_team."team_id" AS "teamId"
          FROM "project_role_teams" AS role_team
          JOIN "teams" AS team
            ON team."workspace_id" = role_team."workspace_id"
           AND team."id" = role_team."team_id"
          WHERE role_team."workspace_id" = ${workspaceId}::uuid
            AND role_team."project_id" = ${targets.projectId}::uuid
            AND role_team."role"::text = ${targets.initialRole}
            AND team."archived_at" IS NULL
          FOR UPDATE OF role_team, team
        `,
      );
      if (roleTeams.length !== 1) {
        const mapping = await transaction.projectRoleTeam.findFirst({
          select: { teamId: true },
          where: {
            projectId: targets.projectId,
            role: targets.initialRole,
            workspaceId,
          },
        });
        targetUnavailable(mapping ? 'TEAM_UNAVAILABLE' : 'ROLE_UNAVAILABLE');
      }
      return;
    }

    const roleTeam = await transaction.projectRoleTeam.findFirst({
      select: { team: { select: { archivedAt: true } } },
      where: { projectId: targets.projectId, role: targets.initialRole, workspaceId },
    });
    if (!roleTeam) targetUnavailable('ROLE_UNAVAILABLE');
    if (roleTeam.team.archivedAt !== null) targetUnavailable('TEAM_UNAVAILABLE');
  }

  private async resolveAvailability(
    reader: TargetReader,
    workspaceId: string,
    rows: IssueTemplateRow[],
  ): Promise<Map<string, IssueTemplateUnavailableReason | null>> {
    const labelIds = stableIds(rows.flatMap((row) => row.labels.map(({ labelId }) => labelId)));
    const projectIds = stableIds(
      rows.flatMap((row) => (row.projectId === null ? [] : [row.projectId])),
    );
    const [labels, projects, roleTeams] = await Promise.all([
      labelIds.length === 0
        ? []
        : reader.label.findMany({
            select: { archivedAt: true, id: true },
            where: { id: { in: labelIds }, workspaceId },
          }),
      projectIds.length === 0
        ? []
        : reader.project.findMany({
            select: { archivedAt: true, deletedAt: true, id: true },
            where: { id: { in: projectIds }, workspaceId },
          }),
      projectIds.length === 0
        ? []
        : reader.projectRoleTeam.findMany({
            select: {
              projectId: true,
              role: true,
              team: { select: { archivedAt: true } },
            },
            where: { projectId: { in: projectIds }, workspaceId },
          }),
    ]);
    const labelById = new Map(labels.map((label) => [label.id, label]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const roleTeamByKey = new Map(
      roleTeams.map((roleTeam) => [`${roleTeam.projectId}:${roleTeam.role}`, roleTeam]),
    );

    return new Map(
      rows.map((row) => {
        let reason: IssueTemplateUnavailableReason | null = null;
        if (row.archivedAt !== null) {
          reason = 'ARCHIVED';
        } else if (
          row.labels.some(({ labelId }) => {
            const label = labelById.get(labelId);
            return !label || label.archivedAt !== null;
          })
        ) {
          reason = 'LABEL_UNAVAILABLE';
        } else if (row.projectId !== null) {
          const project = projectById.get(row.projectId);
          if (!project || project.archivedAt !== null || project.deletedAt !== null) {
            reason = 'PROJECT_UNAVAILABLE';
          } else if (row.initialRole !== null) {
            const roleTeam = roleTeamByKey.get(`${row.projectId}:${row.initialRole}`);
            if (!roleTeam) reason = 'ROLE_UNAVAILABLE';
            else if (roleTeam.team.archivedAt !== null) reason = 'TEAM_UNAVAILABLE';
          }
        } else if (row.initialRole !== null) {
          reason = 'ROLE_UNAVAILABLE';
        }
        return [row.id, reason];
      }),
    );
  }

  private async throwNameConflict(
    error: unknown,
    workspaceId: string,
    normalizedName: string | undefined,
  ): Promise<never> {
    if (error instanceof ApiError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing =
        normalizedName === undefined
          ? null
          : await this.database.client.issueTemplate.findFirst({
              select: { id: true },
              where: { archivedAt: null, normalizedName, workspaceId },
            });
      if (existing) {
        throw new ApiError({
          code: 'ISSUE_TEMPLATE_NAME_IN_USE',
          message: '이미 사용 중인 이슈 템플릿 이름입니다.',
          status: HttpStatus.CONFLICT,
        });
      }
    }
    throw error;
  }
}
