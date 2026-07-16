import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { createSessionToken, hashSessionToken } from './auth-token';

export type AuthSessionContext = {
  sessionId: string;
  user: {
    avatarFileId: string | null;
    id: string;
    displayName: string;
    email: string;
    emailVerifiedAt: Date | null;
  };
  membership: {
    id: string;
    role: 'ADMIN' | 'MEMBER';
    status: 'ACTIVE' | 'INACTIVE';
    workspaceId: string;
  } | null;
  workspace: {
    id: string;
    name: string;
    slug: string;
    version: number;
  } | null;
};

@Injectable()
export class AuthSessionService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string): Promise<{
    absoluteExpiresAt: Date;
    context: AuthSessionContext;
    token: string;
  }> {
    const sessionId = randomUUID();
    const { token, tokenHash } = createSessionToken();
    const rows = await this.database.client.$queryRaw<Array<{ absoluteExpiresAt: Date }>>`
      INSERT INTO "sessions" (
        "id",
        "user_id",
        "token_hash",
        "last_seen_at",
        "idle_expires_at",
        "absolute_expires_at"
      )
      VALUES (
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${tokenHash},
        NOW(),
        NOW() + INTERVAL '7 days',
        NOW() + INTERVAL '30 days'
      )
      RETURNING "absolute_expires_at" AS "absoluteExpiresAt"
    `;
    const context = await this.resolve(token);

    if (!rows[0] || !context) {
      throw new Error('생성한 세션을 확인할 수 없습니다.');
    }

    return { absoluteExpiresAt: rows[0].absoluteExpiresAt, context, token };
  }

  async resolve(token: string): Promise<AuthSessionContext | null> {
    const tokenHash = hashSessionToken(token);
    const rows = await this.database.client.$queryRaw<
      Array<{
        avatarFileId: string | null;
        displayName: string;
        email: string;
        emailVerifiedAt: Date | null;
        membershipId: string | null;
        membershipRole: 'ADMIN' | 'MEMBER' | null;
        membershipStatus: 'ACTIVE' | 'INACTIVE' | null;
        sessionId: string;
        userId: string;
        workspaceId: string | null;
        workspaceName: string | null;
        workspaceSlug: string | null;
        workspaceVersion: number | null;
      }>
    >`
      SELECT session."id" AS "sessionId",
             account."id" AS "userId",
             account."avatar_file_id" AS "avatarFileId",
             account."display_name" AS "displayName",
             account."email",
             account."email_verified_at" AS "emailVerifiedAt",
             membership."id" AS "membershipId",
             membership."role" AS "membershipRole",
             membership."status" AS "membershipStatus",
             workspace."id" AS "workspaceId",
             workspace."name" AS "workspaceName",
             workspace."slug" AS "workspaceSlug",
             workspace."version" AS "workspaceVersion"
      FROM "sessions" AS session
      JOIN "users" AS account ON account."id" = session."user_id"
      LEFT JOIN "workspace_memberships" AS membership ON membership."user_id" = account."id"
      LEFT JOIN "workspaces" AS workspace ON workspace."id" = membership."workspace_id"
      WHERE session."token_hash" = ${tokenHash}
        AND session."revoked_at" IS NULL
        AND session."idle_expires_at" > NOW()
        AND session."absolute_expires_at" > NOW()
      LIMIT 1
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    await this.database.client.$executeRaw`
      UPDATE "sessions"
      SET "last_seen_at" = NOW(),
          "idle_expires_at" = LEAST(NOW() + INTERVAL '7 days', "absolute_expires_at")
      WHERE "id" = ${row.sessionId}::uuid
        AND "last_seen_at" <= NOW() - INTERVAL '5 minutes'
        AND "revoked_at" IS NULL
    `;

    const membership =
      row.membershipId !== null &&
      row.membershipRole !== null &&
      row.membershipStatus !== null &&
      row.workspaceId !== null
        ? {
            id: row.membershipId,
            role: row.membershipRole,
            status: row.membershipStatus,
            workspaceId: row.workspaceId,
          }
        : null;
    const workspace =
      membership &&
      row.workspaceId !== null &&
      row.workspaceName !== null &&
      row.workspaceSlug !== null &&
      row.workspaceVersion !== null
        ? {
            id: row.workspaceId,
            name: row.workspaceName,
            slug: row.workspaceSlug,
            version: row.workspaceVersion,
          }
        : null;

    if ((membership === null) !== (workspace === null)) {
      throw new Error('세션의 워크스페이스 컨텍스트가 올바르지 않습니다.');
    }

    return {
      membership,
      sessionId: row.sessionId,
      user: {
        avatarFileId: row.avatarFileId,
        displayName: row.displayName,
        email: row.email,
        emailVerifiedAt: row.emailVerifiedAt,
        id: row.userId,
      },
      workspace,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.webPushSubscription.updateMany({
        data: {
          auth: null,
          disabledAt: new Date(),
          endpoint: null,
          p256dh: null,
          status: 'INACTIVE',
        },
        where: { sessionId, status: 'ACTIVE' },
      });
      await transaction.$executeRaw`
        UPDATE "sessions"
        SET "revoked_at" = COALESCE("revoked_at", NOW())
        WHERE "id" = ${sessionId}::uuid
      `;
    });
  }
}
