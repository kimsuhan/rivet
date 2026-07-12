import { HttpStatus, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type {
  ArchiveLabelDto,
  CreateLabelDto,
  LabelListQueryDto,
  LabelListResponseDto,
  LabelResponseDto,
  UpdateLabelDto,
} from './dto/label.dto';

const LABEL_SELECT = {
  archivedAt: true,
  color: true,
  id: true,
  name: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.LabelSelect;

type LabelRow = Prisma.LabelGetPayload<{ select: typeof LABEL_SELECT }>;

function invalidQuery(message: string): never {
  throw new ApiError({ code: 'INVALID_QUERY', message, status: HttpStatus.BAD_REQUEST });
}

function resourceNotFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '라벨을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function versionConflict(currentVersion: number): never {
  throw new ApiError({
    code: 'VERSION_CONFLICT',
    currentVersion,
    message: '라벨이 다른 요청에서 변경되었습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function normalizeName(value: string): { name: string; normalizedName: string } {
  const name = value.normalize('NFC').trim();
  const length = [...name].length;

  if (length < 1 || length > 50) {
    throw new ApiError({
      code: 'VALIDATION_ERROR',
      fieldErrors: { name: ['라벨 이름은 1~50자로 입력해 주세요.'] },
      message: '라벨 이름을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  return { name, normalizedName: name.toLowerCase() };
}

function normalizeColor(value: string): string {
  const color = value.toUpperCase();

  if (!/^#[0-9A-F]{6}$/.test(color)) {
    throw new ApiError({
      code: 'VALIDATION_ERROR',
      fieldErrors: { color: ['라벨 색상은 #RRGGBB 형식이어야 합니다.'] },
      message: '라벨 색상을 확인해 주세요.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  return color;
}

function parseCursor(value: string | undefined): { id: string; updatedAt: Date } | null {
  if (value === undefined) {
    return null;
  }

  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !isUUID(parsed[1], '4')
    ) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    const updatedAt = new Date(parsed[0]);
    if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== parsed[0]) {
      return invalidQuery('커서를 확인해 주세요.');
    }

    return { id: parsed[1], updatedAt };
  } catch {
    return invalidQuery('커서를 확인해 주세요.');
  }
}

function encodeCursor(row: Pick<LabelRow, 'id' | 'updatedAt'>): string {
  return Buffer.from(JSON.stringify([row.updatedAt.toISOString(), row.id])).toString('base64url');
}

function toResponse(label: LabelRow): LabelResponseDto {
  return {
    archived: label.archivedAt !== null,
    color: label.color,
    id: label.id,
    name: label.name,
    version: label.version,
  };
}

@Injectable()
export class LabelsService {
  constructor(private readonly database: DatabaseService) {}

  async list(workspaceId: string, dto: LabelListQueryDto): Promise<LabelListResponseDto> {
    const cursor = parseCursor(dto.cursor);
    const limit = dto.limit ?? 50;
    const query = dto.query?.normalize('NFC').trim();

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidQuery('조회 개수를 확인해 주세요.');
    }
    if (dto.query !== undefined && (!query || [...query].length > 100)) {
      invalidQuery('검색어를 확인해 주세요.');
    }

    const and: Prisma.LabelWhereInput[] = [];
    if (query) {
      and.push({ name: { contains: query, mode: 'insensitive' } });
    }
    if (cursor) {
      and.push({
        OR: [
          { updatedAt: { lt: cursor.updatedAt } },
          { id: { lt: cursor.id }, updatedAt: cursor.updatedAt },
        ],
      });
    }

    const labels = await this.database.client.label.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: LABEL_SELECT,
      take: limit + 1,
      where: {
        ...(dto.archivedOnly
          ? { archivedAt: { not: null } }
          : dto.includeArchived
            ? {}
            : { archivedAt: null }),
        ...(and.length > 0 ? { AND: and } : {}),
        workspaceId,
      },
    });
    const page = labels.slice(0, limit);

    return {
      items: page.map(toResponse),
      nextCursor:
        labels.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  async create(workspaceId: string, dto: CreateLabelDto): Promise<LabelResponseDto> {
    const { name, normalizedName } = normalizeName(dto.name);
    const color = normalizeColor(dto.color);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const label = await transaction.label.create({
          data: { color, name, normalizedName, workspaceId },
          select: LABEL_SELECT,
        });
        await notifyResourceChanged(transaction, {
          changeType: 'CREATED',
          resourceId: label.id,
          resourceType: 'LABEL',
          version: label.version,
          workspaceId,
        });
        return toResponse(label);
      });
    } catch (error) {
      return this.throwNameConflict(error, workspaceId, normalizedName);
    }
  }

  async update(
    workspaceId: string,
    labelId: string,
    dto: UpdateLabelDto,
  ): Promise<LabelResponseDto> {
    if (dto.name === undefined && dto.color === undefined) {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        fieldErrors: { name: ['라벨 이름이나 색상 중 하나를 변경해 주세요.'] },
        message: '변경할 라벨 정보를 입력해 주세요.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }

    const normalized = dto.name === undefined ? undefined : normalizeName(dto.name);
    const color = dto.color === undefined ? undefined : normalizeColor(dto.color);

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const current = await transaction.label.findFirst({
          select: LABEL_SELECT,
          where: { id: labelId, workspaceId },
        });
        if (!current) {
          return resourceNotFound();
        }
        if (current.version !== dto.version) {
          return versionConflict(current.version);
        }

        const changesName = normalized !== undefined && normalized.name !== current.name;
        const changesColor = color !== undefined && color !== current.color;
        if (!changesName && !changesColor) {
          return toResponse(current);
        }

        const [updated] = await transaction.label.updateManyAndReturn({
          data: {
            ...(changesColor ? { color } : {}),
            ...(changesName ? normalized : {}),
            version: { increment: 1 },
          },
          select: LABEL_SELECT,
          where: { id: labelId, version: dto.version, workspaceId },
        });
        if (updated) {
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            resourceId: updated.id,
            resourceType: 'LABEL',
            version: updated.version,
            workspaceId,
          });
          return toResponse(updated);
        }

        const latest = await transaction.label.findFirst({
          select: { version: true },
          where: { id: labelId, workspaceId },
        });
        if (!latest) {
          return resourceNotFound();
        }
        return versionConflict(latest.version);
      });
    } catch (error) {
      return this.throwNameConflict(error, workspaceId, normalized?.normalizedName);
    }
  }

  archive(workspaceId: string, labelId: string, dto: ArchiveLabelDto): Promise<LabelResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const current = await transaction.label.findFirst({
        select: LABEL_SELECT,
        where: { id: labelId, workspaceId },
      });
      if (!current) {
        return resourceNotFound();
      }
      if (current.version !== dto.version) {
        return versionConflict(current.version);
      }
      if (current.archivedAt !== null) {
        return toResponse(current);
      }

      const [archived] = await transaction.label.updateManyAndReturn({
        data: { archivedAt: new Date(), version: { increment: 1 } },
        select: LABEL_SELECT,
        where: { archivedAt: null, id: labelId, version: dto.version, workspaceId },
      });
      if (archived) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: archived.id,
          resourceType: 'LABEL',
          version: archived.version,
          workspaceId,
        });
        return toResponse(archived);
      }

      const latest = await transaction.label.findFirst({
        select: { version: true },
        where: { id: labelId, workspaceId },
      });
      if (!latest) {
        return resourceNotFound();
      }
      return versionConflict(latest.version);
    });
  }

  private async throwNameConflict(
    error: unknown,
    workspaceId: string,
    normalizedName: string | undefined,
  ): Promise<never> {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target;
      const targets = Array.isArray(target)
        ? target.filter((value): value is string => typeof value === 'string')
        : typeof target === 'string'
          ? [target]
          : [];
      const isNameTarget = targets.some(
        (value) =>
          value === 'normalized_name' ||
          value === 'normalizedName' ||
          value.includes('labels_active_normalized_name_key'),
      );
      const existing =
        normalizedName === undefined
          ? null
          : await this.database.client.label.findFirst({
              select: { id: true },
              where: { archivedAt: null, normalizedName, workspaceId },
            });

      if (isNameTarget || existing) {
        throw new ApiError({
          code: 'LABEL_NAME_IN_USE',
          message: '이미 사용 중인 라벨 이름입니다.',
          status: HttpStatus.CONFLICT,
        });
      }
    }

    throw error;
  }
}
