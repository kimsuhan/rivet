import { randomUUID } from 'node:crypto';

import { createPrismaClient, MembershipRole } from '../src';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL 환경 변수가 필요합니다.');

const prisma = createPrismaClient({
  connectionTimeoutMs: 5_000,
  databaseUrl,
  idleTimeoutMs: 10_000,
  poolMax: 2,
});

async function createMembership(): Promise<{
  membershipId: string;
  userId: string;
  workspaceId: string;
}> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  const email = `${userId}@example.test`;
  await prisma.user.create({
    data: {
      displayName: '저장된 보기 테스트',
      email,
      id: userId,
      normalizedEmail: email,
      passwordHash: 'test',
    },
  });
  await prisma.workspace.create({
    data: {
      createdByUserId: userId,
      id: workspaceId,
      name: '저장된 보기 워크스페이스',
      normalizedSlug: `views-${workspaceId}`,
      slug: `views-${workspaceId}`,
    },
  });
  await prisma.workspaceMembership.create({
    data: { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
  });
  return { membershipId, userId, workspaceId };
}

async function cleanup(
  fixtures: Array<{ membershipId: string; userId: string; workspaceId: string }>,
) {
  const membershipIds = fixtures.map((fixture) => fixture.membershipId);
  const workspaceIds = fixtures.map((fixture) => fixture.workspaceId);
  const userIds = fixtures.map((fixture) => fixture.userId);
  await prisma.savedView.deleteMany({
    where: { OR: [{ membershipId: { in: membershipIds } }, { workspaceId: { in: workspaceIds } }] },
  });
  await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe('saved views PostgreSQL integration', () => {
  afterAll(async () => prisma.$disconnect());

  it('persists a personal view while enforcing one default and matching ownership', async () => {
    const first = await createMembership();
    const second = await createMembership();
    try {
      await prisma.savedView.create({
        data: {
          configuration: { query: '긴급', sort: 'updatedAt', sortDirection: 'desc' },
          isDefault: true,
          membershipId: first.membershipId,
          name: '긴급 이슈',
          normalizedName: '긴급 이슈',
          resourceType: 'ISSUES',
          workspaceId: first.workspaceId,
        },
      });
      await expect(
        prisma.savedView.create({
          data: {
            configuration: {},
            isDefault: true,
            membershipId: first.membershipId,
            name: '두 번째 기본',
            normalizedName: '두 번째 기본',
            resourceType: 'ISSUES',
            workspaceId: first.workspaceId,
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.savedView.create({
          data: {
            configuration: {},
            membershipId: first.membershipId,
            name: '다른 워크스페이스',
            normalizedName: '다른 워크스페이스',
            resourceType: 'ISSUES',
            workspaceId: second.workspaceId,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await cleanup([first, second]);
    }
  });
});
