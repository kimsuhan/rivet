import { randomUUID } from 'node:crypto';

import { createPrismaClient, IssueType, MembershipRole, StateCategory } from '../src';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL 환경 변수가 필요합니다.');

const prisma = createPrismaClient({
  connectionTimeoutMs: 5_000,
  databaseUrl,
  idleTimeoutMs: 10_000,
  poolMax: 2,
});

describe('M7 trash constraints', () => {
  const workspaceIds = [randomUUID(), randomUUID()];
  const userIds = [randomUUID(), randomUUID()];
  const membershipIds = [randomUUID(), randomUUID()];
  const teamId = randomUUID();
  const stateId = randomUUID();
  const issueId = randomUUID();
  const projectId = randomUUID();

  beforeAll(async () => {
    for (let index = 0; index < 2; index += 1) {
      const workspaceId = workspaceIds[index]!;
      const userId = userIds[index]!;
      const membershipId = membershipIds[index]!;
      const email = `m7-trash-${userId}@example.test`;
      await prisma.user.create({
        data: {
          displayName: `M7 사용자 ${index}`,
          email,
          id: userId,
          normalizedEmail: email,
          passwordHash: '$argon2id$m7-test-fixture',
        },
      });
      await prisma.workspace.create({
        data: {
          createdByUserId: userId,
          id: workspaceId,
          name: `M7 워크스페이스 ${index}`,
          normalizedSlug: `m7-trash-${workspaceId}`,
          slug: `m7-trash-${workspaceId}`,
        },
      });
      await prisma.workspaceMembership.create({
        data: { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
      });
    }

    await prisma.team.create({
      data: {
        id: teamId,
        key: 'MVT',
        name: 'M7 팀',
        normalizedName: 'm7 팀',
        workspaceId: workspaceIds[0]!,
      },
    });
    await prisma.teamMember.create({
      data: { membershipId: membershipIds[0]!, teamId, workspaceId: workspaceIds[0]! },
    });
    await prisma.workflowState.create({
      data: {
        category: StateCategory.UNSTARTED,
        id: stateId,
        isDefault: true,
        name: '할 일',
        normalizedName: '할 일',
        position: 0,
        teamId,
        workspaceId: workspaceIds[0]!,
      },
    });
    await prisma.issue.create({
      data: {
        createdByMembershipId: membershipIds[0]!,
        id: issueId,
        identifier: 'MVT-1',
        sequenceNumber: 1,
        teamId,
        title: '휴지통 제약 작업',
        type: IssueType.TEAM_TASK,
        workflowStateId: stateId,
        workspaceId: workspaceIds[0]!,
      },
    });
    await prisma.project.create({
      data: { id: projectId, name: '휴지통 제약 프로젝트', workspaceId: workspaceIds[0]! },
    });
  });

  afterAll(async () => {
    await prisma.issue.deleteMany({ where: { id: issueId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.workflowState.deleteMany({ where: { id: stateId } });
    await prisma.teamMember.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('requires all issue trash fields and an exact 30-day purge time', async () => {
    const deletedAt = new Date('2026-07-11T00:00:00.000Z');
    await expect(
      prisma.issue.update({ data: { deletedAt }, where: { id: issueId } }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.update({
        data: {
          deletedAt,
          deletedByMembershipId: membershipIds[0]!,
          purgeAt: new Date('2026-08-09T00:00:00.000Z'),
        },
        where: { id: issueId },
      }),
    ).rejects.toThrow();

    const issue = await prisma.issue.update({
      data: {
        deletedAt,
        deletedByMembershipId: membershipIds[0]!,
        purgeAt: new Date('2026-08-10T00:00:00.000Z'),
      },
      where: { id: issueId },
    });
    expect(issue.deletedAt).toEqual(deletedAt);
  });

  it('rejects a deleter membership from another workspace', async () => {
    await prisma.issue.update({
      data: { deletedAt: null, deletedByMembershipId: null, purgeAt: null },
      where: { id: issueId },
    });
    await expect(
      prisma.issue.update({
        data: {
          deletedAt: new Date('2026-07-11T00:00:00.000Z'),
          deletedByMembershipId: membershipIds[1]!,
          purgeAt: new Date('2026-08-10T00:00:00.000Z'),
        },
        where: { id: issueId },
      }),
    ).rejects.toThrow();
  });

  it('applies the same exact scheduling constraint to projects', async () => {
    await expect(
      prisma.project.update({
        data: {
          deletedAt: new Date('2026-07-11T00:00:00.000Z'),
          deletedByMembershipId: membershipIds[0]!,
          purgeAt: new Date('2026-08-10T00:00:00.001Z'),
        },
        where: { id: projectId },
      }),
    ).rejects.toThrow();
  });
});
