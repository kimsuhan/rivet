import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  HandoffKind,
  IssueFileKind,
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import {
  COMMENT_CREATED,
  COMMENT_MENTIONS_ADDED,
  ISSUE_CHANGED,
  ISSUE_CREATED,
} from '@rivet/event-contracts';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken } from '../src/modules/auth/auth-token';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH = 'integration-password-hash';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function handoffBody(summary: string): string {
  return [
    '## 변경 요약',
    summary,
    '## API 명세 링크',
    'https://api.example.com/openapi.json',
    '## 사용 가능 환경',
    '개발 환경',
    '## 추가·변경 API',
    'POST /sessions',
    '## 요청·응답 변경',
    '응답 필드를 추가했습니다.',
    '## 오류·권한',
    '기존 인증 정책을 유지합니다.',
    '## 프론트 주의사항',
    '새 필드를 점진적으로 사용합니다.',
  ].join('\n\n');
}

describe('M5 issue Markdown and comments', () => {
  const runId = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let app: INestApplication;
  let database: DatabaseService;
  let workspaceId: string;
  let teamId: string;
  let backendIssueId: string;
  let actorMembershipId: string;
  let firstMentionMembershipId: string;
  let secondMentionMembershipId: string;
  let inactiveMembershipId: string;
  let foreignMembershipId: string;
  let actorCookie: string;
  let actorCsrf: string;
  let otherCookie: string;
  let otherCsrf: string;
  let foreignCookie: string;
  let foreignCsrf: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);

    const fixture = await database.client.$transaction(async (transaction) => {
      const users = [];
      for (const [displayName, suffix] of [
        ['작성자', 'actor'],
        ['멘션 A', 'mention-a'],
        ['멘션 B', 'mention-b'],
        ['비활성', 'inactive'],
        ['다른 워크스페이스', 'foreign'],
      ] as const) {
        const email = `m5.collaboration.${suffix}.${runId}@example.com`;
        users.push(
          await transaction.user.create({
            data: {
              displayName,
              email,
              emailVerifiedAt: new Date(),
              normalizedEmail: email,
              passwordHash: PASSWORD_HASH,
            },
            select: { id: true },
          }),
        );
      }
      const [actor, firstMention, secondMention, inactive, foreign] = users;
      if (!actor || !firstMention || !secondMention || !inactive || !foreign) {
        throw new Error('M5 협업 테스트 사용자가 부족합니다.');
      }

      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: actor.id,
          name: 'M5 협업 워크스페이스',
          normalizedSlug: `m5-collaboration-${runId}`,
          slug: `m5-collaboration-${runId}`,
        },
        select: { id: true },
      });
      const foreignWorkspace = await transaction.workspace.create({
        data: {
          createdByUserId: foreign.id,
          name: 'M5 다른 워크스페이스',
          normalizedSlug: `m5-collaboration-foreign-${runId}`,
          slug: `m5-collaboration-foreign-${runId}`,
        },
        select: { id: true },
      });
      const actorMembership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.ADMIN, userId: actor.id, workspaceId: workspace.id },
        select: { id: true },
      });
      const firstMembership = await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.MEMBER,
          userId: firstMention.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const secondMembership = await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.MEMBER,
          userId: secondMention.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const inactiveMembership = await transaction.workspaceMembership.create({
        data: {
          deactivatedAt: new Date(),
          role: MembershipRole.MEMBER,
          status: MembershipStatus.INACTIVE,
          userId: inactive.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const foreignMembership = await transaction.workspaceMembership.create({
        data: {
          role: MembershipRole.ADMIN,
          userId: foreign.id,
          workspaceId: foreignWorkspace.id,
        },
        select: { id: true },
      });

      const team = await transaction.team.create({
        data: {
          key: 'COL',
          name: 'M5 협업 팀',
          normalizedName: 'm5 협업 팀',
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      await transaction.teamMember.createMany({
        data: [actorMembership.id, firstMembership.id, secondMembership.id].map((membershipId) => ({
          membershipId,
          teamId: team.id,
          workspaceId: workspace.id,
        })),
      });
      const state = await transaction.workflowState.create({
        data: {
          category: StateCategory.BACKLOG,
          isDefault: true,
          name: '백로그',
          normalizedName: '백로그',
          position: 0,
          teamId: team.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });
      const project = await transaction.project.create({
        data: { name: 'M5 협업 프로젝트', workspaceId: workspace.id },
        select: { id: true },
      });
      await transaction.projectRoleTeam.create({
        data: {
          projectId: project.id,
          role: ProjectRole.BACKEND,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      const backendIssue = await transaction.issue.create({
        data: {
          createdByMembershipId: actorMembership.id,
          identifier: 'COL-50',
          projectId: project.id,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 50,
          teamId: team.id,
          title: '작업 전달 이미지',
          type: IssueType.TEAM_TASK,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
        select: { id: true },
      });

      return {
        actorMembershipId: actorMembership.id,
        actorUserId: actor.id,
        backendIssueId: backendIssue.id,
        firstMentionMembershipId: firstMembership.id,
        firstMentionUserId: firstMention.id,
        foreignMembershipId: foreignMembership.id,
        foreignUserId: foreign.id,
        foreignWorkspaceId: foreignWorkspace.id,
        inactiveMembershipId: inactiveMembership.id,
        secondMentionMembershipId: secondMembership.id,
        teamId: team.id,
        userIds: users.map(({ id }) => id),
        workspaceId: workspace.id,
      };
    });

    userIds.push(...fixture.userIds);
    workspaceIds.push(fixture.workspaceId, fixture.foreignWorkspaceId);
    workspaceId = fixture.workspaceId;
    teamId = fixture.teamId;
    backendIssueId = fixture.backendIssueId;
    actorMembershipId = fixture.actorMembershipId;
    firstMentionMembershipId = fixture.firstMentionMembershipId;
    secondMentionMembershipId = fixture.secondMentionMembershipId;
    inactiveMembershipId = fixture.inactiveMembershipId;
    foreignMembershipId = fixture.foreignMembershipId;

    const sessions = app.get(AuthSessionService);
    const [actorSession, otherSession, foreignSession] = await Promise.all([
      sessions.create(fixture.actorUserId),
      sessions.create(fixture.firstMentionUserId),
      sessions.create(fixture.foreignUserId),
    ]);
    actorCookie = `rivet_session=${actorSession.token}`;
    actorCsrf = createCsrfToken(actorSession.token, CSRF_HMAC_KEY);
    otherCookie = `rivet_session=${otherSession.token}`;
    otherCsrf = createCsrfToken(otherSession.token, CSRF_HMAC_KEY);
    foreignCookie = `rivet_session=${foreignSession.token}`;
    foreignCsrf = createCsrfToken(foreignSession.token, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      await database.client.notification.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.outboxEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.activityEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.mention.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issueFileAttachment.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.comment.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.apiHandoff.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issueSubscription.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.issueLabel.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.issue.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.file.deleteMany({ where: { uploadedByUserId: { in: userIds } } });
      await database.client.projectRoleTeam.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  async function upload(bytes: Buffer, filename: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .field('scope', 'WORKSPACE')
      .attach('file', bytes, filename)
      .expect(201);
    return response.body.id as string;
  }

  it('설명·댓글·작업 전달의 멘션, 파일, Outbox와 타임라인을 원자적으로 유지한다', async () => {
    const descriptionImageId = await upload(PNG, 'description.png');
    const attachmentFileId = await upload(Buffer.from('attachment'), 'contract.txt');
    const descriptionMarkdown =
      `@[Mention A](rivet-member:${firstMentionMembershipId})\n\n` +
      `![description](/files/${descriptionImageId})`;
    const createdIssue = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({
        attachmentFileIds: [attachmentFileId],
        descriptionMarkdown,
        teamId,
        title: 'M5 협업 이슈',
        type: IssueType.TEAM_TASK,
      })
      .expect(201);
    const issueId = createdIssue.body.id as string;
    expect(createdIssue.body).toMatchObject({
      attachments: [
        {
          file: { id: attachmentFileId, linked: true },
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          uploader: { avatarFileId: null },
        },
      ],
      descriptionMarkdown,
      version: 1,
    });
    const issueCreatedOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: issueId, eventType: ISSUE_CREATED },
    });
    expect(issueCreatedOutbox.payload).toEqual({
      assigneeMembershipId: null,
      issueId,
      mentionedMembershipIds: [firstMentionMembershipId],
      schemaVersion: 1,
    });
    expect(JSON.stringify(issueCreatedOutbox.payload)).not.toMatch(
      /body|description|email|filename|title/iu,
    );

    const rollbackFileId = await upload(PNG, 'rollback.png');
    const issueCountBeforeInvalid = await database.client.issue.count({ where: { workspaceId } });
    const invalidIssue = await request(app.getHttpServer())
      .post('/api/v1/issues')
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({
        attachmentFileIds: [rollbackFileId],
        descriptionMarkdown: `@[Foreign](rivet-member:${foreignMembershipId})`,
        teamId,
        title: '롤백되어야 하는 이슈',
        type: IssueType.TEAM_TASK,
      })
      .expect(422);
    expect(invalidIssue.body.code).toBe('MENTION_INVALID');
    await expect(database.client.issue.count({ where: { workspaceId } })).resolves.toBe(
      issueCountBeforeInvalid,
    );
    await expect(
      database.client.file.findUniqueOrThrow({
        select: { issueAttachments: true, unlinkedAt: true },
        where: { id: rollbackFileId },
      }),
    ).resolves.toMatchObject({ issueAttachments: [], unlinkedAt: expect.any(Date) });

    await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}/timeline`)
      .set('Cookie', foreignCookie)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueId}/comments`)
      .set('Cookie', foreignCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', foreignCsrf)
      .send({ bodyMarkdown: '다른 워크스페이스' })
      .expect(404);

    const commentImageId = await upload(PNG, 'comment.png');
    const commentBody =
      `@[Mention A](rivet-member:${firstMentionMembershipId})\n\n` +
      `![comment](/files/${commentImageId})`;
    const createdComment = await request(app.getHttpServer())
      .post(`/api/v1/issues/${issueId}/comments`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({ bodyMarkdown: commentBody })
      .expect(201);
    const commentId = createdComment.body.id as string;
    expect(createdComment.body).toMatchObject({
      author: { id: actorMembershipId, user: { avatarFileId: null } },
      bodyMarkdown: commentBody,
      deletedAt: null,
      version: 1,
    });
    const commentCreatedOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: commentId, eventType: COMMENT_CREATED },
    });
    expect(commentCreatedOutbox.payload).toEqual({
      commentId,
      hasMention: true,
      issueId,
      mentionedMembershipIds: [firstMentionMembershipId],
      schemaVersion: 1,
      subscriberMembershipIds: [actorMembershipId, firstMentionMembershipId].sort(),
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/comments/${commentId}`)
      .set('Cookie', otherCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherCsrf)
      .send({ bodyMarkdown: '탈인 수정', version: 1 })
      .expect(403);
    const staleEdit = await request(app.getHttpServer())
      .patch(`/api/v1/comments/${commentId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({ bodyMarkdown: '오래된 수정', version: 99 })
      .expect(409);
    expect(staleEdit.body).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 });

    const nextCommentImageId = await upload(PNG, 'comment-next.png');
    const updatedBody =
      `@[Mention B](rivet-member:${secondMentionMembershipId})\n\n` +
      `![comment next](/files/${nextCommentImageId})`;
    const updatedComment = await request(app.getHttpServer())
      .patch(`/api/v1/comments/${commentId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({ bodyMarkdown: updatedBody, version: 1 })
      .expect(200);
    expect(updatedComment.body).toMatchObject({ bodyMarkdown: updatedBody, version: 2 });
    const mentionsAddedOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: commentId, eventType: COMMENT_MENTIONS_ADDED },
    });
    expect(mentionsAddedOutbox.payload).toEqual({
      commentId,
      issueId,
      mentionedMembershipIds: [secondMentionMembershipId],
      schemaVersion: 1,
    });
    await expect(
      database.client.issueFileAttachment.findMany({
        orderBy: { fileId: 'asc' },
        select: { fileId: true, kind: true },
        where: { commentId, issueId, workspaceId },
      }),
    ).resolves.toEqual([{ fileId: nextCommentImageId, kind: IssueFileKind.COMMENT_IMAGE }]);
    await expect(
      database.client.file.findUniqueOrThrow({
        select: { unlinkedAt: true },
        where: { id: commentImageId },
      }),
    ).resolves.toEqual({ unlinkedAt: expect.any(Date) });

    const inactiveMention = await request(app.getHttpServer())
      .patch(`/api/v1/comments/${commentId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({
        bodyMarkdown: `@[Inactive](rivet-member:${inactiveMembershipId})`,
        version: 2,
      })
      .expect(422);
    expect(inactiveMention.body.code).toBe('MENTION_INVALID');
    await expect(
      database.client.comment.findUniqueOrThrow({
        select: { version: true },
        where: { id: commentId },
      }),
    ).resolves.toEqual({ version: 2 });

    const nextDescription = `@[Mention B](rivet-member:${secondMentionMembershipId})`;
    const updatedIssue = await request(app.getHttpServer())
      .patch(`/api/v1/issues/${issueId}`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({ descriptionMarkdown: nextDescription, version: 1 })
      .expect(200);
    expect(updatedIssue.body).toMatchObject({ descriptionMarkdown: nextDescription, version: 2 });
    const issueChangedOutbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: issueId, eventType: ISSUE_CHANGED },
    });
    expect(issueChangedOutbox.payload).toEqual({
      assigneeMembershipId: null,
      changedFields: ['DESCRIPTION'],
      issueId,
      mentionedMembershipIds: [secondMentionMembershipId],
      schemaVersion: 1,
      subscriberMembershipIds: [],
      terminalCategory: null,
    });

    const timelineIds: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const timeline = await request(app.getHttpServer())
        .get(`/api/v1/issues/${issueId}/timeline`)
        .query({ ...(cursor ? { cursor } : {}), limit: 1, sortDirection: 'asc' })
        .set('Cookie', actorCookie)
        .expect(200);
      const item = timeline.body.items[0] as
        | { activity: { id: string }; type: 'ACTIVITY' }
        | { comment: { id: string }; type: 'COMMENT' }
        | { handoff: { id: string }; type: 'HANDOFF' }
        | undefined;
      if (item) {
        timelineIds.push(
          item.type === 'ACTIVITY'
            ? `ACTIVITY:${item.activity.id}`
            : item.type === 'COMMENT'
              ? `COMMENT:${item.comment.id}`
              : `HANDOFF:${item.handoff.id}`,
        );
      }
      cursor = timeline.body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(timelineIds).toContain(`COMMENT:${commentId}`);
    expect(new Set(timelineIds).size).toBe(timelineIds.length);

    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${commentId}`)
      .query({ version: 2 })
      .set('Cookie', otherCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherCsrf)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${commentId}`)
      .query({ version: 1 })
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${commentId}`)
      .query({ version: 2 })
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .expect(204);
    const deletedTimeline = await request(app.getHttpServer())
      .get(`/api/v1/issues/${issueId}/timeline`)
      .query({ limit: 100, sortDirection: 'asc' })
      .set('Cookie', actorCookie)
      .expect(200);
    expect(deletedTimeline.body.items).toContainEqual(
      expect.objectContaining({
        comment: expect.objectContaining({
          bodyMarkdown: null,
          deletedAt: expect.any(String),
          id: commentId,
        }),
        type: 'COMMENT',
      }),
    );
    await expect(database.client.mention.count({ where: { commentId } })).resolves.toBe(0);

    const handoffImageId = await upload(PNG, 'handoff.png');
    const createdHandoff = await request(app.getHttpServer())
      .post(`/api/v1/issues/${backendIssueId}/handoffs`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({
        bodyMarkdown: handoffBody(`계약을 추가했습니다.\n\n![handoff](/files/${handoffImageId})`),
        kind: HandoffKind.INITIAL,
      })
      .expect(201);
    await expect(
      database.client.issueFileAttachment.findFirst({
        select: { apiHandoffId: true, fileId: true, kind: true },
        where: { apiHandoffId: createdHandoff.body.id as string },
      }),
    ).resolves.toEqual({
      apiHandoffId: createdHandoff.body.id,
      fileId: handoffImageId,
      kind: IssueFileKind.HANDOFF_IMAGE,
    });
    const invalidHandoffMention = await request(app.getHttpServer())
      .post(`/api/v1/issues/${backendIssueId}/handoffs`)
      .set('Cookie', actorCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', actorCsrf)
      .send({
        bodyMarkdown: handoffBody(`@[Mention A](rivet-member:${firstMentionMembershipId})`),
        kind: HandoffKind.FOLLOW_UP,
      })
      .expect(422);
    expect(invalidHandoffMention.body.code).toBe('MARKDOWN_INVALID');
    await expect(
      database.client.apiHandoff.count({ where: { issueId: backendIssueId } }),
    ).resolves.toBe(1);
  });
});
