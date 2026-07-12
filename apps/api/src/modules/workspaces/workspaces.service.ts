import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { MembershipRole, MembershipStatus, Prisma } from '@rivet/database';
import {
  WORKSPACE_CREATED,
  WORKSPACE_CREATED_SCHEMA_VERSION,
  type WorkspaceCreatedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import type { CreateWorkspaceDto } from './dto/create-workspace.dto';
import type { WorkspaceResponseDto } from './dto/workspace-response.dto';

function uniqueTargets(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target = error.meta?.target;

  if (typeof target === 'string') {
    return [target];
  }

  return Array.isArray(target)
    ? target.filter((value): value is string => typeof value === 'string')
    : [];
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly database: DatabaseService) {}

  async getCurrent(workspaceId: string | null): Promise<WorkspaceResponseDto> {
    const workspace = workspaceId
      ? await this.database.client.workspace.findFirst({
          select: { id: true, name: true, slug: true, version: true },
          where: { id: workspaceId },
        })
      : null;

    if (!workspace) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: '현재 워크스페이스를 찾을 수 없습니다.',
        status: HttpStatus.NOT_FOUND,
      });
    }

    return workspace;
  }

  async create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceResponseDto> {
    const name = dto.name.trim();
    const slug = dto.slug.trim().toLowerCase();

    try {
      return await this.database.client.$transaction(async (transaction) => {
        const users = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "users"
          WHERE "id" = ${userId}::uuid
          FOR UPDATE
        `;

        if (!users[0]) {
          throw new ApiError({
            code: 'RESOURCE_NOT_FOUND',
            message: '요청한 사용자를 찾을 수 없습니다.',
            status: HttpStatus.NOT_FOUND,
          });
        }

        const membership = await transaction.workspaceMembership.findUnique({
          select: { id: true },
          where: { userId },
        });

        if (membership) {
          throw new ApiError({
            code: 'WORKSPACE_LIMIT_REACHED',
            message: '이미 참여 중인 워크스페이스가 있습니다.',
            status: HttpStatus.CONFLICT,
          });
        }

        const workspace = await transaction.workspace.create({
          data: {
            createdByUserId: userId,
            name,
            normalizedSlug: slug,
            slug,
          },
          select: { id: true, name: true, slug: true, version: true },
        });
        const createdMembership = await transaction.workspaceMembership.create({
          data: {
            role: MembershipRole.ADMIN,
            status: MembershipStatus.ACTIVE,
            userId,
            workspaceId: workspace.id,
          },
          select: { id: true },
        });
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId: createdMembership.id,
            aggregateId: workspace.id,
            aggregateType: 'WORKSPACE',
            eventType: WORKSPACE_CREATED,
            id: randomUUID(),
            payload: {
              acquisitionSource: 'direct',
              schemaVersion: WORKSPACE_CREATED_SCHEMA_VERSION,
            } satisfies WorkspaceCreatedOutboxPayload,
            workspaceId: workspace.id,
          },
        });

        return workspace;
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const targets = uniqueTargets(error);

      if (
        targets.some(
          (target) =>
            target === 'user_id' ||
            target === 'userId' ||
            target.includes('workspace_memberships_user_id_key'),
        )
      ) {
        throw new ApiError({
          code: 'WORKSPACE_LIMIT_REACHED',
          message: '이미 참여 중인 워크스페이스가 있습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      if (
        targets.some(
          (target) =>
            target === 'normalized_slug' ||
            target === 'normalizedSlug' ||
            target.includes('workspaces_normalized_slug_key'),
        )
      ) {
        throw new ApiError({
          code: 'WORKSPACE_SLUG_IN_USE',
          message: '이미 사용 중인 워크스페이스 슬러그입니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      const membership = await this.database.client.workspaceMembership.findUnique({
        select: { id: true },
        where: { userId },
      });
      if (membership) {
        throw new ApiError({
          code: 'WORKSPACE_LIMIT_REACHED',
          message: '이미 참여 중인 워크스페이스가 있습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      const workspace = await this.database.client.workspace.findUnique({
        select: { id: true },
        where: { normalizedSlug: slug },
      });
      if (workspace) {
        throw new ApiError({
          code: 'WORKSPACE_SLUG_IN_USE',
          message: '이미 사용 중인 워크스페이스 슬러그입니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      throw error;
    }
  }
}
