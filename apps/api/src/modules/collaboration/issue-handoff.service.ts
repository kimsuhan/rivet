import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import {
  HandoffKind,
  IssueFileKind,
  MembershipStatus,
  Prisma,
  StateCategory,
} from '@rivet/database';
import {
  API_HANDOFF_CREATED,
  API_HANDOFF_CREATED_SCHEMA_VERSION,
  type ApiHandoffCreatedOutboxPayload,
  TEAM_WORK_CREATED,
  TEAM_WORK_CREATED_SCHEMA_VERSION,
  type TeamWorkCreatedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import {
  assertActiveMentionMemberships,
  type ParsedMarkdown,
  parseMarkdown,
} from '../../common/validation/markdown';
import { FilesService } from '../files/files.service';
import type { CreateIssueHandoffDto } from './dto/issue-collaboration-request.dto';
import type { HandoffResourceResponseDto } from './dto/issue-collaboration-response.dto';
import type { IssueCollaborationContext as Context } from './issue-collaboration.context';
import {
  collaborationConflict as conflict,
  collaborationResourceNotFound as resourceNotFound,
  collaborationUnprocessable as unprocessable,
} from './issue-collaboration.errors';
import { IssueCollaborationLockService } from './issue-collaboration-lock.service';
import { toCollaborationMemberResponse as toMemberResponse } from './issue-collaboration-response.mapper';

const TERMINAL_CATEGORIES = [StateCategory.COMPLETED, StateCategory.CANCELED] as const;

type Transaction = Prisma.TransactionClient;

function parseHandoffMarkdown(value: string): ParsedMarkdown {
  const bodyMarkdown = value.normalize('NFC').trim();
  if ([...bodyMarkdown].length > 50_000) {
    unprocessable('HANDOFF_CONTENT_REQUIRED', '작업 전달은 50,000자 이하여야 합니다.');
  }

  const hasUnsafeControlCharacter = [...bodyMarkdown].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
  if (
    hasUnsafeControlCharacter ||
    /<\/?[a-z][^>]*>/iu.test(bodyMarkdown) ||
    /\b(?:javascript|vbscript|data)\s*:/iu.test(bodyMarkdown)
  ) {
    unprocessable('MARKDOWN_INVALID', '안전하지 않은 Markdown은 저장할 수 없습니다.');
  }

  const parsed = parseMarkdown(bodyMarkdown, 50_000);
  if (parsed.bodyMarkdown.replace(/^#{1,6}[ \t].*$/gmu, '').trim().length === 0) {
    unprocessable('HANDOFF_CONTENT_REQUIRED', '작업 전달의 실제 변경 내용을 입력해 주세요.');
  }
  return parsed;
}

export function normalizeHandoffBodyMarkdown(value: string): string {
  return parseHandoffMarkdown(value).bodyMarkdown;
}

@Injectable()
export class IssueHandoffService {
  constructor(
    private readonly database: DatabaseService,
    private readonly files: FilesService,
    private readonly locks: IssueCollaborationLockService,
  ) {}

  async createHandoff(
    context: Context,
    teamWorkId: string,
    dto: CreateIssueHandoffDto,
  ): Promise<HandoffResourceResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await this.locks.lockWorkspace(transaction, context.workspaceId);
      await this.locks.lockActiveActor(transaction, context);
      return this.createHandoffInTransaction(transaction, context, teamWorkId, dto);
    });
  }

  async createHandoffInTransaction(
    transaction: Transaction,
    context: Context,
    teamWorkId: string,
    dto: {
      bodyMarkdown: string;
      destinationProjectTeamIds?: string[];
      kind: HandoffKind;
    },
  ): Promise<HandoffResourceResponseDto> {
    const markdown = parseHandoffMarkdown(dto.bodyMarkdown);
    const source = await this.locks.lockHandoffTeamWork(
      transaction,
      context.workspaceId,
      teamWorkId,
    );
    const sourceTeamMember = await transaction.teamMember.findFirst({
      select: { membershipId: true },
      where: {
        membership: { status: MembershipStatus.ACTIVE },
        membershipId: context.membershipId,
        teamId: source.teamId,
        workspaceId: context.workspaceId,
      },
    });
    if (!sourceTeamMember) {
      throw new ApiError({
        code: 'TEAM_WORK_TEAM_MEMBER_REQUIRED',
        message: '원본 팀의 활성 멤버만 작업 전달을 작성할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
    await assertActiveMentionMemberships(
      transaction,
      context.workspaceId,
      markdown.mentionedMembershipIds,
    );

    const handoffs = await transaction.apiHandoff.findMany({
      orderBy: { sequenceNumber: 'desc' },
      select: {
        id: true,
        kind: true,
        sequenceNumber: true,
        targets: { select: { teamWorkId: true } },
      },
      where: { sourceTeamWorkId: teamWorkId, workspaceId: context.workspaceId },
    });
    const hasInitial = handoffs.some(({ kind }) => kind === HandoffKind.INITIAL);
    if (dto.kind === HandoffKind.INITIAL && hasInitial) {
      conflict('INITIAL_HANDOFF_EXISTS', '최초 작업 전달이 이미 존재합니다.');
    }
    if (dto.kind === HandoffKind.FOLLOW_UP && !hasInitial) {
      conflict('INITIAL_HANDOFF_REQUIRED', '최초 작업 전달을 먼저 작성해 주세요.');
    }
    if (dto.kind === HandoffKind.INITIAL && source.category !== StateCategory.COMPLETED) {
      unprocessable(
        'HANDOFF_REQUIRES_COMPLETION',
        '최초 작업 전달은 원본 팀 작업 완료와 함께 작성해야 합니다.',
      );
    }

    const targetTeamWorkIds =
      dto.kind === HandoffKind.INITIAL
        ? await this.ensureHandoffTargets(
            transaction,
            context,
            source.issueId,
            source.projectId,
            source.projectTeamId,
            dto.destinationProjectTeamIds,
          )
        : [
            ...new Set(
              handoffs
                .find(({ kind }) => kind === HandoffKind.INITIAL)
                ?.targets.map(({ teamWorkId: targetId }) => targetId) ?? [],
            ),
          ].sort();
    if (dto.kind === HandoffKind.INITIAL && targetTeamWorkIds.length === 0) {
      unprocessable(
        'HANDOFF_DESTINATION_REQUIRED',
        '최초 작업 전달 대상 팀을 하나 이상 선택해 주세요.',
      );
    }

    const created = await transaction.apiHandoff.create({
      data: {
        authorMembershipId: context.membershipId,
        bodyMarkdown: markdown.bodyMarkdown,
        issueId: source.issueId,
        kind: dto.kind,
        sequenceNumber: (handoffs[0]?.sequenceNumber ?? 0) + 1,
        sourceTeamWorkId: teamWorkId,
        workspaceId: context.workspaceId,
      },
      select: {
        authorMembership: {
          select: {
            id: true,
            role: true,
            status: true,
            user: { select: { avatarFileId: true, displayName: true, id: true } },
          },
        },
        bodyMarkdown: true,
        createdAt: true,
        id: true,
        kind: true,
        sequenceNumber: true,
      },
    });
    if (targetTeamWorkIds.length > 0) {
      await transaction.apiHandoffTarget.createMany({
        data: targetTeamWorkIds.map((targetTeamWorkId) => ({
          handoffId: created.id,
          teamWorkId: targetTeamWorkId,
          workspaceId: context.workspaceId,
        })),
      });
    }
    if (markdown.mentionedMembershipIds.length > 0) {
      await transaction.mention.createMany({
        data: markdown.mentionedMembershipIds.map((mentionedMembershipId) => ({
          apiHandoffId: created.id,
          issueId: source.issueId,
          mentionedMembershipId,
          workspaceId: context.workspaceId,
        })),
      });
    }
    await this.files.syncBodyImages(
      transaction,
      context,
      source.issueId,
      IssueFileKind.HANDOFF_IMAGE,
      markdown.fileIds,
      { apiHandoffId: created.id },
    );
    const targets = await transaction.teamWork.findMany({
      orderBy: [{ team: { name: 'asc' } }, { identifier: 'asc' }, { id: 'asc' }],
      select: {
        assigneeMembershipId: true,
        team: {
          select: {
            teamMembers: {
              select: { membershipId: true },
              where: { membership: { status: MembershipStatus.ACTIVE } },
            },
          },
        },
      },
      where: { id: { in: targetTeamWorkIds }, workspaceId: context.workspaceId },
    });
    const subscriptions = await transaction.issueSubscription.findMany({
      select: { membershipId: true },
      where: { issueId: source.issueId, workspaceId: context.workspaceId },
    });
    const candidateRecipientMembershipIds = [
      ...new Set([
        ...targets.flatMap(({ assigneeMembershipId, team }) => [
          ...(assigneeMembershipId ? [assigneeMembershipId] : []),
          ...team.teamMembers.map(({ membershipId }) => membershipId),
        ]),
        ...subscriptions.map(({ membershipId }) => membershipId),
      ]),
    ]
      .filter((membershipId) => membershipId !== context.membershipId)
      .sort();
    if (markdown.mentionedMembershipIds.length > 0) {
      await transaction.issueSubscription.createMany({
        data: markdown.mentionedMembershipIds.map((membershipId) => ({
          issueId: source.issueId,
          membershipId,
          workspaceId: context.workspaceId,
        })),
        skipDuplicates: true,
      });
    }

    await transaction.activityEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        afterData: {
          targetTeamWorkIds,
          handoffId: created.id,
          kind: created.kind,
          sequenceNumber: created.sequenceNumber,
        },
        beforeData: Prisma.JsonNull,
        eventType: API_HANDOFF_CREATED,
        fieldName: 'handoff',
        issueId: source.issueId,
        teamWorkId,
        workspaceId: context.workspaceId,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: created.id,
        aggregateType: 'API_HANDOFF',
        eventType: API_HANDOFF_CREATED,
        payload: {
          candidateRecipientMembershipIds,
          targetTeamWorkIds,
          handoffId: created.id,
          issueId: source.issueId,
          kind: created.kind,
          mentionedMembershipIds: markdown.mentionedMembershipIds,
          schemaVersion: API_HANDOFF_CREATED_SCHEMA_VERSION,
          sourceTeamWorkId: teamWorkId,
        } satisfies ApiHandoffCreatedOutboxPayload,
        workspaceId: context.workspaceId,
      },
    });
    await notifyResourceChanged(transaction, {
      changeType: 'CREATED',
      resourceId: created.id,
      resourceType: 'HANDOFF',
      version: null,
      workspaceId: context.workspaceId,
    });

    return {
      author: toMemberResponse(created.authorMembership),
      bodyMarkdown: created.bodyMarkdown,
      createdAt: created.createdAt.toISOString(),
      id: created.id,
      issueId: source.issueId,
      kind: created.kind,
      sequenceNumber: created.sequenceNumber,
      sourceTeamWorkId: teamWorkId,
      targetTeamWorkIds,
    };
  }

  private async bumpTeamWorkVersions(
    transaction: Transaction,
    workspaceId: string,
    teamWorkIds: string[],
  ): Promise<void> {
    for (const teamWorkId of [...teamWorkIds].sort()) {
      const updated = await transaction.teamWork.update({
        data: { version: { increment: 1 } },
        select: { id: true, version: true },
        where: { id: teamWorkId },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: updated.id,
        resourceType: 'TEAM_WORK',
        version: updated.version,
        workspaceId,
      });
    }
  }

  private async ensureHandoffTargets(
    transaction: Transaction,
    context: Context,
    issueId: string,
    projectId: string,
    sourceProjectTeamId: string,
    requestedProjectTeamIds?: string[],
  ): Promise<string[]> {
    const requestedIds = [...new Set(requestedProjectTeamIds ?? [])].sort();
    if (requestedIds.length === 0) {
      unprocessable('HANDOFF_DESTINATION_REQUIRED', '전달 대상 팀을 하나 이상 선택해 주세요.');
    }
    if (requestedIds.includes(sourceProjectTeamId)) {
      unprocessable('HANDOFF_SELF_DESTINATION', '현재 팀에는 작업을 전달할 수 없습니다.');
    }

    const projectTeams = await transaction.projectTeam.findMany({
      orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
      select: { id: true, teamId: true },
      where: {
        id: { in: requestedIds },
        isActive: true,
        projectId,
        team: { archivedAt: null },
        workspaceId: context.workspaceId,
      },
    });
    if (projectTeams.length !== requestedIds.length) {
      unprocessable(
        'HANDOFF_DESTINATION_INVALID',
        '같은 프로젝트의 활성 참여 팀만 전달 대상으로 선택할 수 있습니다.',
      );
    }

    const targets: string[] = [];
    for (const projectTeam of projectTeams) {
      const existing = await transaction.teamWork.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
        where: {
          deletedAt: null,
          issueId,
          projectTeamId: projectTeam.id,
          workflowState: { category: { notIn: [...TERMINAL_CATEGORIES] } },
          workspaceId: context.workspaceId,
        },
      });
      if (existing) {
        targets.push(existing.id);
        continue;
      }
      const team = await transaction.team.findFirst({
        select: { id: true, key: true, nextIssueNumber: true },
        where: { archivedAt: null, id: projectTeam.teamId, workspaceId: context.workspaceId },
      });
      const state = await transaction.workflowState.findFirst({
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select: { id: true },
        where: {
          category: { notIn: [...TERMINAL_CATEGORIES] },
          teamId: projectTeam.teamId,
          workspaceId: context.workspaceId,
        },
      });
      if (!team || !state) resourceNotFound('전달 대상 팀 또는 워크플로 상태를 찾을 수 없습니다.');
      await transaction.team.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: team.id },
      });
      const created = await transaction.teamWork.create({
        data: {
          createdByMembershipId: context.membershipId,
          identifier: `${team.key}-${team.nextIssueNumber}`,
          issueId,
          projectTeamId: projectTeam.id,
          sequenceNumber: team.nextIssueNumber,
          teamId: team.id,
          workflowStateId: state.id,
          workspaceId: context.workspaceId,
        },
        select: { id: true, version: true },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            identifier: `${team.key}-${team.nextIssueNumber}`,
            projectTeamId: projectTeam.id,
            teamId: team.id,
            teamKey: team.key,
          },
          eventType: 'TEAM_WORK_CREATED',
          issueId,
          teamWorkId: created.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: created.id,
          aggregateType: 'TEAM_WORK',
          eventType: TEAM_WORK_CREATED,
          id: eventId,
          payload: {
            assigneeMembershipId: null,
            issueId,
            schemaVersion: TEAM_WORK_CREATED_SCHEMA_VERSION,
            teamWorkId: created.id,
          } satisfies TeamWorkCreatedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId,
        resourceId: created.id,
        resourceType: 'TEAM_WORK',
        version: created.version,
        workspaceId: context.workspaceId,
      });
      targets.push(created.id);
    }
    return targets.sort();
  }
}
