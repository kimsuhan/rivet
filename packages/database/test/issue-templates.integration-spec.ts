import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  IssuePriority,
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

type Fixture = {
  labelId: string;
  membershipId: string;
  projectId: string;
  teamId: string;
  userId: string;
  workflowStateId: string;
  workspaceId: string;
};

async function createFixture(name: string): Promise<Fixture> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  const teamId = randomUUID();
  const workflowStateId = randomUUID();
  const projectId = randomUUID();
  const labelId = randomUUID();
  const email = `${userId}@example.test`;

  await prisma.user.create({
    data: {
      displayName: `${name} 사용자`,
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
      name: `${name} 워크스페이스`,
      normalizedSlug: `templates-${workspaceId}`,
      slug: `templates-${workspaceId}`,
    },
  });
  await prisma.workspaceMembership.create({
    data: { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      key: 'TPL',
      name: `${name} 팀`,
      normalizedName: `${name} 팀`,
      workspaceId,
    },
  });
  await prisma.workflowState.create({
    data: {
      category: StateCategory.BACKLOG,
      id: workflowStateId,
      isDefault: true,
      name: '백로그',
      normalizedName: '백로그',
      position: 0,
      teamId,
      workspaceId,
    },
  });
  await prisma.project.create({
    data: { id: projectId, name: `${name} 프로젝트`, workspaceId },
  });
  await prisma.projectRoleTeam.create({
    data: { projectId, role: ProjectRole.BACKEND, teamId, workspaceId },
  });
  await prisma.label.create({
    data: {
      color: '#4F46E5',
      id: labelId,
      name: `${name} 라벨`,
      normalizedName: `${name} 라벨`,
      workspaceId,
    },
  });

  return {
    labelId,
    membershipId,
    projectId,
    teamId,
    userId,
    workflowStateId,
    workspaceId,
  };
}

async function cleanup(fixtures: Fixture[]) {
  const membershipIds = fixtures.map((fixture) => fixture.membershipId);
  const userIds = fixtures.map((fixture) => fixture.userId);
  const workspaceIds = fixtures.map((fixture) => fixture.workspaceId);

  await prisma.issueTemplateLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.issueLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.teamWork.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.issueTemplate.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.projectRoleTeam.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workflowState.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe('issue templates PostgreSQL integration', () => {
  afterAll(async () => prisma.$disconnect());

  it('enforces workspace references, project-role dependency, and active name uniqueness', async () => {
    const first = await createFixture('첫 번째');
    const second = await createFixture('두 번째');

    try {
      const template = await prisma.issueTemplate.create({
        data: {
          descriptionMarkdown: '## 설명',
          name: '버그 신고',
          normalizedName: '버그 신고',
          projectId: first.projectId,
          workspaceId: first.workspaceId,
        },
      });
      await prisma.issueTemplateLabel.create({
        data: {
          issueTemplateId: template.id,
          labelId: first.labelId,
          workspaceId: first.workspaceId,
        },
      });

      await expect(
        prisma.issueTemplate.create({
          data: {
            descriptionMarkdown: '교차 워크스페이스 프로젝트',
            name: '교차 프로젝트',
            normalizedName: '교차 프로젝트',
            projectId: second.projectId,
            workspaceId: first.workspaceId,
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.issueTemplateLabel.create({
          data: {
            issueTemplateId: template.id,
            labelId: second.labelId,
            workspaceId: first.workspaceId,
          },
        }),
      ).rejects.toThrow();
      await expect(prisma.label.delete({ where: { id: first.labelId } })).rejects.toThrow();
      await expect(
        prisma.issueTemplate.create({
          data: {
            descriptionMarkdown: '프로젝트 없는 역할',
            initialRole: ProjectRole.BACKEND,
            name: '잘못된 역할',
            normalizedName: '잘못된 역할',
            workspaceId: first.workspaceId,
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.issueTemplate.create({
          data: {
            descriptionMarkdown: '활성 이름 중복',
            name: '버그 신고',
            normalizedName: '버그 신고',
            workspaceId: first.workspaceId,
          },
        }),
      ).rejects.toThrow();

      await prisma.issueTemplate.update({
        data: { archivedAt: new Date() },
        where: { id: template.id },
      });
      await expect(
        prisma.issueTemplate.create({
          data: {
            descriptionMarkdown: '보관 후 이름 재사용',
            name: '버그 신고',
            normalizedName: '버그 신고',
            workspaceId: first.workspaceId,
          },
        }),
      ).resolves.toMatchObject({ normalizedName: '버그 신고' });
    } finally {
      await cleanup([first, second]);
    }
  });

  it('prevents a stale version from overwriting the latest template', async () => {
    const fixture = await createFixture('버전');

    try {
      const template = await prisma.issueTemplate.create({
        data: {
          descriptionMarkdown: '초기 설명',
          name: '초기 템플릿',
          normalizedName: '초기 템플릿',
          workspaceId: fixture.workspaceId,
        },
      });

      const currentUpdate = await prisma.issueTemplate.updateMany({
        data: {
          descriptionMarkdown: '최신 설명',
          name: '최신 템플릿',
          normalizedName: '최신 템플릿',
          version: { increment: 1 },
        },
        where: { id: template.id, version: 1, workspaceId: fixture.workspaceId },
      });
      const staleUpdate = await prisma.issueTemplate.updateMany({
        data: {
          descriptionMarkdown: '오래된 설명',
          name: '오래된 템플릿',
          normalizedName: '오래된 템플릿',
          version: { increment: 1 },
        },
        where: { id: template.id, version: 1, workspaceId: fixture.workspaceId },
      });

      expect(currentUpdate.count).toBe(1);
      expect(staleUpdate.count).toBe(0);
      await expect(
        prisma.issueTemplate.findUniqueOrThrow({ where: { id: template.id } }),
      ).resolves.toMatchObject({
        descriptionMarkdown: '최신 설명',
        name: '최신 템플릿',
        version: 2,
      });
    } finally {
      await cleanup([fixture]);
    }
  });

  it('detaches template defaults before project deletion without changing an existing issue', async () => {
    const fixture = await createFixture('프로젝트 영구 삭제');
    const issueId = randomUUID();
    const replacementProjectId = randomUUID();

    try {
      await prisma.project.create({
        data: {
          id: replacementProjectId,
          name: '이슈가 남을 프로젝트',
          workspaceId: fixture.workspaceId,
        },
      });
      const template = await prisma.issueTemplate.create({
        data: {
          descriptionMarkdown: '영구 삭제 전 템플릿 설명',
          initialRole: ProjectRole.BACKEND,
          name: '영구 삭제 대상 프로젝트 템플릿',
          normalizedName: '영구 삭제 대상 프로젝트 템플릿',
          priority: IssuePriority.HIGH,
          projectId: fixture.projectId,
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.issueTemplateLabel.create({
        data: {
          issueTemplateId: template.id,
          labelId: fixture.labelId,
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.issue.create({
        data: {
          createdByMembershipId: fixture.membershipId,
          descriptionMarkdown: template.descriptionMarkdown,
          id: issueId,
          identifier: `ISS-${issueId.slice(0, 8)}`,
          priority: template.priority,
          projectId: replacementProjectId,
          sequenceNumber: 1,
          title: '템플릿 값으로 만든 기존 이슈',
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.issueLabel.create({
        data: { issueId, labelId: fixture.labelId, workspaceId: fixture.workspaceId },
      });

      const deletedAt = new Date('2026-07-17T00:00:00.000Z');
      const purgeAt = new Date('2026-08-16T00:00:00.000Z');
      await prisma.project.update({
        data: { deletedAt, deletedByMembershipId: fixture.membershipId, purgeAt },
        where: { id: fixture.projectId },
      });
      await expect(
        prisma.issueTemplate.findUniqueOrThrow({ where: { id: template.id } }),
      ).resolves.toMatchObject({
        initialRole: ProjectRole.BACKEND,
        projectId: fixture.projectId,
        version: 1,
      });
      await prisma.$transaction(async (transaction) => {
        await transaction.issueTemplate.updateMany({
          data: {
            initialRole: null,
            projectId: null,
            version: { increment: 1 },
          },
          where: { projectId: fixture.projectId, workspaceId: fixture.workspaceId },
        });
        await transaction.projectRoleTeam.deleteMany({
          where: { projectId: fixture.projectId, workspaceId: fixture.workspaceId },
        });
        const deleted = await transaction.project.deleteMany({
          where: {
            deletedAt: { not: null },
            id: fixture.projectId,
            purgeAt,
            workspaceId: fixture.workspaceId,
          },
        });
        expect(deleted.count).toBe(1);
      });

      await expect(
        prisma.issueTemplate.findUniqueOrThrow({
          include: { labels: true },
          where: { id: template.id },
        }),
      ).resolves.toMatchObject({
        initialRole: null,
        labels: [expect.objectContaining({ labelId: fixture.labelId })],
        projectId: null,
        version: 2,
      });
      await expect(
        prisma.issue.findUniqueOrThrow({
          include: { labels: true },
          where: { id: issueId },
        }),
      ).resolves.toMatchObject({
        descriptionMarkdown: '영구 삭제 전 템플릿 설명',
        labels: [expect.objectContaining({ labelId: fixture.labelId })],
        priority: IssuePriority.HIGH,
        projectId: replacementProjectId,
      });
    } finally {
      await cleanup([fixture]);
    }
  });

  it('keeps created issue data independent from later template changes and archive', async () => {
    const fixture = await createFixture('불변성');
    const issueId = randomUUID();
    const teamWorkId = randomUUID();

    try {
      const template = await prisma.issueTemplate.create({
        data: {
          descriptionMarkdown: '적용 당시 설명',
          initialRole: ProjectRole.BACKEND,
          name: '적용 템플릿',
          normalizedName: '적용 템플릿',
          priority: IssuePriority.HIGH,
          projectId: fixture.projectId,
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.issueTemplateLabel.create({
        data: {
          issueTemplateId: template.id,
          labelId: fixture.labelId,
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.issue.create({
        data: {
          createdByMembershipId: fixture.membershipId,
          descriptionMarkdown: template.descriptionMarkdown,
          id: issueId,
          identifier: `ISS-${issueId.slice(0, 8)}`,
          priority: template.priority,
          projectId: fixture.projectId,
          sequenceNumber: 1,
          title: '템플릿으로 생성한 이슈',
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.issueLabel.create({
        data: {
          issueId,
          labelId: fixture.labelId,
          workspaceId: fixture.workspaceId,
        },
      });
      await prisma.teamWork.create({
        data: {
          createdByMembershipId: fixture.membershipId,
          id: teamWorkId,
          identifier: `WORK-${teamWorkId.slice(0, 8)}`,
          issueId,
          projectRole: template.initialRole!,
          sequenceNumber: 1,
          teamId: fixture.teamId,
          workflowStateId: fixture.workflowStateId,
          workspaceId: fixture.workspaceId,
        },
      });

      await prisma.issueTemplateLabel.deleteMany({ where: { issueTemplateId: template.id } });
      await prisma.issueTemplate.update({
        data: {
          archivedAt: new Date(),
          descriptionMarkdown: '나중에 바뀐 설명',
          initialRole: ProjectRole.WEB_FRONTEND,
          priority: IssuePriority.LOW,
          version: { increment: 1 },
        },
        where: { id: template.id },
      });

      const issue = await prisma.issue.findUniqueOrThrow({
        include: { labels: true, teamWorks: true },
        where: { id: issueId },
      });
      expect(issue).toMatchObject({
        descriptionMarkdown: '적용 당시 설명',
        priority: IssuePriority.HIGH,
        projectId: fixture.projectId,
      });
      expect(issue.labels).toEqual([
        expect.objectContaining({ labelId: fixture.labelId, workspaceId: fixture.workspaceId }),
      ]);
      expect(issue.teamWorks).toEqual([
        expect.objectContaining({
          id: teamWorkId,
          projectRole: ProjectRole.BACKEND,
          teamId: fixture.teamId,
        }),
      ]);

      const issueTemplateColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT "column_name"
        FROM "information_schema"."columns"
        WHERE "table_schema" = current_schema()
          AND "table_name" = 'issues'
          AND "column_name" IN ('issue_template_id', 'template_id')
      `;
      const issueTemplateForeignKeys = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
        SELECT "tc"."constraint_name"
        FROM "information_schema"."table_constraints" AS "tc"
        INNER JOIN "information_schema"."constraint_column_usage" AS "ccu"
          ON "ccu"."constraint_catalog" = "tc"."constraint_catalog"
          AND "ccu"."constraint_schema" = "tc"."constraint_schema"
          AND "ccu"."constraint_name" = "tc"."constraint_name"
        WHERE "tc"."table_schema" = current_schema()
          AND "tc"."table_name" = 'issues'
          AND "tc"."constraint_type" = 'FOREIGN KEY'
          AND "ccu"."table_name" = 'issue_templates'
      `;
      expect(issueTemplateColumns).toEqual([]);
      expect(issueTemplateForeignKeys).toEqual([]);
    } finally {
      await cleanup([fixture]);
    }
  });
});
