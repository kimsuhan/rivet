import { randomUUID } from 'node:crypto';

import {
  createPrismaClient,
  FileScope,
  HandoffKind,
  IssueFileKind,
  IssueType,
  MembershipRole,
  NotificationType,
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
  issueIds: [string, string];
  membershipId: string;
  teamId: string;
  userId: string;
  workspaceId: string;
};

const fixtures: WorkspaceFixture[] = [];

async function createWorkspaceFixture(label: string): Promise<WorkspaceFixture> {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const membershipId = randomUUID();
  const teamId = randomUUID();
  const workflowStateId = randomUUID();
  const issueIds: [string, string] = [randomUUID(), randomUUID()];
  const email = `${userId}@example.test`;

  await prisma.$transaction(async (transaction) => {
    await transaction.user.create({
      data: {
        displayName: `${label} 사용자`,
        email,
        id: userId,
        normalizedEmail: email,
        passwordHash: '$argon2id$m5-test-fixture',
      },
    });
    await transaction.workspace.create({
      data: {
        createdByUserId: userId,
        id: workspaceId,
        name: `${label} 워크스페이스`,
        normalizedSlug: `m5-${workspaceId}`,
        slug: `m5-${workspaceId}`,
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
    await transaction.team.create({
      data: {
        id: teamId,
        key: 'MFA',
        name: `${label} 팀`,
        normalizedName: `${label} 팀`,
        workspaceId,
      },
    });
    await transaction.teamMember.create({
      data: { membershipId, teamId, workspaceId },
    });
    await transaction.workflowState.create({
      data: {
        category: StateCategory.UNSTARTED,
        id: workflowStateId,
        isDefault: true,
        name: '할 일',
        normalizedName: '할 일',
        position: 0,
        teamId,
        workspaceId,
      },
    });
    await transaction.issue.createMany({
      data: issueIds.map((id, index) => ({
        createdByMembershipId: membershipId,
        id,
        identifier: `${label.toUpperCase()}-${index + 1}`,
        sequenceNumber: index + 1,
        teamId,
        title: `${label} 작업 ${index + 1}`,
        type: IssueType.TEAM_TASK,
        workflowStateId,
        workspaceId,
      })),
    });
  });

  const fixture = { issueIds, membershipId, teamId, userId, workspaceId };
  fixtures.push(fixture);
  return fixture;
}

async function createWorkspaceFile(fixture: WorkspaceFixture) {
  return prisma.file.create({
    data: {
      detectedMimeType: 'image/png',
      originalName: 'image.png',
      scope: FileScope.WORKSPACE,
      sizeBytes: 1024n,
      storageKey: `objects/${randomUUID()}`,
      uploadedByUserId: fixture.userId,
      workspaceId: fixture.workspaceId,
    },
  });
}

describe('M5 collaboration and file constraints', () => {
  let primary: WorkspaceFixture;
  let secondary: WorkspaceFixture;
  let primaryCommentId: string;
  let secondIssueCommentId: string;
  let primaryHandoffId: string;
  let secondIssueHandoffId: string;

  beforeAll(async () => {
    primary = await createWorkspaceFixture('m5a');
    secondary = await createWorkspaceFixture('m5b');

    const [primaryComment, secondIssueComment, primaryHandoff, secondIssueHandoff] =
      await prisma.$transaction([
        prisma.comment.create({
          data: {
            authorMembershipId: primary.membershipId,
            bodyMarkdown: '첫 번째 댓글',
            issueId: primary.issueIds[0],
            workspaceId: primary.workspaceId,
          },
        }),
        prisma.comment.create({
          data: {
            authorMembershipId: primary.membershipId,
            bodyMarkdown: '두 번째 이슈 댓글',
            issueId: primary.issueIds[1],
            workspaceId: primary.workspaceId,
          },
        }),
        prisma.apiHandoff.create({
          data: {
            authorMembershipId: primary.membershipId,
            bodyMarkdown: '## API 명세\n유효한 전달',
            issueId: primary.issueIds[0],
            kind: HandoffKind.INITIAL,
            sequenceNumber: 1,
            workspaceId: primary.workspaceId,
          },
        }),
        prisma.apiHandoff.create({
          data: {
            authorMembershipId: primary.membershipId,
            bodyMarkdown: '## API 명세\n두 번째 이슈 전달',
            issueId: primary.issueIds[1],
            kind: HandoffKind.INITIAL,
            sequenceNumber: 1,
            workspaceId: primary.workspaceId,
          },
        }),
      ]);

    primaryCommentId = primaryComment.id;
    secondIssueCommentId = secondIssueComment.id;
    primaryHandoffId = primaryHandoff.id;
    secondIssueHandoffId = secondIssueHandoff.id;
  });

  afterAll(async () => {
    const workspaceIds = fixtures.map((fixture) => fixture.workspaceId);
    const userIds = fixtures.map((fixture) => fixture.userId);

    await prisma.user.updateMany({
      data: { avatarFileId: null },
      where: { id: { in: userIds } },
    });
    await prisma.notification.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issueFileAttachment.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.mention.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.comment.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.apiHandoff.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workflowState.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspaceMembership.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.file.deleteMany({ where: { uploadedByUserId: { in: userIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('stores an optional issue Markdown description within the fixed length', async () => {
    const issue = await prisma.issue.update({
      data: { descriptionMarkdown: '## 작업 설명' },
      where: { id: primary.issueIds[0] },
    });

    expect(issue.descriptionMarkdown).toBe('## 작업 설명');
    await expect(
      prisma.issue.update({
        data: { descriptionMarkdown: 'x'.repeat(100_001) },
        where: { id: primary.issueIds[0] },
      }),
    ).rejects.toThrow();
  });

  it('requires active comments to have a body and deleted comments to remove it', async () => {
    await expect(
      prisma.comment.create({
        data: {
          authorMembershipId: primary.membershipId,
          issueId: primary.issueIds[0],
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.comment.create({
        data: {
          authorMembershipId: primary.membershipId,
          bodyMarkdown: '남아 있는 본문',
          deletedAt: new Date(),
          issueId: primary.issueIds[0],
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();

    const deleted = await prisma.comment.create({
      data: {
        authorMembershipId: primary.membershipId,
        deletedAt: new Date(),
        issueId: primary.issueIds[0],
        workspaceId: primary.workspaceId,
      },
    });

    expect(deleted).toMatchObject({ bodyMarkdown: null, version: 1 });
  });

  it('deduplicates description and comment mentions independently', async () => {
    await prisma.mention.create({
      data: {
        issueId: primary.issueIds[0],
        mentionedMembershipId: primary.membershipId,
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.mention.create({
        data: {
          issueId: primary.issueIds[0],
          mentionedMembershipId: primary.membershipId,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await prisma.mention.create({
      data: {
        commentId: primaryCommentId,
        issueId: primary.issueIds[0],
        mentionedMembershipId: primary.membershipId,
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.mention.create({
        data: {
          commentId: primaryCommentId,
          issueId: primary.issueIds[0],
          mentionedMembershipId: primary.membershipId,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces file scope, size, storage key, and single-avatar use', async () => {
    await expect(
      prisma.file.create({
        data: {
          detectedMimeType: 'image/png',
          originalName: 'invalid.png',
          scope: FileScope.USER_PROFILE,
          sizeBytes: 1n,
          storageKey: `objects/${randomUUID()}`,
          uploadedByUserId: primary.userId,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.file.create({
        data: {
          detectedMimeType: 'image/png',
          originalName: 'invalid-workspace.png',
          scope: FileScope.WORKSPACE,
          sizeBytes: 1n,
          storageKey: `objects/${randomUUID()}`,
          uploadedByUserId: primary.userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.file.create({
        data: {
          detectedMimeType: 'image/png',
          originalName: 'empty.png',
          scope: FileScope.USER_PROFILE,
          sizeBytes: 0n,
          storageKey: `objects/${randomUUID()}`,
          uploadedByUserId: primary.userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.file.create({
        data: {
          detectedMimeType: 'image/png',
          originalName: 'large.png',
          scope: FileScope.USER_PROFILE,
          sizeBytes: 26_214_401n,
          storageKey: randomUUID(),
          uploadedByUserId: primary.userId,
        },
      }),
    ).rejects.toThrow();

    const storageKey = `objects/${randomUUID()}`;
    const avatar = await prisma.file.create({
      data: {
        detectedMimeType: 'image/png',
        originalName: 'avatar.png',
        scope: FileScope.USER_PROFILE,
        sizeBytes: 26_214_400n,
        storageKey,
        uploadedByUserId: primary.userId,
      },
    });
    await expect(
      prisma.file.create({
        data: {
          detectedMimeType: 'image/png',
          originalName: 'duplicate.png',
          scope: FileScope.USER_PROFILE,
          sizeBytes: 1n,
          storageKey,
          uploadedByUserId: primary.userId,
        },
      }),
    ).rejects.toThrow();

    await prisma.user.update({
      data: { avatarFileId: avatar.id },
      where: { id: primary.userId },
    });
    await expect(
      prisma.user.update({
        data: { avatarFileId: avatar.id },
        where: { id: secondary.userId },
      }),
    ).rejects.toThrow();
  });

  it('enforces attachment anchors, workspace ownership, and one-time file use', async () => {
    const [
      attachmentFile,
      descriptionFile,
      invalidAttachmentFile,
      commentFile,
      wrongCommentFile,
      missingHandoffFile,
      wrongHandoffFile,
      handoffFile,
    ] = await Promise.all([
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
      createWorkspaceFile(primary),
    ]);
    const foreignFile = await createWorkspaceFile(secondary);

    await prisma.issueFileAttachment.create({
      data: {
        createdByMembershipId: primary.membershipId,
        fileId: attachmentFile.id,
        issueId: primary.issueIds[0],
        kind: IssueFileKind.ISSUE_ATTACHMENT,
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          createdByMembershipId: primary.membershipId,
          fileId: attachmentFile.id,
          issueId: primary.issueIds[1],
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await prisma.issueFileAttachment.create({
      data: {
        createdByMembershipId: primary.membershipId,
        fileId: descriptionFile.id,
        issueId: primary.issueIds[0],
        kind: IssueFileKind.DESCRIPTION_IMAGE,
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          commentId: primaryCommentId,
          createdByMembershipId: primary.membershipId,
          fileId: invalidAttachmentFile.id,
          issueId: primary.issueIds[0],
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          createdByMembershipId: primary.membershipId,
          fileId: commentFile.id,
          issueId: primary.issueIds[0],
          kind: IssueFileKind.COMMENT_IMAGE,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          createdByMembershipId: primary.membershipId,
          fileId: missingHandoffFile.id,
          issueId: primary.issueIds[0],
          kind: IssueFileKind.HANDOFF_IMAGE,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await prisma.issueFileAttachment.create({
      data: {
        commentId: primaryCommentId,
        createdByMembershipId: primary.membershipId,
        fileId: commentFile.id,
        issueId: primary.issueIds[0],
        kind: IssueFileKind.COMMENT_IMAGE,
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          commentId: secondIssueCommentId,
          createdByMembershipId: primary.membershipId,
          fileId: wrongCommentFile.id,
          issueId: primary.issueIds[0],
          kind: IssueFileKind.COMMENT_IMAGE,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          apiHandoffId: secondIssueHandoffId,
          createdByMembershipId: primary.membershipId,
          fileId: wrongHandoffFile.id,
          issueId: primary.issueIds[0],
          kind: IssueFileKind.HANDOFF_IMAGE,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();

    await prisma.issueFileAttachment.create({
      data: {
        apiHandoffId: primaryHandoffId,
        createdByMembershipId: primary.membershipId,
        fileId: handoffFile.id,
        issueId: primary.issueIds[0],
        kind: IssueFileKind.HANDOFF_IMAGE,
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.issueFileAttachment.create({
        data: {
          createdByMembershipId: primary.membershipId,
          fileId: foreignFile.id,
          issueId: primary.issueIds[0],
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('anchors notifications only to a comment on the same issue', async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        aggregateId: primary.issueIds[0],
        aggregateType: 'ISSUE',
        eventType: 'COMMENT_ADDED',
        payload: { commentId: primaryCommentId, schemaVersion: 1 },
        workspaceId: primary.workspaceId,
      },
    });

    await prisma.notification.create({
      data: {
        commentId: primaryCommentId,
        eventId: event.id,
        issueId: primary.issueIds[0],
        recipientMembershipId: primary.membershipId,
        type: NotificationType.COMMENT_ADDED,
        workspaceId: primary.workspaceId,
      },
    });

    const invalidEvent = await prisma.outboxEvent.create({
      data: {
        aggregateId: primary.issueIds[0],
        aggregateType: 'ISSUE',
        eventType: 'COMMENT_ADDED',
        payload: { commentId: secondIssueCommentId, schemaVersion: 1 },
        workspaceId: primary.workspaceId,
      },
    });
    await expect(
      prisma.notification.create({
        data: {
          commentId: secondIssueCommentId,
          eventId: invalidEvent.id,
          issueId: primary.issueIds[0],
          recipientMembershipId: primary.membershipId,
          type: NotificationType.COMMENT_ADDED,
          workspaceId: primary.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });
});
