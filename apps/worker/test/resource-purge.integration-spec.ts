import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import {
  FileScope,
  IssueFileKind,
  IssueType,
  MembershipRole,
  ProjectRole,
  StateCategory,
} from '@rivet/database';
import {
  ISSUE_PURGE_SCHEDULED,
  type IssuePurgeScheduledOutboxPayload,
  PROJECT_PURGE_SCHEDULED,
  type ProjectPurgeScheduledOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { workerConfig } from '../src/config/worker.config';
import { ResourcePurgeHandler } from '../src/modules/outbox/handlers/resource-purge.handler';
import type { ClaimedOutboxEvent } from '../src/modules/outbox/outbox.types';
import { CanceledOutboxError, RetryableOutboxError } from '../src/modules/outbox/outbox-errors';

describe('resource purge integration', () => {
  const runId = randomUUID().slice(0, 8);
  const deletedAt = new Date('2026-06-01T00:00:00.000Z');
  const purgeAt = new Date('2026-07-01T00:00:00.000Z');
  let context: INestApplicationContext;
  let database: DatabaseService;
  let handler: ResourcePurgeHandler;
  let userId: string;
  let workspaceId: string;
  let membershipId: string;
  let teamId: string;
  let stateId: string;
  let issueId: string;
  let restoredIssueId: string;
  let fileId: string;
  let blockedProjectId: string;
  let emptyProjectId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }), DatabaseModule],
      providers: [ResourcePurgeHandler],
    }).compile();
    context = module;
    await context.init();
    database = context.get(DatabaseService);
    handler = context.get(ResourcePurgeHandler);

    const fixture = await database.client.$transaction(async (transaction) => {
      const email = `m7.purge.${runId}@example.com`;
      const user = await transaction.user.create({
        data: {
          displayName: 'M7 영구 삭제 관리자',
          email,
          normalizedEmail: email,
          passwordHash: '$argon2id$m7-worker-fixture',
        },
      });
      const workspace = await transaction.workspace.create({
        data: {
          createdByUserId: user.id,
          name: 'M7 영구 삭제 워크스페이스',
          normalizedSlug: `m7-purge-${runId}`,
          slug: `m7-purge-${runId}`,
        },
      });
      const membership = await transaction.workspaceMembership.create({
        data: { role: MembershipRole.ADMIN, userId: user.id, workspaceId: workspace.id },
      });
      const team = await transaction.team.create({
        data: {
          key: 'PGE',
          name: '영구 삭제 팀',
          normalizedName: '영구 삭제 팀',
          workspaceId: workspace.id,
        },
      });
      await transaction.teamMember.create({
        data: { membershipId: membership.id, teamId: team.id, workspaceId: workspace.id },
      });
      const state = await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId: team.id,
          workspaceId: workspace.id,
        },
      });
      const issue = await transaction.issue.create({
        data: {
          createdByMembershipId: membership.id,
          deletedAt,
          deletedByMembershipId: membership.id,
          identifier: 'PGE-1',
          purgeAt,
          sequenceNumber: 1,
          teamId: team.id,
          title: '영구 삭제 대상',
          type: IssueType.TEAM_TASK,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
      });
      const restoredIssue = await transaction.issue.create({
        data: {
          createdByMembershipId: membership.id,
          identifier: 'PGE-2',
          sequenceNumber: 2,
          teamId: team.id,
          title: '이미 복구된 대상',
          type: IssueType.TEAM_TASK,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
      });
      const file = await transaction.file.create({
        data: {
          detectedMimeType: 'text/plain',
          originalName: 'purge.txt',
          scope: FileScope.WORKSPACE,
          sizeBytes: 10n,
          storageKey: `objects/${randomUUID()}`,
          uploadedByUserId: user.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.issueFileAttachment.create({
        data: {
          createdByMembershipId: membership.id,
          fileId: file.id,
          issueId: issue.id,
          kind: IssueFileKind.ISSUE_ATTACHMENT,
          workspaceId: workspace.id,
        },
      });
      await transaction.comment.create({
        data: {
          authorMembershipId: membership.id,
          bodyMarkdown: '삭제될 댓글',
          issueId: issue.id,
          workspaceId: workspace.id,
        },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: membership.id,
          eventType: 'ISSUE_TRASHED',
          issueId: issue.id,
          workspaceId: workspace.id,
        },
      });

      const blockedProject = await transaction.project.create({
        data: {
          deletedAt,
          deletedByMembershipId: membership.id,
          name: '참조가 생긴 프로젝트',
          purgeAt,
          workspaceId: workspace.id,
        },
      });
      const emptyProject = await transaction.project.create({
        data: {
          deletedAt,
          deletedByMembershipId: membership.id,
          name: '빈 프로젝트',
          purgeAt,
          workspaceId: workspace.id,
        },
      });
      await transaction.projectRoleTeam.createMany({
        data: [blockedProject.id, emptyProject.id].map((projectId) => ({
          projectId,
          role: ProjectRole.BACKEND,
          teamId: team.id,
          workspaceId: workspace.id,
        })),
      });
      await transaction.issue.create({
        data: {
          createdByMembershipId: membership.id,
          identifier: 'PGE-3',
          projectId: blockedProject.id,
          projectRole: ProjectRole.BACKEND,
          sequenceNumber: 3,
          teamId: team.id,
          title: '프로젝트 삭제 차단 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId: state.id,
          workspaceId: workspace.id,
        },
      });
      return {
        blockedProjectId: blockedProject.id,
        emptyProjectId: emptyProject.id,
        fileId: file.id,
        issueId: issue.id,
        membershipId: membership.id,
        restoredIssueId: restoredIssue.id,
        stateId: state.id,
        teamId: team.id,
        userId: user.id,
        workspaceId: workspace.id,
      };
    });
    ({
      blockedProjectId,
      emptyProjectId,
      fileId,
      issueId,
      membershipId,
      restoredIssueId,
      stateId,
      teamId,
      userId,
      workspaceId,
    } = fixture);
  });

  afterAll(async () => {
    await database.client.notification.deleteMany({ where: { workspaceId } });
    await database.client.issueFileAttachment.deleteMany({ where: { workspaceId } });
    await database.client.comment.deleteMany({ where: { workspaceId } });
    await database.client.activityEvent.deleteMany({ where: { workspaceId } });
    await database.client.issue.deleteMany({ where: { workspaceId } });
    await database.client.projectRoleTeam.deleteMany({ where: { workspaceId } });
    await database.client.project.deleteMany({ where: { workspaceId } });
    await database.client.file.deleteMany({ where: { id: fileId } });
    await database.client.workflowState.deleteMany({ where: { id: stateId } });
    await database.client.teamMember.deleteMany({ where: { teamId } });
    await database.client.team.deleteMany({ where: { id: teamId } });
    await database.client.outboxEvent.deleteMany({ where: { workspaceId } });
    await database.client.workspaceMembership.deleteMany({ where: { id: membershipId } });
    await database.client.workspace.delete({ where: { id: workspaceId } });
    await database.client.user.delete({ where: { id: userId } });
    await context.close();
    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  function event(resourceId: string, resourceType: 'ISSUE' | 'PROJECT'): ClaimedOutboxEvent {
    return {
      actorMembershipId: membershipId,
      aggregateId: resourceId,
      aggregateType: resourceType,
      attemptCount: 1,
      availableAt: purgeAt,
      createdAt: deletedAt,
      eventType: resourceType === 'ISSUE' ? ISSUE_PURGE_SCHEDULED : PROJECT_PURGE_SCHEDULED,
      id: randomUUID(),
      payload: {},
      workspaceId,
    };
  }

  it('permanently deletes an issue in dependency order and starts file cleanup grace', async () => {
    const payload: IssuePurgeScheduledOutboxPayload = {
      issueId,
      purgeAt: purgeAt.toISOString(),
      schemaVersion: 1,
    };
    await handler.handleIssue(event(issueId, 'ISSUE'), payload);

    await expect(database.client.issue.findUnique({ where: { id: issueId } })).resolves.toBeNull();
    await expect(database.client.comment.count({ where: { issueId } })).resolves.toBe(0);
    const file = await database.client.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(file.unlinkedAt).not.toBeNull();
  });

  it('cancels a stale purge event after restore', async () => {
    await expect(
      handler.handleIssue(event(restoredIssueId, 'ISSUE'), {
        issueId: restoredIssueId,
        purgeAt: purgeAt.toISOString(),
        schemaVersion: 1,
      }),
    ).rejects.toEqual(new CanceledOutboxError('RESOURCE_PURGE_CANCELED'));
    await expect(
      database.client.issue.findUnique({ where: { id: restoredIssueId } }),
    ).resolves.not.toBeNull();
  });

  it('retries a project purge if any issue reference exists, including active rows', async () => {
    const payload: ProjectPurgeScheduledOutboxPayload = {
      projectId: blockedProjectId,
      purgeAt: purgeAt.toISOString(),
      schemaVersion: 1,
    };
    await expect(
      handler.handleProject(event(blockedProjectId, 'PROJECT'), payload),
    ).rejects.toEqual(new RetryableOutboxError('PROJECT_PURGE_BLOCKED'));
  });

  it('deletes an empty project and its owned role/activity rows', async () => {
    await handler.handleProject(event(emptyProjectId, 'PROJECT'), {
      projectId: emptyProjectId,
      purgeAt: purgeAt.toISOString(),
      schemaVersion: 1,
    });
    await expect(
      database.client.project.findUnique({ where: { id: emptyProjectId } }),
    ).resolves.toBeNull();
    await expect(
      database.client.projectRoleTeam.count({ where: { projectId: emptyProjectId } }),
    ).resolves.toBe(0);
  });
});
