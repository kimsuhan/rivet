import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { IssueStatus, MembershipStatus, Prisma, StateCategory } from '@rivet/database';
import {
  TEAM_WORK_CHANGED,
  TEAM_WORK_CHANGED_SCHEMA_VERSION,
  TEAM_WORK_CREATED,
  TEAM_WORK_CREATED_SCHEMA_VERSION,
  type TeamWorkChangedOutboxPayload,
  type TeamWorkCreatedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import { shouldAutoStartOnAssignment } from './domain/team-work-transition';
import type {
  AssignTeamWorksDto,
  ClaimTeamWorkDto,
  InitialTeamAssignmentDto,
  StartIssueDto,
} from './dto/issue-request.dto';
import type {
  AssignTeamWorksResponseDto,
  ClaimTeamWorkResponseDto,
  StartIssueResponseDto,
} from './dto/issue-response.dto';
import type { IssueMutationContext } from './issue.context';
import {
  issueConflict as conflict,
  issueResourceNotFound as resourceNotFound,
  issueUnprocessable as unprocessable,
} from './issue.errors';
import { IssueRepository, type TeamWorkRow } from './issue.repository';
import {
  toIssueSummary,
  toIssueWorkflowSummary as workflowSummary,
  toTeamWorkSummary,
} from './issue-response.mapper';
import { IssueStatusService } from './issue-status.service';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class IssueAssignmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: IssueRepository,
    private readonly statuses: IssueStatusService,
  ) {}

  async start(
    context: IssueMutationContext,
    issueId: string,
    dto: StartIssueDto,
  ): Promise<StartIssueResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "issues"
        WHERE "id" = ${issueId}::uuid AND "workspace_id" = ${context.workspaceId}::uuid
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;
      const current = await transaction.issue.findFirst({
        select: { id: true, projectId: true, status: true },
        where: { deletedAt: null, id: issueId, workspaceId: context.workspaceId },
      });
      if (!current) resourceNotFound();
      if (
        current.status === IssueStatus.PAUSED ||
        current.status === IssueStatus.CANCELED ||
        current.status === IssueStatus.DONE
      ) {
        conflict(
          'ISSUE_REOPEN_REQUIRED',
          '팀 작업을 시작하려면 이슈를 재개하거나 다시 열어야 합니다.',
        );
      }
      const created = await this.createInitialTeamWorks(
        transaction,
        context,
        issueId,
        current.projectId,
        dto.teamAssignments,
        dto.requireCurrentUserTeamMembership,
      );
      await this.statuses.recalculate(
        transaction,
        context.workspaceId,
        issueId,
        context.membershipId,
      );
      const issue = await this.repository.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: issue.version,
        workspaceId: context.workspaceId,
      });
      return { issue: toIssueSummary(issue), teamWorks: created.map(toTeamWorkSummary) };
    });
  }

  async claim(
    context: IssueMutationContext,
    issueId: string,
    dto: ClaimTeamWorkDto,
  ): Promise<ClaimTeamWorkResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const candidates = await this.repository.findClaimCandidates(
        transaction,
        context.workspaceId,
        issueId,
        dto.projectTeamId,
        dto.teamWorkId,
      );
      if (candidates.length !== 1)
        conflict('CLAIM_TARGET_REQUIRED', '맡을 팀 작업을 하나 선택해 주세요.');
      const candidate = candidates[0] as TeamWorkRow;
      await this.assertTeamMember(
        transaction,
        context.workspaceId,
        candidate.team.id,
        context.membershipId,
      );
      const autoStart = shouldAutoStartOnAssignment(candidate.workflowState);
      const autoStartStateId = autoStart
        ? await this.repository.firstUnstartedStateId(
            transaction,
            context.workspaceId,
            candidate.team.id,
          )
        : null;
      const changed = await transaction.teamWork.updateMany({
        data: {
          assigneeMembershipId: context.membershipId,
          ...(autoStartStateId ? { workflowStateId: autoStartStateId } : {}),
          version: { increment: 1 },
        },
        where: { assigneeMembershipId: null, id: candidate.id, version: candidate.version },
      });
      if (changed.count !== 1)
        conflict('ISSUE_ASSIGNMENT_CONFLICT', '팀 작업 담당자가 이미 변경됐습니다.');
      await transaction.issueSubscription.createMany({
        data: [{ issueId, membershipId: context.membershipId, workspaceId: context.workspaceId }],
        skipDuplicates: true,
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: { id: context.membershipId },
          eventType: 'TEAM_WORK_ASSIGNEE_CHANGED',
          fieldName: 'assigneeMembershipId',
          issueId,
          teamWorkId: candidate.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: candidate.id,
          aggregateType: 'TEAM_WORK',
          eventType: TEAM_WORK_CHANGED,
          id: eventId,
          payload: {
            assigneeMembershipId: context.membershipId,
            changedFields: autoStartStateId ? ['ASSIGNEE', 'WORKFLOW_STATE'] : ['ASSIGNEE'],
            issueId,
            mentionedMembershipIds: [],
            schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
            subscriberMembershipIds: [],
            teamWorkId: candidate.id,
            terminalCategory: null,
          } satisfies TeamWorkChangedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      await this.statuses.recalculate(
        transaction,
        context.workspaceId,
        issueId,
        context.membershipId,
      );
      const teamWork = await this.repository.findTeamWork(
        transaction,
        context.workspaceId,
        candidate.id,
      );
      const issue = await this.repository.findIssue(transaction, context.workspaceId, issueId);
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        eventId,
        resourceId: teamWork.id,
        resourceType: 'TEAM_WORK',
        version: teamWork.version,
        workspaceId: context.workspaceId,
      });
      return {
        issue: toIssueSummary(issue),
        teamWork: toTeamWorkSummary(teamWork),
        workflowSummary: workflowSummary(issue.teamWorks),
      };
    });
  }

  async assignTeamWorks(
    context: IssueMutationContext,
    issueId: string,
    dto: AssignTeamWorksDto,
  ): Promise<AssignTeamWorksResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const updated: TeamWorkRow[] = [];
      for (const assignment of dto.assignments) {
        const current = await this.repository.findTeamWork(
          transaction,
          context.workspaceId,
          assignment.teamWorkId,
        );
        if (current.issue.id !== issueId)
          resourceNotFound('이슈에 속한 팀 작업을 찾을 수 없습니다.');
        await this.assertTeamMember(
          transaction,
          context.workspaceId,
          current.team.id,
          assignment.assigneeMembershipId,
        );
        const autoStart = shouldAutoStartOnAssignment(current.workflowState);
        const autoStartStateId = autoStart
          ? await this.repository.firstUnstartedStateId(
              transaction,
              context.workspaceId,
              current.team.id,
            )
          : null;
        const changed = await transaction.teamWork.updateMany({
          data: {
            assigneeMembershipId: assignment.assigneeMembershipId,
            ...(autoStartStateId ? { workflowStateId: autoStartStateId } : {}),
            version: { increment: 1 },
          },
          where: { id: current.id, version: assignment.version, workspaceId: context.workspaceId },
        });
        if (changed.count !== 1)
          conflict(
            'TEAM_WORK_VERSION_CONFLICT',
            '팀 작업이 다른 요청에서 변경되었습니다.',
            current.version,
          );
        await transaction.issueSubscription.createMany({
          data: [
            {
              issueId,
              membershipId: assignment.assigneeMembershipId,
              workspaceId: context.workspaceId,
            },
          ],
          skipDuplicates: true,
        });
        await transaction.activityEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            afterData: { id: assignment.assigneeMembershipId },
            eventType: 'TEAM_WORK_ASSIGNEE_CHANGED',
            fieldName: 'assigneeMembershipId',
            issueId,
            teamWorkId: current.id,
            workspaceId: context.workspaceId,
          },
        });
        const eventId = randomUUID();
        await transaction.outboxEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            aggregateId: current.id,
            aggregateType: 'TEAM_WORK',
            eventType: TEAM_WORK_CHANGED,
            id: eventId,
            payload: {
              assigneeMembershipId: assignment.assigneeMembershipId,
              changedFields: autoStartStateId ? ['ASSIGNEE', 'WORKFLOW_STATE'] : ['ASSIGNEE'],
              issueId,
              mentionedMembershipIds: [],
              schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
              subscriberMembershipIds: [],
              teamWorkId: current.id,
              terminalCategory: null,
            } satisfies TeamWorkChangedOutboxPayload,
            workspaceId: context.workspaceId,
          },
        });
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          eventId,
          resourceId: current.id,
          resourceType: 'TEAM_WORK',
          version: current.version + 1,
          workspaceId: context.workspaceId,
        });
        updated.push(
          await this.repository.findTeamWork(transaction, context.workspaceId, current.id),
        );
      }
      await this.statuses.recalculate(
        transaction,
        context.workspaceId,
        issueId,
        context.membershipId,
      );
      const issue = await this.repository.findIssue(transaction, context.workspaceId, issueId);
      return {
        issue: toIssueSummary(issue),
        teamWorks: updated.map(toTeamWorkSummary),
        workflowSummary: workflowSummary(issue.teamWorks),
      };
    });
  }

  async createInitialTeamWorks(
    transaction: Transaction,
    context: IssueMutationContext,
    issueId: string,
    projectId: string,
    assignments: InitialTeamAssignmentDto[],
    requireCurrentUserTeamMembership = false,
  ): Promise<TeamWorkRow[]> {
    const created: TeamWorkRow[] = [];
    for (const assignment of assignments) {
      const projectTeam = await transaction.projectTeam.findFirst({
        select: {
          deploymentTrackingEnabled: true,
          id: true,
          team: { select: { archivedAt: true, id: true, key: true, name: true } },
          teamId: true,
        },
        where: {
          id: assignment.projectTeamId,
          isActive: true,
          projectId,
          team: { archivedAt: null },
          workspaceId: context.workspaceId,
        },
      });
      if (!projectTeam) {
        unprocessable(
          'INITIAL_TEAM_NOT_AVAILABLE',
          '현재 프로젝트의 활성 참여 팀만 시작할 수 있습니다.',
        );
      }
      if (requireCurrentUserTeamMembership)
        await this.assertTeamMember(
          transaction,
          context.workspaceId,
          projectTeam.teamId,
          context.membershipId,
        );
      if (assignment.assigneeMembershipId)
        await this.assertTeamMember(
          transaction,
          context.workspaceId,
          projectTeam.teamId,
          assignment.assigneeMembershipId,
        );
      const reusable = await transaction.teamWork.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          assigneeMembershipId: true,
          id: true,
          version: true,
          workflowState: { select: { category: true, isDefault: true } },
        },
        where: {
          deletedAt: null,
          issueId,
          projectTeamId: projectTeam.id,
          teamId: projectTeam.teamId,
          workflowState: { category: { notIn: [StateCategory.COMPLETED, StateCategory.CANCELED] } },
          workspaceId: context.workspaceId,
        },
      });
      if (reusable) {
        if (
          assignment.assigneeMembershipId &&
          reusable.assigneeMembershipId &&
          reusable.assigneeMembershipId !== assignment.assigneeMembershipId
        ) {
          conflict('TEAM_WORK_ASSIGNMENT_CONFLICT', '기존 팀 작업의 담당자가 다릅니다.');
        }
        if (assignment.assigneeMembershipId && reusable.assigneeMembershipId === null) {
          const autoStart = shouldAutoStartOnAssignment(reusable.workflowState);
          const autoStartStateId = autoStart
            ? await this.repository.firstUnstartedStateId(
                transaction,
                context.workspaceId,
                projectTeam.teamId,
              )
            : null;
          await transaction.teamWork.update({
            data: {
              assigneeMembershipId: assignment.assigneeMembershipId,
              ...(autoStartStateId ? { workflowStateId: autoStartStateId } : {}),
              version: { increment: 1 },
            },
            where: { id: reusable.id },
          });
          await transaction.issueSubscription.createMany({
            data: [
              {
                issueId,
                membershipId: assignment.assigneeMembershipId,
                workspaceId: context.workspaceId,
              },
            ],
            skipDuplicates: true,
          });
          const eventId = randomUUID();
          await transaction.outboxEvent.create({
            data: {
              actorMembershipId: context.membershipId,
              aggregateId: reusable.id,
              aggregateType: 'TEAM_WORK',
              eventType: TEAM_WORK_CHANGED,
              id: eventId,
              payload: {
                assigneeMembershipId: assignment.assigneeMembershipId,
                changedFields: autoStartStateId ? ['ASSIGNEE', 'WORKFLOW_STATE'] : ['ASSIGNEE'],
                issueId,
                mentionedMembershipIds: [],
                schemaVersion: TEAM_WORK_CHANGED_SCHEMA_VERSION,
                subscriberMembershipIds: [],
                teamWorkId: reusable.id,
                terminalCategory: null,
              } satisfies TeamWorkChangedOutboxPayload,
              workspaceId: context.workspaceId,
            },
          });
          await notifyResourceChanged(transaction, {
            changeType: 'UPDATED',
            eventId,
            resourceId: reusable.id,
            resourceType: 'TEAM_WORK',
            version: reusable.version + 1,
            workspaceId: context.workspaceId,
          });
        }
        created.push(
          await this.repository.findTeamWork(transaction, context.workspaceId, reusable.id),
        );
        continue;
      }
      await transaction.$queryRaw`
        SELECT "id" FROM "teams"
        WHERE "id" = ${projectTeam.teamId}::uuid AND "workspace_id" = ${context.workspaceId}::uuid
        FOR UPDATE
      `;
      const team = await transaction.team.findFirst({
        select: { id: true, key: true, nextIssueNumber: true },
        where: { archivedAt: null, id: projectTeam.teamId, workspaceId: context.workspaceId },
      });
      const workflowState = await transaction.workflowState.findFirst({
        orderBy: assignment.assigneeMembershipId
          ? [{ position: 'asc' }, { id: 'asc' }]
          : [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
        select: { id: true },
        where: {
          ...(assignment.assigneeMembershipId ? { category: StateCategory.UNSTARTED } : {}),
          disabledAt: null,
          teamId: projectTeam.teamId,
          workspaceId: context.workspaceId,
        },
      });
      if (!team || !workflowState)
        resourceNotFound('팀 또는 기본 워크플로 상태를 찾을 수 없습니다.');
      await transaction.team.update({
        data: { nextIssueNumber: { increment: 1 } },
        where: { id: team.id },
      });
      const teamWork = await transaction.teamWork.create({
        data: {
          assigneeMembershipId: assignment.assigneeMembershipId ?? null,
          createdByMembershipId: context.membershipId,
          deploymentStatus: projectTeam.deploymentTrackingEnabled ? 'PENDING' : 'NOT_APPLICABLE',
          identifier: `${team.key}-${team.nextIssueNumber}`,
          issueId,
          projectTeamId: projectTeam.id,
          sequenceNumber: team.nextIssueNumber,
          teamId: team.id,
          workflowStateId: workflowState.id,
          workspaceId: context.workspaceId,
        },
        select: { id: true },
      });
      if (assignment.assigneeMembershipId)
        await transaction.issueSubscription.createMany({
          data: [
            {
              issueId,
              membershipId: assignment.assigneeMembershipId,
              workspaceId: context.workspaceId,
            },
          ],
          skipDuplicates: true,
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
          teamWorkId: teamWork.id,
          workspaceId: context.workspaceId,
        },
      });
      const eventId = randomUUID();
      await transaction.outboxEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          aggregateId: teamWork.id,
          aggregateType: 'TEAM_WORK',
          eventType: TEAM_WORK_CREATED,
          id: eventId,
          payload: {
            assigneeMembershipId: assignment.assigneeMembershipId ?? null,
            issueId,
            schemaVersion: TEAM_WORK_CREATED_SCHEMA_VERSION,
            teamWorkId: teamWork.id,
          } satisfies TeamWorkCreatedOutboxPayload,
          workspaceId: context.workspaceId,
        },
      });
      const row = await this.repository.findTeamWork(transaction, context.workspaceId, teamWork.id);
      await notifyResourceChanged(transaction, {
        changeType: 'CREATED',
        eventId,
        resourceId: row.id,
        resourceType: 'TEAM_WORK',
        version: row.version,
        workspaceId: context.workspaceId,
      });
      created.push(row);
    }
    return created;
  }

  private async assertTeamMember(
    transaction: Transaction,
    workspaceId: string,
    teamId: string,
    membershipId: string,
  ): Promise<void> {
    const member = await transaction.teamMember.findFirst({
      select: { membershipId: true },
      where: {
        membership: { status: MembershipStatus.ACTIVE },
        membershipId,
        removedAt: null,
        teamId,
        workspaceId,
      },
    });
    if (!member)
      throw new ApiError({
        code: 'TEAM_MEMBERSHIP_REQUIRED',
        message: '팀의 활성 멤버여야 합니다.',
        status: HttpStatus.FORBIDDEN,
      });
  }
}
