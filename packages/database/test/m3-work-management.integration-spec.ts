import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  IssuePriority,
  IssueType,
  MembershipRole,
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
  labelId: string;
  memberMembershipId: string;
  stateId: string;
  teamId: string;
  teamKey: string;
  workspaceId: string;
};

let userIds: string[] = [];
let workspaceIds: string[] = [];

async function createUser(displayName: string): Promise<string> {
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  userIds.push(userId);
  await prisma.user.create({
    data: {
      displayName,
      email,
      id: userId,
      normalizedEmail: email,
      passwordHash: '$argon2id$m3-test-fixture',
    },
  });
  return userId;
}

async function createWorkspaceFixture(teamKey: string): Promise<WorkspaceFixture> {
  const adminUserId = await createUser(`${teamKey} 관리자`);
  const memberUserId = await createUser(`${teamKey} 멤버`);
  const adminMembershipId = randomUUID();
  const memberMembershipId = randomUUID();
  const workspaceId = randomUUID();
  const teamId = randomUUID();
  const stateId = randomUUID();
  const labelId = randomUUID();
  workspaceIds.push(workspaceId);

  await prisma.$transaction(async (transaction) => {
    await transaction.workspace.create({
      data: {
        createdByUserId: adminUserId,
        id: workspaceId,
        name: `${teamKey} 워크스페이스`,
        normalizedSlug: `m3-${workspaceId}`,
        slug: `m3-${workspaceId}`,
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
    await transaction.team.create({
      data: {
        id: teamId,
        key: teamKey,
        name: `${teamKey} 팀`,
        normalizedName: `${teamKey.toLowerCase()} 팀`,
        workspaceId,
      },
    });
    await transaction.teamMember.create({
      data: { membershipId: adminMembershipId, teamId, workspaceId },
    });
    await transaction.workflowState.create({
      data: {
        category: StateCategory.BACKLOG,
        id: stateId,
        isDefault: true,
        name: '미분류',
        normalizedName: '미분류',
        position: 0,
        teamId,
        workspaceId,
      },
    });
    await transaction.label.create({
      data: {
        color: '#445566',
        id: labelId,
        name: `${teamKey} 라벨`,
        normalizedName: `${teamKey.toLowerCase()} 라벨`,
        workspaceId,
      },
    });
  });

  return {
    adminMembershipId,
    labelId,
    memberMembershipId,
    stateId,
    teamId,
    teamKey,
    workspaceId,
  };
}

function createIssue(
  fixture: WorkspaceFixture,
  options: { identifier?: string; sequenceNumber?: number } = {},
) {
  return prisma.issue.create({
    data: {
      assigneeMembershipId: fixture.adminMembershipId,
      createdByMembershipId: fixture.adminMembershipId,
      identifier: options.identifier ?? `${fixture.teamKey}-1`,
      priority: IssuePriority.NONE,
      sequenceNumber: options.sequenceNumber ?? 1,
      teamId: fixture.teamId,
      title: 'M3 팀 작업',
      type: IssueType.TEAM_TASK,
      workflowStateId: fixture.stateId,
      workspaceId: fixture.workspaceId,
    },
  });
}

describe('M3 work management database integration', () => {
  beforeEach(() => {
    userIds = [];
    workspaceIds = [];
  });

  afterEach(async () => {
    await prisma.activityEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issueSubscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issueLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workflowState.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspaceMembership.deleteMany({
      where: { OR: [{ workspaceId: { in: workspaceIds } }, { userId: { in: userIds } }] },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores a team task with its scoped state, assignee, labels, subscriptions, and activity', async () => {
    const fixture = await createWorkspaceFixture('WEB');
    const issue = await createIssue(fixture);

    await prisma.$transaction([
      prisma.issueLabel.create({
        data: {
          issueId: issue.id,
          labelId: fixture.labelId,
          workspaceId: fixture.workspaceId,
        },
      }),
      prisma.issueSubscription.create({
        data: {
          issueId: issue.id,
          membershipId: fixture.memberMembershipId,
          workspaceId: fixture.workspaceId,
        },
      }),
      prisma.activityEvent.create({
        data: {
          actorMembershipId: fixture.adminMembershipId,
          afterData: { priority: IssuePriority.NONE },
          eventType: 'ISSUE_CREATED',
          issueId: issue.id,
          workspaceId: fixture.workspaceId,
        },
      }),
    ]);

    await expect(
      prisma.issue.findUniqueOrThrow({
        include: {
          activityEvents: true,
          assigneeTeamMember: { include: { membership: true } },
          labels: true,
          subscriptions: true,
          workflowState: true,
        },
        where: { id: issue.id },
      }),
    ).resolves.toMatchObject({
      activityEvents: [
        {
          actorMembershipId: fixture.adminMembershipId,
          afterData: { priority: IssuePriority.NONE },
          eventType: 'ISSUE_CREATED',
        },
      ],
      assigneeTeamMember: { membershipId: fixture.adminMembershipId },
      identifier: 'WEB-1',
      labels: [{ labelId: fixture.labelId, workspaceId: fixture.workspaceId }],
      priority: IssuePriority.NONE,
      subscriptions: [{ membershipId: fixture.memberMembershipId }],
      type: IssueType.TEAM_TASK,
      version: 1,
      workflowState: { id: fixture.stateId, teamId: fixture.teamId },
    });
  });

  it('enforces M3 issue type, title, sequence, version, and identifier uniqueness', async () => {
    const fixture = await createWorkspaceFixture('API');
    await createIssue(fixture);
    const otherTeamId = randomUUID();
    const otherStateId = randomUUID();
    await prisma.team.create({
      data: {
        id: otherTeamId,
        key: 'WEB',
        name: '웹 팀',
        normalizedName: '웹 팀',
        workspaceId: fixture.workspaceId,
      },
    });
    await prisma.workflowState.create({
      data: {
        category: StateCategory.BACKLOG,
        id: otherStateId,
        isDefault: true,
        name: '웹 미분류',
        normalizedName: '웹 미분류',
        position: 0,
        teamId: otherTeamId,
        workspaceId: fixture.workspaceId,
      },
    });

    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          identifier: 'API-2',
          sequenceNumber: 2,
          teamId: fixture.teamId,
          title: '기능 이슈는 M4에서 추가',
          type: IssueType.FEATURE,
          workflowStateId: fixture.stateId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          identifier: 'API-3',
          sequenceNumber: 3,
          teamId: fixture.teamId,
          title: '   ',
          workflowStateId: fixture.stateId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          identifier: 'API-0',
          sequenceNumber: 0,
          teamId: fixture.teamId,
          title: '잘못된 순번',
          workflowStateId: fixture.stateId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          identifier: 'API-4',
          sequenceNumber: 4,
          teamId: fixture.teamId,
          title: '잘못된 버전',
          version: 0,
          workflowStateId: fixture.stateId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: fixture.adminMembershipId,
          identifier: 'API-1',
          sequenceNumber: 1,
          teamId: otherTeamId,
          title: '다른 팀의 중복 표시 ID',
          workflowStateId: otherStateId,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      createIssue(fixture, { identifier: 'API-99', sequenceNumber: 1 }),
    ).rejects.toThrow();
  });

  it('rejects workflow states and assignees outside the issue workspace or team', async () => {
    const first = await createWorkspaceFixture('WEB');
    const second = await createWorkspaceFixture('API');
    const otherTeamId = randomUUID();
    const otherStateId = randomUUID();

    await prisma.team.create({
      data: {
        id: otherTeamId,
        key: 'OPS',
        name: '운영 팀',
        normalizedName: '운영 팀',
        workspaceId: first.workspaceId,
      },
    });
    await prisma.workflowState.create({
      data: {
        category: StateCategory.BACKLOG,
        id: otherStateId,
        isDefault: true,
        name: '운영 미분류',
        normalizedName: '운영 미분류',
        position: 0,
        teamId: otherTeamId,
        workspaceId: first.workspaceId,
      },
    });

    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: first.adminMembershipId,
          identifier: 'WEB-1',
          sequenceNumber: 1,
          teamId: first.teamId,
          title: '다른 팀 상태',
          workflowStateId: otherStateId,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: first.adminMembershipId,
          identifier: 'WEB-2',
          sequenceNumber: 2,
          teamId: first.teamId,
          title: '팀 미소속 담당자',
          workflowStateId: first.stateId,
          workspaceId: first.workspaceId,
          assigneeMembershipId: first.memberMembershipId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: first.adminMembershipId,
          identifier: 'WEB-3',
          sequenceNumber: 3,
          teamId: first.teamId,
          title: '다른 워크스페이스 담당자',
          workflowStateId: first.stateId,
          workspaceId: first.workspaceId,
          assigneeMembershipId: second.adminMembershipId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issue.create({
        data: {
          createdByMembershipId: first.adminMembershipId,
          identifier: 'WEB-4',
          sequenceNumber: 4,
          teamId: first.teamId,
          title: '다른 워크스페이스 상태',
          workflowStateId: second.stateId,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects labels, subscriptions, and activity actors from another workspace', async () => {
    const first = await createWorkspaceFixture('WEB');
    const second = await createWorkspaceFixture('API');
    const issue = await createIssue(first);

    await expect(
      prisma.issueLabel.create({
        data: {
          issueId: issue.id,
          labelId: second.labelId,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issueLabel.create({
        data: {
          issueId: issue.id,
          labelId: second.labelId,
          workspaceId: second.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issueSubscription.create({
        data: {
          issueId: issue.id,
          membershipId: second.memberMembershipId,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.activityEvent.create({
        data: {
          actorMembershipId: second.adminMembershipId,
          eventType: 'ISSUE_UPDATED',
          issueId: issue.id,
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('installs the M3 issue list, my issue, activity, and integrity indexes', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN ('issues', 'activity_events')
    `;
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'issues'::regclass
    `;

    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'issues_workspace_id_identifier_key',
        'issues_team_id_sequence_number_key',
        'issues_workspace_id_team_id_updated_at_id_idx',
        'issues_workspace_id_assignee_membership_id_updated_at_id_idx',
        'issues_workspace_id_workflow_state_id_id_idx',
        'activity_events_workspace_id_issue_id_created_at_id_idx',
      ]),
    );
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'issues_type_fields_valid',
        'issues_title_not_blank',
        'issues_sequence_number_positive',
        'issues_version_positive',
        'issues_workspace_id_team_id_workflow_state_id_fkey',
        'issues_workspace_id_team_id_assignee_membership_id_fkey',
      ]),
    );
  });
});
