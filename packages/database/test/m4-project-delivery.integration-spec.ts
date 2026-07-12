import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  FeatureIssueStatus,
  HandoffKind,
  IssueType,
  MembershipRole,
  NotificationType,
  ProjectRole,
  StateCategory,
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

type WorkspaceFixture = {
  adminMembershipId: string;
  adminUserId: string;
  backendStateId: string;
  backendTeamId: string;
  memberMembershipId: string;
  memberUserId: string;
  projectId: string;
  secondProjectId: string;
  webStateId: string;
  webTeamId: string;
  workspaceId: string;
};

let issueSequence = 1;
let userIds: string[] = [];
let workspaceIds: string[] = [];

async function createUser(displayName: string): Promise<string> {
  const id = randomUUID();
  const email = `${id}@example.test`;
  userIds.push(id);
  await prisma.user.create({
    data: {
      displayName,
      email,
      id,
      normalizedEmail: email,
      passwordHash: '$argon2id$m4-test-fixture',
    },
  });
  return id;
}

async function createWorkspaceFixture(): Promise<WorkspaceFixture> {
  const adminUserId = await createUser('M4 관리자');
  const memberUserId = await createUser('M4 멤버');
  const adminMembershipId = randomUUID();
  const memberMembershipId = randomUUID();
  const workspaceId = randomUUID();
  const backendTeamId = randomUUID();
  const webTeamId = randomUUID();
  const backendStateId = randomUUID();
  const webStateId = randomUUID();
  const projectId = randomUUID();
  const secondProjectId = randomUUID();
  workspaceIds.push(workspaceId);

  await prisma.$transaction(async (transaction) => {
    await transaction.workspace.create({
      data: {
        createdByUserId: adminUserId,
        id: workspaceId,
        name: 'M4 워크스페이스',
        normalizedSlug: `m4-${workspaceId}`,
        slug: `m4-${workspaceId}`,
      },
    });
    await transaction.workspaceMembership.createMany({
      data: [
        {
          id: adminMembershipId,
          role: MembershipRole.ADMIN,
          userId: adminUserId,
          workspaceId,
        },
        {
          id: memberMembershipId,
          role: MembershipRole.MEMBER,
          userId: memberUserId,
          workspaceId,
        },
      ],
    });
    await transaction.team.createMany({
      data: [
        {
          id: backendTeamId,
          key: 'API',
          name: '백엔드 팀',
          normalizedName: '백엔드 팀',
          workspaceId,
        },
        {
          id: webTeamId,
          key: 'WEB',
          name: '웹 팀',
          normalizedName: '웹 팀',
          workspaceId,
        },
      ],
    });
    await transaction.teamMember.createMany({
      data: [backendTeamId, webTeamId].flatMap((teamId) => [
        { membershipId: adminMembershipId, teamId, workspaceId },
        { membershipId: memberMembershipId, teamId, workspaceId },
      ]),
    });
    await transaction.workflowState.createMany({
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
    await transaction.project.createMany({
      data: [
        {
          id: projectId,
          leadMembershipId: adminMembershipId,
          name: '첫 번째 프로젝트',
          workspaceId,
        },
        {
          id: secondProjectId,
          name: '두 번째 프로젝트',
          workspaceId,
        },
      ],
    });
    await transaction.projectRoleTeam.createMany({
      data: [
        { projectId, role: ProjectRole.BACKEND, teamId: backendTeamId, workspaceId },
        { projectId, role: ProjectRole.WEB_FRONTEND, teamId: webTeamId, workspaceId },
        {
          projectId: secondProjectId,
          role: ProjectRole.BACKEND,
          teamId: backendTeamId,
          workspaceId,
        },
      ],
    });
  });

  return {
    adminMembershipId,
    adminUserId,
    backendStateId,
    backendTeamId,
    memberMembershipId,
    memberUserId,
    projectId,
    secondProjectId,
    webStateId,
    webTeamId,
    workspaceId,
  };
}

function nextIssueSequence(): number {
  return issueSequence++;
}

function createStandaloneTask(fixture: WorkspaceFixture) {
  const sequenceNumber = nextIssueSequence();
  return prisma.issue.create({
    data: {
      createdByMembershipId: fixture.adminMembershipId,
      identifier: `API-${sequenceNumber}`,
      sequenceNumber,
      teamId: fixture.backendTeamId,
      title: '독립 팀 작업',
      type: IssueType.TEAM_TASK,
      workflowStateId: fixture.backendStateId,
      workspaceId: fixture.workspaceId,
    },
  });
}

function createFeature(fixture: WorkspaceFixture, projectId = fixture.projectId) {
  const sequenceNumber = nextIssueSequence();
  return prisma.issue.create({
    data: {
      createdByMembershipId: fixture.adminMembershipId,
      featureStatus: FeatureIssueStatus.TODO,
      identifier: `F-${sequenceNumber}`,
      projectId,
      sequenceNumber,
      title: '기능 이슈',
      type: IssueType.FEATURE,
      workspaceId: fixture.workspaceId,
    },
  });
}

function createProjectTask(
  fixture: WorkspaceFixture,
  options: {
    parentIssueId?: string;
    projectId?: string;
    projectRole?: ProjectRole;
    stateId?: string;
    teamId?: string;
  } = {},
) {
  const sequenceNumber = nextIssueSequence();
  const teamId = options.teamId ?? fixture.backendTeamId;
  return prisma.issue.create({
    data: {
      createdByMembershipId: fixture.adminMembershipId,
      identifier: `${teamId === fixture.webTeamId ? 'WEB' : 'API'}-${sequenceNumber}`,
      parentIssueId: options.parentIssueId ?? null,
      projectId: options.projectId ?? fixture.projectId,
      projectRole: options.projectRole ?? ProjectRole.BACKEND,
      sequenceNumber,
      teamId,
      title: '프로젝트 팀 작업',
      type: IssueType.TEAM_TASK,
      workflowStateId:
        options.stateId ??
        (teamId === fixture.webTeamId ? fixture.webStateId : fixture.backendStateId),
      workspaceId: fixture.workspaceId,
    },
  });
}

describe('M4 project delivery database integration', () => {
  beforeEach(() => {
    issueSequence = 1;
    userIds = [];
    workspaceIds = [];
  });

  afterEach(async () => {
    if (workspaceIds.length === 0) return;

    const outboxEvents = await prisma.outboxEvent.findMany({
      select: { id: true },
      where: { workspaceId: { in: workspaceIds } },
    });
    const outboxEventIds = outboxEvents.map(({ id }) => id);
    await prisma.notification.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.emailDelivery.deleteMany({ where: { outboxEventId: { in: outboxEventIds } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
    await prisma.activityEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.apiHandoff.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issueBlockRelation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issueSubscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issueLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.projectRoleTeam.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workflowState.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps an M3-shaped standalone team task valid after the additive migration', async () => {
    const fixture = await createWorkspaceFixture();
    const issue = await createStandaloneTask(fixture);

    await expect(
      prisma.issue.findUniqueOrThrow({ where: { id: issue.id } }),
    ).resolves.toMatchObject({
      featureStatus: null,
      parentIssueId: null,
      projectId: null,
      projectRole: null,
      teamId: fixture.backendTeamId,
      type: IssueType.TEAM_TASK,
      workflowStateId: fixture.backendStateId,
    });
  });

  it('enforces project dates, workspace-scoped roles, and role-team identity', async () => {
    const fixture = await createWorkspaceFixture();

    await expect(
      prisma.project.create({
        data: {
          name: '잘못된 일정',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          targetDate: new Date('2026-07-01T00:00:00.000Z'),
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      createProjectTask(fixture, {
        projectRole: ProjectRole.BACKEND,
        stateId: fixture.webStateId,
        teamId: fixture.webTeamId,
      }),
    ).rejects.toThrow();

    const foreign = await createWorkspaceFixture();
    await expect(
      prisma.projectRoleTeam.create({
        data: {
          projectId: fixture.projectId,
          role: ProjectRole.APP_FRONTEND,
          teamId: foreign.webTeamId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces FEATURE and TEAM_TASK field combinations and feature sequence uniqueness', async () => {
    const fixture = await createWorkspaceFixture();
    const feature = await createFeature(fixture);
    const task = await createProjectTask(fixture, { parentIssueId: feature.id });

    expect(feature).toMatchObject({
      featureStatus: FeatureIssueStatus.TODO,
      projectId: fixture.projectId,
      teamId: null,
      type: IssueType.FEATURE,
    });
    expect(task).toMatchObject({
      featureStatus: null,
      parentIssueId: feature.id,
      projectRole: ProjectRole.BACKEND,
      type: IssueType.TEAM_TASK,
    });

    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          featureStatus: FeatureIssueStatus.TODO,
          identifier: 'F-invalid-fields',
          projectId: fixture.projectId,
          sequenceNumber: nextIssueSequence(),
          teamId: fixture.backendTeamId,
          title: '팀 필드가 있는 기능 이슈',
          type: IssueType.FEATURE,
          workflowStateId: fixture.backendStateId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          identifier: 'API-invalid-fields',
          sequenceNumber: nextIssueSequence(),
          title: '상태가 없는 팀 작업',
          type: IssueType.TEAM_TASK,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          featureStatus: FeatureIssueStatus.UNSORTED,
          identifier: 'F-duplicate-sequence',
          projectId: fixture.secondProjectId,
          sequenceNumber: feature.sequenceNumber,
          title: '중복 기능 순번',
          type: IssueType.FEATURE,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('keeps a child task in the same project as its feature parent', async () => {
    const fixture = await createWorkspaceFixture();
    const feature = await createFeature(fixture);

    await expect(createProjectTask(fixture, { parentIssueId: feature.id })).resolves.toMatchObject({
      parentIssueId: feature.id,
      projectId: fixture.projectId,
    });
    await expect(
      createProjectTask(fixture, {
        parentIssueId: feature.id,
        projectId: fixture.secondProjectId,
      }),
    ).rejects.toThrow();
  });

  it('rejects self-blocking and duplicate block relations', async () => {
    const fixture = await createWorkspaceFixture();
    const blockingIssue = await createProjectTask(fixture);
    const blockedIssue = await createProjectTask(fixture, {
      projectRole: ProjectRole.WEB_FRONTEND,
      stateId: fixture.webStateId,
      teamId: fixture.webTeamId,
    });

    await expect(
      prisma.issueBlockRelation.create({
        data: {
          blockedIssueId: blockingIssue.id,
          blockingIssueId: blockingIssue.id,
          createdByMembershipId: fixture.adminMembershipId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await prisma.issueBlockRelation.create({
      data: {
        blockedIssueId: blockedIssue.id,
        blockingIssueId: blockingIssue.id,
        createdByMembershipId: fixture.adminMembershipId,
        workspaceId: fixture.workspaceId,
      },
    });
    await expect(
      prisma.issueBlockRelation.create({
        data: {
          blockedIssueId: blockedIssue.id,
          blockingIssueId: blockingIssue.id,
          createdByMembershipId: fixture.adminMembershipId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows one INITIAL handoff and append-only FOLLOW_UP sequence values', async () => {
    const fixture = await createWorkspaceFixture();
    const issue = await createProjectTask(fixture);
    const initial = await prisma.apiHandoff.create({
      data: {
        authorMembershipId: fixture.adminMembershipId,
        bodyMarkdown: '## 변경 요약\n최초 전달',
        issueId: issue.id,
        kind: HandoffKind.INITIAL,
        sequenceNumber: 1,
        workspaceId: fixture.workspaceId,
      },
    });

    await expect(
      prisma.apiHandoff.create({
        data: {
          authorMembershipId: fixture.adminMembershipId,
          bodyMarkdown: '## 변경 요약\n두 번째 최초 전달',
          issueId: issue.id,
          kind: HandoffKind.INITIAL,
          sequenceNumber: 2,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.apiHandoff.create({
        data: {
          authorMembershipId: fixture.adminMembershipId,
          bodyMarkdown: '## 변경 요약\n추가 전달',
          issueId: issue.id,
          kind: HandoffKind.FOLLOW_UP,
          sequenceNumber: 2,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).resolves.toMatchObject({ issueId: issue.id, sequenceNumber: 2 });
    expect(initial.sequenceNumber).toBe(1);
  });

  it('makes notification delivery idempotent per event and recipient', async () => {
    const fixture = await createWorkspaceFixture();
    const issue = await createProjectTask(fixture);
    const handoff = await prisma.apiHandoff.create({
      data: {
        authorMembershipId: fixture.adminMembershipId,
        bodyMarkdown: '## 변경 요약\n알림 전달',
        issueId: issue.id,
        kind: HandoffKind.INITIAL,
        sequenceNumber: 1,
        workspaceId: fixture.workspaceId,
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        actorMembershipId: fixture.adminMembershipId,
        aggregateId: handoff.id,
        aggregateType: 'API_HANDOFF',
        eventType: 'API_HANDOFF_CREATED',
        payload: { handoffId: handoff.id, schemaVersion: 1 },
        workspaceId: fixture.workspaceId,
      },
    });
    const notificationData = {
      actorMembershipId: fixture.adminMembershipId,
      eventId: event.id,
      handoffId: handoff.id,
      issueId: issue.id,
      recipientMembershipId: fixture.memberMembershipId,
      type: NotificationType.API_HANDOFF_CREATED,
      workspaceId: fixture.workspaceId,
    };

    await prisma.notification.create({ data: notificationData });
    await expect(prisma.notification.create({ data: notificationData })).rejects.toThrow();
    await expect(
      prisma.notification.create({
        data: {
          ...notificationData,
          actorMembershipId: fixture.memberMembershipId,
        },
      }),
    ).rejects.toThrow();

    await prisma.outboxEvent.delete({ where: { id: event.id } });
    await expect(
      prisma.notification.findFirstOrThrow({
        select: { eventId: true, recipientMembershipId: true },
        where: { eventId: event.id },
      }),
    ).resolves.toEqual({
      eventId: event.id,
      recipientMembershipId: fixture.memberMembershipId,
    });
  });

  it('requires exactly one activity target and installs the M4 access indexes', async () => {
    const fixture = await createWorkspaceFixture();
    const issue = await createProjectTask(fixture);

    await expect(
      prisma.activityEvent.create({
        data: {
          actorMembershipId: fixture.adminMembershipId,
          eventType: 'ISSUE_UPDATED',
          issueId: issue.id,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).resolves.toMatchObject({ issueId: issue.id, projectId: null });
    await expect(
      prisma.activityEvent.create({
        data: {
          actorMembershipId: fixture.adminMembershipId,
          eventType: 'PROJECT_UPDATED',
          projectId: fixture.projectId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).resolves.toMatchObject({ issueId: null, projectId: fixture.projectId });
    await expect(
      prisma.activityEvent.create({
        data: {
          actorMembershipId: fixture.adminMembershipId,
          eventType: 'INVALID_ACTIVITY',
          issueId: issue.id,
          projectId: fixture.projectId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.activityEvent.create({
        data: {
          actorMembershipId: fixture.adminMembershipId,
          eventType: 'INVALID_ACTIVITY',
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT "indexname"
      FROM "pg_indexes"
      WHERE "schemaname" = current_schema()
        AND "indexname" IN (
          'projects_workspace_id_archived_at_updated_at_id_idx',
          'issues_workspace_id_project_id_parent_issue_id_id_idx',
          'issues_workspace_id_feature_sequence_number_key',
          'issue_block_relations_workspace_id_blocked_issue_id_created_idx',
          'issue_block_relations_workspace_id_blocking_issue_id_create_idx',
          'api_handoffs_initial_issue_key',
          'notifications_workspace_id_recipient_membership_id_read_at__idx',
          'activity_events_workspace_id_project_id_created_at_id_idx'
        )
    `;

    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual(
      [
        'activity_events_workspace_id_project_id_created_at_id_idx',
        'api_handoffs_initial_issue_key',
        'issue_block_relations_workspace_id_blocked_issue_id_created_idx',
        'issue_block_relations_workspace_id_blocking_issue_id_create_idx',
        'issues_workspace_id_feature_sequence_number_key',
        'issues_workspace_id_project_id_parent_issue_id_id_idx',
        'notifications_workspace_id_recipient_membership_id_read_at__idx',
        'projects_workspace_id_archived_at_updated_at_id_idx',
      ].sort(),
    );
  });
});
