import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  IssuePriority,
  IssueStatus,
  MembershipRole,
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

describe('M9 issue and team-work database integration', () => {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const backendTeamId = randomUUID();
  const webTeamId = randomUUID();
  const backendStateId = randomUUID();
  const webStateId = randomUUID();
  const projectId = randomUUID();
  const backendProjectTeamId = randomUUID();
  const webProjectTeamId = randomUUID();

  beforeAll(async () => {
    const email = `${userId}@example.test`;
    await prisma.user.create({
      data: {
        displayName: 'M9 관리자',
        email,
        id: userId,
        normalizedEmail: email,
        passwordHash: '$argon2id$m9-test',
      },
    });
    await prisma.workspace.create({
      data: {
        createdByUserId: userId,
        id: workspaceId,
        name: 'M9 워크스페이스',
        normalizedSlug: `m9-${workspaceId}`,
        slug: `m9-${workspaceId}`,
      },
    });
    await prisma.workspaceMembership.create({
      data: { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
    });
    await prisma.team.createMany({
      data: [
        { id: backendTeamId, key: 'API', name: '백엔드', normalizedName: '백엔드', workspaceId },
        { id: webTeamId, key: 'WEB', name: '웹', normalizedName: '웹', workspaceId },
      ],
    });
    await prisma.teamMember.createMany({
      data: [
        { membershipId, teamId: backendTeamId, workspaceId },
        { membershipId, teamId: webTeamId, workspaceId },
      ],
    });
    await prisma.workflowState.createMany({
      data: [
        {
          category: StateCategory.UNSTARTED,
          id: backendStateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: backendTeamId,
          workspaceId,
        },
        {
          category: StateCategory.UNSTARTED,
          id: webStateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: webTeamId,
          workspaceId,
        },
      ],
    });
    await prisma.project.create({
      data: { id: projectId, leadMembershipId: membershipId, name: 'M9 프로젝트', workspaceId },
    });
    await prisma.projectTeam.createMany({
      data: [
        { id: backendProjectTeamId, projectId, teamId: backendTeamId, workspaceId },
        { id: webProjectTeamId, projectId, teamId: webTeamId, workspaceId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.apiHandoffTarget.deleteMany({ where: { workspaceId } });
    await prisma.apiHandoff.deleteMany({ where: { workspaceId } });
    await prisma.activityEvent.deleteMany({ where: { workspaceId } });
    await prisma.comment.deleteMany({ where: { workspaceId } });
    await prisma.teamWork.deleteMany({ where: { workspaceId } });
    await prisma.issue.deleteMany({ where: { workspaceId } });
    await prisma.projectTeam.deleteMany({ where: { workspaceId } });
    await prisma.project.deleteMany({ where: { workspaceId } });
    await prisma.workflowState.deleteMany({ where: { workspaceId } });
    await prisma.teamMember.deleteMany({ where: { workspaceId } });
    await prisma.team.deleteMany({ where: { workspaceId } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('keeps issue content singular and links execution, handoff, comments, and activity by teamWorkId', async () => {
    const issue = await prisma.issue.create({
      data: {
        createdByMembershipId: membershipId,
        descriptionMarkdown: '# 공통 설명',
        identifier: 'F-9001',
        priority: IssuePriority.HIGH,
        projectId,
        sequenceNumber: 9001,
        status: IssueStatus.TODO,
        title: '통합 이슈',
        workspaceId,
      },
    });
    const backend = await prisma.teamWork.create({
      data: {
        assigneeMembershipId: membershipId,
        createdByMembershipId: membershipId,
        identifier: 'API-9001',
        issueId: issue.id,
        projectTeamId: backendProjectTeamId,
        sequenceNumber: 9001,
        teamId: backendTeamId,
        workflowStateId: backendStateId,
        workspaceId,
      },
    });
    const web = await prisma.teamWork.create({
      data: {
        createdByMembershipId: membershipId,
        identifier: 'WEB-9001',
        issueId: issue.id,
        projectTeamId: webProjectTeamId,
        workNoteMarkdown: '응답 타입 연결',
        sequenceNumber: 9001,
        teamId: webTeamId,
        workflowStateId: webStateId,
        workspaceId,
      },
    });
    const handoff = await prisma.apiHandoff.create({
      data: {
        authorMembershipId: membershipId,
        bodyMarkdown: '## 전달',
        issueId: issue.id,
        kind: 'INITIAL',
        sequenceNumber: 1,
        sourceTeamWorkId: backend.id,
        workspaceId,
      },
    });
    await prisma.apiHandoffTarget.create({
      data: { handoffId: handoff.id, teamWorkId: web.id, workspaceId },
    });
    await prisma.comment.create({
      data: {
        authorMembershipId: membershipId,
        bodyMarkdown: '공통 댓글',
        issueId: issue.id,
        teamWorkId: web.id,
        workspaceId,
      },
    });
    await prisma.activityEvent.create({
      data: {
        actorMembershipId: membershipId,
        eventType: 'TEAM_WORK_CHANGED',
        issueId: issue.id,
        teamWorkId: web.id,
        workspaceId,
      },
    });

    const stored = await prisma.issue.findUniqueOrThrow({
      include: { comments: true, handoffs: { include: { targets: true } }, teamWorks: true },
      where: { id: issue.id },
    });
    expect(stored).toMatchObject({
      descriptionMarkdown: '# 공통 설명',
      identifier: 'F-9001',
      title: '통합 이슈',
    });
    expect(stored.teamWorks).toHaveLength(2);
    expect(stored.teamWorks.find(({ id }) => id === web.id)).toMatchObject({
      workNoteMarkdown: '응답 타입 연결',
    });
    expect(stored.handoffs[0]).toMatchObject({
      sourceTeamWorkId: backend.id,
      targets: [{ teamWorkId: web.id }],
    });
    expect(stored.comments[0]).toMatchObject({ issueId: issue.id, teamWorkId: web.id });
  });
});
