import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import {
  IssueFileKind,
  IssuePriority,
  IssueStatus,
  MembershipStatus,
  Prisma,
} from '@rivet/database';
import {
  ISSUE_CHANGED,
  ISSUE_CHANGED_SCHEMA_VERSION,
  ISSUE_CREATED,
  ISSUE_CREATED_SCHEMA_VERSION,
  ISSUE_PURGE_SCHEDULED,
  ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION,
  type IssueChangedField,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import {
  assertActiveMentionMemberships,
  type ParsedOptionalMarkdown,
  parseOptionalMarkdown,
} from '../../common/validation/markdown';
import { FilesService } from '../files/files.service';
import type {
  CreateIssueDto,
  IssueStatusAction,
  UpdateIssueDto,
} from './dto/issue-request.dto';
import type {
  CreateIssueResponseDto,
  UpdateIssueResponseDto,
} from './dto/issue-response.dto';
import type { IssueMutationContext } from './issue.context';
import {
  issueConflict as conflict,
  issueResourceNotFound as resourceNotFound,
  issueUnprocessable as unprocessable,
} from './issue.errors';
import { IssueRepository } from './issue.repository';
import { IssueAssignmentService } from './issue-assignment.service';
import { toIssueDetail, toTeamWorkSummary } from './issue-response.mapper';
import { IssueStatusService } from './issue-status.service';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class IssuesService {
  constructor(
    private readonly assignments: IssueAssignmentService,
    private readonly database: DatabaseService,
    private readonly files: FilesService,
    private readonly repository: IssueRepository,
    private readonly statuses: IssueStatusService,
  ) {}

  async create(
    context: IssueMutationContext,
    dto: CreateIssueDto,
  ): Promise<CreateIssueResponseDto> {
    const description = parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);
    return this.database.client.$transaction(async (transaction) => {
      const workspace = await transaction.workspace.findUnique({
        select: { nextIssueNumber: true },
        where: { id: context.workspaceId },
      });
      if (!workspace) resourceNotFound('워크스페이스를 찾을 수 없습니다.');
      await this.assertProject(transaction, context.workspaceId, dto.projectId);
      await this.assertActor(transaction, context.workspaceId, context.membershipId);
      await this.assertLabels(transaction, context.workspaceId, dto.labelIds ?? []);
      await assertActiveMentionMemberships(
        transaction,
        context.workspaceId,
        description.mentionedMembershipIds,
      );
      await transaction.workspace.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: context.workspaceId },
      });
      const issue = await transaction.issue.create({
        data: {
          createdByMembershipId: context.membershipId,
          descriptionMarkdown: description.bodyMarkdown,
          identifier: `F-${workspace.nextIssueNumber}`,
          priority: dto.priority ?? IssuePriority.NONE,
          projectId: dto.projectId,
          sequenceNumber: workspace.nextIssueNumber,
          title: dto.title,
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      });
      await transaction.issueSubscription.create({
        data: {
          issueId: issue.id,
          membershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });
      if ((dto.labelIds ?? []).length)
        await transaction.issueLabel.createMany({
          data: [...new Set(dto.labelIds)].map((labelId) => ({
            issueId: issue.id,
            labelId,
            workspaceId: context.workspaceId,
          })),
        });
      await this.syncDescription(transaction, context, issue.id, description);
      await this.files.attachIssueFiles(
        transaction,
        context,
        issue.id,
        dto.attachmentFileIds ?? [],
      );
      const createdTeamWorks = await this.assignments.createInitialTeamWorks(
        transaction,
        context,
        issue.id,
        dto.projectId,
        dto.initialRoles ?? [],
      );
      await this.statuses.recalculate(transaction, context.workspaceId, issue.id);
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { identifier: `F-${workspace.nextIssueNumber}`, title: dto.title },
          eventType: 'ISSUE_CREATED',
          issueId: issue.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issue.id,
          aggregateType: 'ISSUE',
          eventType: ISSUE_CREATED,
          id: eventId,
          payload: {
            issueId: issue.id,
            mentionedMembershipIds: description.mentionedMembershipIds,
            schemaVersion: ISSUE_CREATED_SCHEMA_VERSION,
          },
          workspaceId: context.workspaceId,
        },
      });
      const row = await this.repository.findIssue(transaction, context.workspaceId, issue.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId,
        resourceId: issue.id,
        resourceType: 'ISSUE',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      return {
        createdTeamWorks: createdTeamWorks.map(toTeamWorkSummary),
        issue: toIssueDetail(row),
      };
    });
  }

  async update(
    context: IssueMutationContext,
    issueId: string,
    dto: UpdateIssueDto,
  ): Promise<UpdateIssueResponseDto> {
    if (
      dto.title === undefined &&
      dto.descriptionMarkdown === undefined &&
      dto.priority === undefined &&
      dto.labelIds === undefined &&
      dto.statusAction === undefined
    ) {
      unprocessable('ISSUE_CHANGE_REQUIRED', '변경할 이슈 필드가 필요합니다.');
    }
    const description =
      dto.descriptionMarkdown === undefined
        ? undefined
        : parseOptionalMarkdown(dto.descriptionMarkdown, 100_000);
    return this.database.client.$transaction(async (transaction) => {
      const current = await this.repository.findIssue(transaction, context.workspaceId, issueId);
      if (current.version !== dto.version)
        conflict('ISSUE_VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', current.version);
      if (dto.statusAction === 'COMPLETE' && current.status !== IssueStatus.REVIEW)
        conflict(
          'ISSUE_COMPLETION_NOT_READY',
          '모든 팀 작업이 완료되어 검토 상태여야 이슈를 완료할 수 있습니다.',
        );
      await this.assertLabels(transaction, context.workspaceId, dto.labelIds ?? []);
      if (description)
        await assertActiveMentionMemberships(
          transaction,
          context.workspaceId,
          description.mentionedMembershipIds,
        );
      let status = dto.statusAction
        ? this.statusFromAction(dto.statusAction, current.status)
        : undefined;
      const changed = await transaction.issue.updateMany({
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(description ? { descriptionMarkdown: description.bodyMarkdown } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(status ? { status } : {}),
          version: { increment: 1 },
        },
        where: { id: issueId, version: dto.version, workspaceId: context.workspaceId },
      });
      if (changed.count !== 1)
        conflict('ISSUE_VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', current.version);
      if (dto.labelIds) {
        await transaction.issueLabel.deleteMany({ where: { issueId } });
        if (dto.labelIds.length)
          await transaction.issueLabel.createMany({
            data: [...new Set(dto.labelIds)].map((labelId) => ({
              issueId,
              labelId,
              workspaceId: context.workspaceId,
            })),
          });
      }
      if (description) await this.syncDescription(transaction, context, issueId, description);
      if (dto.statusAction === 'RESUME' || dto.statusAction === 'REOPEN') {
        status = await this.statuses.recalculate(transaction, context.workspaceId, issueId);
      }
      const valueChanges: Array<{
        after: Prisma.InputJsonValue;
        before: Prisma.InputJsonValue;
        field: string;
      } | null> = [
        dto.title !== undefined && dto.title !== current.title
          ? { after: dto.title, before: current.title, field: 'title' }
          : null,
        dto.priority !== undefined && dto.priority !== current.priority
          ? { after: dto.priority, before: current.priority, field: 'priority' }
          : null,
        status !== undefined && status !== current.status
          ? { after: status, before: current.status, field: 'status' }
          : null,
      ];
      const otherFieldsChanged = Boolean(description) || Boolean(dto.labelIds);
      const nonNullValueChanges = valueChanges.filter(
        (change): change is NonNullable<(typeof valueChanges)[number]> => change !== null,
      );
      // 변경 필드가 하나뿐일 때만 활동에 전후 값을 기록한다. 여러 필드가 함께 바뀌면
      // 어느 값이 대표인지 추측하지 않고 일반 라벨로 남긴다.
      const singleChange =
        !otherFieldsChanged && nonNullValueChanges.length === 1 ? nonNullValueChanges[0] : null;
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          ...(singleChange
            ? {
                afterData: singleChange.after,
                beforeData: singleChange.before,
                fieldName: singleChange.field,
              }
            : {}),
          eventType: 'ISSUE_CHANGED',
          issueId,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      const changedFields = [
        dto.title !== undefined ? 'TITLE' : null,
        description ? 'DESCRIPTION' : null,
        dto.priority !== undefined ? 'PRIORITY' : null,
        status ? 'STATUS' : null,
        dto.labelIds ? 'LABELS' : null,
      ].filter((field): field is IssueChangedField => field !== null);
      const terminalCategory =
        status === IssueStatus.DONE
          ? ('COMPLETED' as const)
          : status === IssueStatus.CANCELED
            ? ('CANCELED' as const)
            : null;
      const subscriberMembershipIds = terminalCategory
        ? (
            await transaction.issueSubscription.findMany({
              orderBy: { membershipId: 'asc' },
              select: { membershipId: true },
              where: { issueId, workspaceId: context.workspaceId },
            })
          ).map(({ membershipId }) => membershipId)
        : [];
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issueId,
          aggregateType: 'ISSUE',
          eventType: ISSUE_CHANGED,
          id: eventId,
          payload: {
            changedFields,
            issueId,
            mentionedMembershipIds: description?.mentionedMembershipIds ?? [],
            schemaVersion: ISSUE_CHANGED_SCHEMA_VERSION,
            subscriberMembershipIds,
            terminalCategory,
          },
          workspaceId: context.workspaceId,
        },
      });
      const updated = await this.repository.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId,
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      return toIssueDetail(updated);
    });
  }

  async trash(context: IssueMutationContext, issueId: string, version: number): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const current = await transaction.issue.findFirst({
        select: { id: true, version: true },
        where: { deletedAt: null, id: issueId, workspaceId: context.workspaceId },
      });
      if (!current) resourceNotFound();
      if (current.version !== version)
        conflict('ISSUE_VERSION_CONFLICT', '이슈가 다른 요청에서 변경되었습니다.', current.version);
      const deletedAt = new Date();
      const purgeAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await transaction.issue.update({
        data: {
          deletedAt,
          deletedByMembershipId: context.membershipId,
          purgeAt,
          version: { increment: 1 },
        },
        where: { id: issueId },
      });
      await transaction.teamWork.updateMany({
        data: { deletedAt },
        where: { issueId, workspaceId: context.workspaceId },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: issueId,
          aggregateType: 'ISSUE',
          eventType: ISSUE_PURGE_SCHEDULED,
          id: eventId,
          payload: {
            issueId,
            purgeAt: purgeAt.toISOString(),
            schemaVersion: ISSUE_PURGE_SCHEDULED_SCHEMA_VERSION,
          },
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        eventId,
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: version + 1,
        workspaceId: context.workspaceId,
      });
    });
  }

  private statusFromAction(action: IssueStatusAction, current: IssueStatus): IssueStatus {
    const active =
      current === IssueStatus.UNSORTED ||
      current === IssueStatus.TODO ||
      current === IssueStatus.IN_PROGRESS ||
      current === IssueStatus.REVIEW;
    if (action === 'PAUSE' && active) return IssueStatus.PAUSED;
    if (action === 'RESUME' && current === IssueStatus.PAUSED) return IssueStatus.UNSORTED;
    if (action === 'CANCEL' && current !== IssueStatus.CANCELED && current !== IssueStatus.DONE)
      return IssueStatus.CANCELED;
    if (action === 'COMPLETE' && current === IssueStatus.REVIEW) return IssueStatus.DONE;
    if (action === 'REOPEN' && (current === IssueStatus.DONE || current === IssueStatus.CANCELED))
      return IssueStatus.UNSORTED;
    unprocessable(
      'ISSUE_STATUS_ACTION_INVALID',
      '현재 이슈 상태에서 실행할 수 없는 상태 행동입니다.',
    );
  }

  private async assertActor(
    transaction: Transaction,
    workspaceId: string,
    membershipId: string,
  ): Promise<void> {
    const actor = await transaction.workspaceMembership.findFirst({
      select: { id: true },
      where: { id: membershipId, status: MembershipStatus.ACTIVE, workspaceId },
    });
    if (!actor)
      throw new ApiError({
        code: 'FORBIDDEN',
        message: '활성 멤버십이 필요합니다.',
        status: HttpStatus.FORBIDDEN,
      });
  }

  private async assertProject(
    transaction: Transaction,
    workspaceId: string,
    projectId: string,
  ): Promise<void> {
    const project = await transaction.project.findFirst({
      select: { id: true },
      where: { archivedAt: null, deletedAt: null, id: projectId, workspaceId },
    });
    if (!project) resourceNotFound('프로젝트를 찾을 수 없습니다.');
  }

  private async assertLabels(
    transaction: Transaction,
    workspaceId: string,
    labelIds: string[],
  ): Promise<void> {
    const ids = [...new Set(labelIds)];
    if (!ids.length) return;
    const count = await transaction.label.count({
      where: { archivedAt: null, id: { in: ids }, workspaceId },
    });
    if (count !== ids.length) resourceNotFound('라벨을 찾을 수 없습니다.');
  }

  private async syncDescription(
    transaction: Transaction,
    context: IssueMutationContext,
    issueId: string,
    description: ParsedOptionalMarkdown,
  ): Promise<void> {
    await transaction.mention.deleteMany({
      where: { commentId: null, issueId, workspaceId: context.workspaceId },
    });
    if (description.mentionedMembershipIds.length)
      await transaction.mention.createMany({
        data: description.mentionedMembershipIds.map((mentionedMembershipId) => ({
          issueId,
          mentionedMembershipId,
          workspaceId: context.workspaceId,
        })),
      });
    await this.files.syncBodyImages(
      transaction,
      context,
      issueId,
      IssueFileKind.DESCRIPTION_IMAGE,
      description.fileIds,
    );
  }
}
