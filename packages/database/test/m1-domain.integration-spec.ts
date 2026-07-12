import { randomBytes, randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  EmailTemplateType,
  MembershipRole,
  StateCategory,
  TokenPurpose,
} from '../src';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

const prisma = createPrismaClient({
  connectionTimeoutMs: 5_000,
  databaseUrl,
  idleTimeoutMs: 10_000,
  poolMax: 2,
});

let userIds: string[] = [];
let workspaceIds: string[] = [];
let outboxEventIds: string[] = [];
let rateLimitBucketIds: string[] = [];

async function createUser(): Promise<string> {
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  userIds.push(userId);
  await prisma.user.create({
    data: {
      displayName: '테스트 사용자',
      email,
      id: userId,
      normalizedEmail: email,
      passwordHash: '$argon2id$test-fixture',
    },
  });

  return userId;
}

async function createWorkspaceMembership(
  userId: string,
): Promise<{ membershipId: string; workspaceId: string }> {
  const membershipId = randomUUID();
  const workspaceId = randomUUID();
  workspaceIds.push(workspaceId);

  await prisma.$transaction(async (transaction) => {
    await transaction.workspace.create({
      data: {
        createdByUserId: userId,
        id: workspaceId,
        name: '테스트 워크스페이스',
        normalizedSlug: `w-${workspaceId}`,
        slug: `w-${workspaceId}`,
      },
    });
    await transaction.workspaceMembership.create({
      data: {
        id: membershipId,
        role: MembershipRole.ADMIN,
        userId,
        workspaceId,
      },
    });
  });

  return { membershipId, workspaceId };
}

describe('M1 domain database integration', () => {
  beforeEach(() => {
    userIds = [];
    workspaceIds = [];
    outboxEventIds = [];
    rateLimitBucketIds = [];
  });

  afterEach(async () => {
    await prisma.emailDelivery.deleteMany({
      where: { outboxEventId: { in: outboxEventIds } },
    });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
    await prisma.workflowState.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspaceMembership.deleteMany({
      where: { OR: [{ workspaceId: { in: workspaceIds } }, { userId: { in: userIds } }] },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.oneTimeToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.authRateLimitBucket.deleteMany({
      where: { id: { in: rateLimitBucketIds } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the workspace and default team onboarding graphs in atomic transactions', async () => {
    const userId = await createUser();
    const { membershipId, workspaceId } = await createWorkspaceMembership(userId);
    const teamId = randomUUID();

    await prisma.$transaction(async (transaction) => {
      await transaction.team.create({
        data: {
          id: teamId,
          key: 'WEB',
          name: '프론트 웹',
          normalizedName: '프론트 웹',
          workspaceId,
        },
      });
      await transaction.teamMember.create({
        data: { membershipId, teamId, workspaceId },
      });
      await transaction.workflowState.createMany({
        data: [
          {
            category: StateCategory.BACKLOG,
            isDefault: true,
            name: '미분류',
            normalizedName: '미분류',
            position: 0,
            teamId,
            workspaceId,
          },
          {
            category: StateCategory.UNSTARTED,
            name: '할 일',
            normalizedName: '할 일',
            position: 1,
            teamId,
            workspaceId,
          },
          {
            category: StateCategory.STARTED,
            name: '진행 중',
            normalizedName: '진행 중',
            position: 2,
            teamId,
            workspaceId,
          },
          {
            category: StateCategory.STARTED,
            name: '검토',
            normalizedName: '검토',
            position: 3,
            teamId,
            workspaceId,
          },
          {
            category: StateCategory.COMPLETED,
            name: '완료',
            normalizedName: '완료',
            position: 4,
            teamId,
            workspaceId,
          },
          {
            category: StateCategory.BACKLOG,
            name: '보류',
            normalizedName: '보류',
            position: 5,
            teamId,
            workspaceId,
          },
          {
            category: StateCategory.CANCELED,
            name: '취소',
            normalizedName: '취소',
            position: 6,
            teamId,
            workspaceId,
          },
        ],
      });
    });

    const team = await prisma.team.findUniqueOrThrow({
      include: {
        teamMembers: true,
        workflowStates: { orderBy: { position: 'asc' } },
      },
      where: { id: teamId },
    });

    expect(team.teamMembers).toEqual([expect.objectContaining({ membershipId, workspaceId })]);
    expect(
      team.workflowStates.map(({ category, isDefault, name, position }) => ({
        category,
        isDefault,
        name,
        position,
      })),
    ).toEqual([
      { category: 'BACKLOG', isDefault: true, name: '미분류', position: 0 },
      { category: 'UNSTARTED', isDefault: false, name: '할 일', position: 1 },
      { category: 'STARTED', isDefault: false, name: '진행 중', position: 2 },
      { category: 'STARTED', isDefault: false, name: '검토', position: 3 },
      { category: 'COMPLETED', isDefault: false, name: '완료', position: 4 },
      { category: 'BACKLOG', isDefault: false, name: '보류', position: 5 },
      { category: 'CANCELED', isDefault: false, name: '취소', position: 6 },
    ]);
  });

  it('allows only one concurrent workspace membership for an account', async () => {
    const userId = await createUser();
    const candidates = [randomUUID(), randomUUID()];
    workspaceIds.push(...candidates);

    const results = await Promise.allSettled(
      candidates.map((workspaceId) =>
        prisma.$transaction(async (transaction) => {
          await transaction.workspace.create({
            data: {
              createdByUserId: userId,
              id: workspaceId,
              name: '동시 생성 워크스페이스',
              normalizedSlug: `w-${workspaceId}`,
              slug: `w-${workspaceId}`,
            },
          });
          await transaction.workspaceMembership.create({
            data: {
              role: MembershipRole.ADMIN,
              userId,
              workspaceId,
            },
          });
        }),
      ),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(prisma.workspaceMembership.count({ where: { userId } })).resolves.toBe(1);
    await expect(prisma.workspace.count({ where: { id: { in: candidates } } })).resolves.toBe(1);
  });

  it('enforces workspace-scoped team and outbox relationships', async () => {
    const firstUserId = await createUser();
    const secondUserId = await createUser();
    const first = await createWorkspaceMembership(firstUserId);
    const second = await createWorkspaceMembership(secondUserId);
    const teamId = randomUUID();

    await prisma.team.create({
      data: {
        id: teamId,
        key: 'API',
        name: '백엔드',
        normalizedName: '백엔드',
        workspaceId: first.workspaceId,
      },
    });

    await expect(
      prisma.teamMember.create({
        data: {
          membershipId: second.membershipId,
          teamId,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await prisma.workflowState.create({
      data: {
        category: StateCategory.BACKLOG,
        isDefault: true,
        name: '미분류',
        normalizedName: '미분류',
        position: 0,
        teamId,
        workspaceId: first.workspaceId,
      },
    });
    await expect(
      prisma.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 1,
          teamId,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.team.create({
        data: {
          key: 'WEB',
          name: '백엔드',
          normalizedName: '백엔드',
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await prisma.team.update({ data: { archivedAt: new Date() }, where: { id: teamId } });
    await expect(
      prisma.team.create({
        data: {
          key: 'WEB',
          name: '백엔드',
          normalizedName: '백엔드',
          workspaceId: first.workspaceId,
        },
      }),
    ).resolves.toBeDefined();

    const outboxEventId = randomUUID();
    outboxEventIds.push(outboxEventId);
    await expect(
      prisma.outboxEvent.create({
        data: {
          actorMembershipId: second.membershipId,
          aggregateId: randomUUID(),
          aggregateType: 'WORKSPACE',
          eventType: 'M1_TEST_WORKSPACE_EVENT',
          id: outboxEventId,
          payload: { schemaVersion: 1 },
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('protects session, one-time token, and rate-limit security data', async () => {
    const userId = await createUser();
    const firstTokenId = randomUUID();

    await prisma.oneTimeToken.create({
      data: {
        expiresAt: new Date(Date.now() + 60_000),
        id: firstTokenId,
        purpose: TokenPurpose.EMAIL_VERIFICATION,
        tokenHash: randomBytes(32),
        userId,
      },
    });
    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          purpose: TokenPurpose.EMAIL_VERIFICATION,
          tokenHash: randomBytes(32),
          userId,
        },
      }),
    ).rejects.toThrow();
    await prisma.oneTimeToken.update({
      data: { revokedAt: new Date() },
      where: { id: firstTokenId },
    });
    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          purpose: TokenPurpose.EMAIL_VERIFICATION,
          tokenHash: randomBytes(32),
          userId,
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt: new Date(Date.now() + 60_000),
          purpose: TokenPurpose.PASSWORD_RESET,
          tokenHash: randomBytes(31),
          userId,
        },
      }),
    ).rejects.toThrow();

    const now = new Date();
    await expect(
      prisma.session.create({
        data: {
          absoluteExpiresAt: new Date(now.getTime() + 60_000),
          idleExpiresAt: new Date(now.getTime() + 120_000),
          lastSeenAt: now,
          tokenHash: randomBytes(32),
          userId,
        },
      }),
    ).rejects.toThrow();

    const rateLimitBucketId = randomUUID();
    rateLimitBucketIds.push(rateLimitBucketId);
    await expect(
      prisma.authRateLimitBucket.create({
        data: {
          attemptCount: -1,
          expiresAt: new Date(now.getTime() + 60_000),
          id: rateLimitBucketId,
          keyHash: randomBytes(32),
          scope: 'LOGIN_ACCOUNT',
          windowStartedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it('keeps one email delivery result series per account outbox event', async () => {
    const userId = await createUser();
    const outboxEventId = randomUUID();
    outboxEventIds.push(outboxEventId);

    await prisma.outboxEvent.create({
      data: {
        aggregateId: userId,
        aggregateType: 'USER',
        eventType: 'AUTH_EMAIL_VERIFICATION_REQUESTED',
        id: outboxEventId,
        payload: { schemaVersion: 1, tokenId: randomUUID(), userId },
      },
    });
    await prisma.emailDelivery.create({
      data: {
        outboxEventId,
        recipientEmail: `${userId}@example.test`,
        templateType: EmailTemplateType.EMAIL_VERIFICATION,
      },
    });
    await expect(
      prisma.emailDelivery.create({
        data: {
          outboxEventId,
          recipientEmail: `${userId}@example.test`,
          templateType: EmailTemplateType.EMAIL_VERIFICATION,
        },
      }),
    ).rejects.toThrow();
  });
});
