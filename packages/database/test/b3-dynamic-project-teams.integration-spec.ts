import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  IssuePriority,
  IssueStatus,
  MembershipRole,
  ProjectRole,
  StateCategory,
} from '../src';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL 환경 변수가 필요합니다.');

const prisma = createPrismaClient({
  connectionTimeoutMs: 5_000,
  databaseUrl,
  idleTimeoutMs: 10_000,
  poolMax: 2,
});

describe('B3 dynamic project teams database integration', () => {
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const membershipId = randomUUID();
  const otherMembershipId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const planningTeamId = randomUUID();
  const designTeamId = randomUUID();
  const otherTeamId = randomUUID();
  const planningStateId = randomUUID();
  const designStateId = randomUUID();
  const otherStateId = randomUUID();
  const issueId = randomUUID();

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          displayName: 'B3 관리자',
          email: `${userId}@example.test`,
          id: userId,
          normalizedEmail: `${userId}@example.test`,
          passwordHash: '$argon2id$b3-test',
        },
        {
          displayName: 'B3 다른 관리자',
          email: `${otherUserId}@example.test`,
          id: otherUserId,
          normalizedEmail: `${otherUserId}@example.test`,
          passwordHash: '$argon2id$b3-test',
        },
      ],
    });
    await prisma.workspace.createMany({
      data: [
        {
          createdByUserId: userId,
          id: workspaceId,
          name: 'B3 워크스페이스',
          normalizedSlug: `b3-${workspaceId}`,
          slug: `b3-${workspaceId}`,
        },
        {
          createdByUserId: otherUserId,
          id: otherWorkspaceId,
          name: 'B3 다른 워크스페이스',
          normalizedSlug: `b3-${otherWorkspaceId}`,
          slug: `b3-${otherWorkspaceId}`,
        },
      ],
    });
    await prisma.workspaceMembership.createMany({
      data: [
        { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
        {
          id: otherMembershipId,
          role: MembershipRole.ADMIN,
          userId: otherUserId,
          workspaceId: otherWorkspaceId,
        },
      ],
    });
    await prisma.team.createMany({
      data: [
        {
          id: planningTeamId,
          key: 'PLAN',
          name: '기획',
          normalizedName: '기획',
          workspaceId,
        },
        {
          id: designTeamId,
          key: 'DSGN',
          name: '디자인',
          normalizedName: '디자인',
          workspaceId,
        },
        {
          id: otherTeamId,
          key: 'OTHER',
          name: '다른 팀',
          normalizedName: '다른 팀',
          workspaceId: otherWorkspaceId,
        },
      ],
    });
    await prisma.teamMember.createMany({
      data: [
        { membershipId, teamId: planningTeamId, workspaceId },
        { membershipId, teamId: designTeamId, workspaceId },
        { membershipId: otherMembershipId, teamId: otherTeamId, workspaceId: otherWorkspaceId },
      ],
    });
    await prisma.workflowState.createMany({
      data: [
        {
          category: StateCategory.UNSTARTED,
          id: planningStateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: planningTeamId,
          workspaceId,
        },
        {
          category: StateCategory.UNSTARTED,
          id: designStateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: designTeamId,
          workspaceId,
        },
        {
          category: StateCategory.UNSTARTED,
          id: otherStateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: otherTeamId,
          workspaceId: otherWorkspaceId,
        },
      ],
    });
    await prisma.project.createMany({
      data: [
        { id: projectId, leadMembershipId: membershipId, name: 'B3 프로젝트', workspaceId },
        {
          id: otherProjectId,
          leadMembershipId: otherMembershipId,
          name: 'B3 다른 프로젝트',
          workspaceId: otherWorkspaceId,
        },
      ],
    });
    await prisma.issue.create({
      data: {
        createdByMembershipId: membershipId,
        id: issueId,
        identifier: 'B3-1',
        priority: IssuePriority.NONE,
        projectId,
        sequenceNumber: 1,
        status: IssueStatus.TODO,
        title: '동적 참여 팀 검증',
        workspaceId,
      },
    });
  });

  afterAll(async () => {
    await prisma.apiHandoffTarget.deleteMany({ where: { workspaceId } });
    await prisma.apiHandoff.deleteMany({ where: { workspaceId } });
    await prisma.issueTemplate.deleteMany({ where: { workspaceId } });
    await prisma.teamWork.deleteMany({ where: { workspaceId } });
    await prisma.issue.deleteMany({ where: { workspaceId } });
    await prisma.projectRoleTeam.deleteMany({ where: { workspaceId } });
    await prisma.projectTeam.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.workflowState.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.teamMember.deleteMany({
      where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [planningTeamId, designTeamId, otherTeamId] } },
    });
    await prisma.workspaceMembership.deleteMany({
      where: { id: { in: [membershipId, otherMembershipId] } },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it('merges multiple legacy roles for one team and links legacy TeamWork to one participant', async () => {
    await prisma.projectRoleTeam.createMany({
      data: [
        { projectId, role: ProjectRole.BACKEND, teamId: planningTeamId, workspaceId },
        { projectId, role: ProjectRole.WEB_FRONTEND, teamId: planningTeamId, workspaceId },
      ],
    });

    const participants = await prisma.projectTeam.findMany({
      where: { projectId, teamId: planningTeamId },
    });
    expect(participants).toHaveLength(1);

    const work = await prisma.teamWork.create({
      data: {
        assigneeMembershipId: membershipId,
        createdByMembershipId: membershipId,
        identifier: 'PLAN-1',
        issueId,
        projectRole: ProjectRole.BACKEND,
        sequenceNumber: 1,
        teamId: planningTeamId,
        workflowStateId: planningStateId,
        workspaceId,
      },
    });
    expect(work.projectTeamId).toBe(participants[0]!.id);
  });

  it('accepts non-enum teams and preserves template and handoff history through ProjectTeam', async () => {
    const designParticipant = await prisma.projectTeam.create({
      data: { projectId, teamId: designTeamId, workspaceId },
    });
    const designWork = await prisma.teamWork.create({
      data: {
        createdByMembershipId: membershipId,
        identifier: 'DESIGN-1',
        issueId,
        projectTeamId: designParticipant.id,
        sequenceNumber: 1,
        teamId: designTeamId,
        workflowStateId: designStateId,
        workspaceId,
      },
    });
    const planningWork = await prisma.teamWork.findFirstOrThrow({
      where: { identifier: 'PLAN-1', workspaceId },
    });
    const handoff = await prisma.apiHandoff.create({
      data: {
        authorMembershipId: membershipId,
        bodyMarkdown: '디자인 검토 요청',
        issueId,
        kind: 'INITIAL',
        sequenceNumber: 1,
        sourceTeamWorkId: planningWork.id,
        workspaceId,
      },
    });
    await prisma.apiHandoffTarget.create({
      data: { handoffId: handoff.id, teamWorkId: designWork.id, workspaceId },
    });
    const template = await prisma.issueTemplate.create({
      data: {
        descriptionMarkdown: '디자인 기본 작업',
        initialProjectTeamId: designParticipant.id,
        name: '디자인 요청',
        normalizedName: '디자인 요청',
        projectId,
        workspaceId,
      },
    });

    await prisma.projectTeam.update({
      data: { deactivatedAt: new Date(), isActive: false },
      where: { id: designParticipant.id },
    });
    expect(await prisma.teamWork.findUniqueOrThrow({ where: { id: designWork.id } })).toMatchObject(
      { projectTeamId: designParticipant.id, teamId: designTeamId },
    );
    expect(
      await prisma.issueTemplate.findUniqueOrThrow({ where: { id: template.id } }),
    ).toMatchObject({
      initialProjectTeamId: designParticipant.id,
    });
    expect(await prisma.apiHandoffTarget.count({ where: { handoffId: handoff.id } })).toBe(1);
  });

  it('rejects cross-project, cross-workspace, assignee-team, and workflow-team mismatches', async () => {
    const planningParticipant = await prisma.projectTeam.findFirstOrThrow({
      where: { projectId, teamId: planningTeamId },
    });
    await expect(
      prisma.teamWork.create({
        data: {
          createdByMembershipId: membershipId,
          identifier: 'INVALID-WORKFLOW-1',
          issueId,
          projectTeamId: planningParticipant.id,
          sequenceNumber: 99,
          teamId: planningTeamId,
          workflowStateId: designStateId,
          workspaceId,
        },
      }),
    ).rejects.toThrow(/workflow/i);
    await expect(
      prisma.teamWork.create({
        data: {
          assigneeMembershipId: otherMembershipId,
          createdByMembershipId: membershipId,
          identifier: 'INVALID-ASSIGNEE-1',
          issueId,
          projectTeamId: planningParticipant.id,
          sequenceNumber: 100,
          teamId: planningTeamId,
          workflowStateId: planningStateId,
          workspaceId,
        },
      }),
    ).rejects.toThrow(/assignee/i);
    await expect(
      prisma.issueTemplate.create({
        data: {
          descriptionMarkdown: '잘못된 프로젝트 연결',
          initialProjectTeamId: planningParticipant.id,
          name: '다른 프로젝트 템플릿',
          normalizedName: '다른 프로젝트 템플릿',
          projectId: otherProjectId,
          workspaceId: otherWorkspaceId,
        },
      }),
    ).rejects.toThrow();
  });
});
