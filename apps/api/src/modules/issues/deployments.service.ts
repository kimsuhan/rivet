import { HttpStatus, Injectable } from '@nestjs/common';

import { DeploymentStatus, MembershipRole, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { notifyResourceChanged } from '../../common/realtime/notify-resource-changed';
import type {
  CompleteProjectDeploymentsDto,
  DeploymentListQueryDto,
  DeploymentListResponseDto,
  UpdateIssueDeploymentPlanDto,
  UpdateTeamWorkDeploymentDto,
} from './dto/deployment.dto';
import type { IssueDetailResponseDto, TeamWorkSummaryResponseDto } from './dto/issue-response.dto';
import { IssueRepository } from './issue.repository';
import { toIssueDetail, toTeamWorkSummary } from './issue-response.mapper';
import { IssueStatusService } from './issue-status.service';

type Context = {
  membershipId: string;
  membershipRole: MembershipRole;
  workspaceId: string;
};

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repository: IssueRepository,
    private readonly statuses: IssueStatusService,
  ) {}

  async list(context: Context, query: DeploymentListQueryDto): Promise<DeploymentListResponseDto> {
    const statuses = query.status ?? [DeploymentStatus.PENDING, DeploymentStatus.REDEPLOY_REQUIRED];
    const teamIds =
      query.scope === 'MY_TEAMS'
        ? (
            await this.database.client.teamMember.findMany({
              select: { teamId: true },
              where: {
                membershipId: context.membershipId,
                removedAt: null,
                workspaceId: context.workspaceId,
              },
            })
          ).map(({ teamId }) => teamId)
        : undefined;
    const [rows, totalCount] = await Promise.all([
      this.repository.listDeploymentTeamWorks(
        context.workspaceId,
        statuses,
        query.limit,
        teamIds,
        query.readyOnly,
      ),
      this.repository.countDeploymentTeamWorks(
        context.workspaceId,
        statuses,
        teamIds,
        query.readyOnly,
      ),
    ]);
    return { items: rows.map(toTeamWorkSummary), totalCount };
  }

  async completeProjectDeployments(
    context: Context,
    projectId: string,
    dto: CompleteProjectDeploymentsDto,
  ): Promise<DeploymentListResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const teamWorkIds = dto.teamWorks.map(({ id }) => id);
      const requestedVersions = new Map(dto.teamWorks.map(({ id, version }) => [id, version]));
      const teamWorks = await transaction.teamWork.findMany({
        select: {
          deploymentGroupId: true,
          deploymentStatus: true,
          id: true,
          issue: {
            select: {
              id: true,
              project: { select: { id: true, leadMembershipId: true } },
            },
          },
          teamId: true,
          version: true,
          workflowState: { select: { category: true } },
        },
        where: {
          deletedAt: null,
          id: { in: teamWorkIds },
          issue: { deletedAt: null, projectId },
          workspaceId: context.workspaceId,
        },
      });
      if (teamWorks.length !== teamWorkIds.length) this.notFound();

      const projectLeadMembershipId = teamWorks[0]?.issue.project.leadMembershipId ?? null;
      if (
        context.membershipRole !== MembershipRole.ADMIN &&
        projectLeadMembershipId !== context.membershipId
      ) {
        const memberships = await transaction.teamMember.findMany({
          select: { teamId: true },
          where: {
            membershipId: context.membershipId,
            removedAt: null,
            teamId: { in: [...new Set(teamWorks.map(({ teamId }) => teamId))] },
            workspaceId: context.workspaceId,
          },
        });
        const memberTeamIds = new Set(memberships.map(({ teamId }) => teamId));
        if (teamWorks.some(({ teamId }) => !memberTeamIds.has(teamId))) {
          throw new ApiError({
            code: 'DEPLOYMENT_MANAGE_FORBIDDEN',
            message: '해당 팀 멤버와 프로젝트 리드만 배포 상태를 변경할 수 있습니다.',
            status: HttpStatus.FORBIDDEN,
          });
        }
      }

      for (const teamWork of teamWorks) {
        if (requestedVersions.get(teamWork.id) !== teamWork.version) {
          throw new ApiError({
            code: 'TEAM_WORK_VERSION_CONFLICT',
            currentVersion: teamWork.version,
            message: '팀 작업이 다른 요청에서 변경되었습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
        if (
          teamWork.deploymentStatus !== DeploymentStatus.PENDING &&
          teamWork.deploymentStatus !== DeploymentStatus.REDEPLOY_REQUIRED
        ) {
          this.invalid(
            'DEPLOYMENT_NOT_PENDING',
            '배포 대기 또는 재배포 필요 작업만 완료할 수 있습니다.',
          );
        }
        if (teamWork.workflowState.category !== StateCategory.COMPLETED) {
          this.invalid(
            'DEPLOYMENT_WORK_NOT_COMPLETED',
            '팀 작업을 먼저 완료해야 운영 배포를 완료할 수 있습니다.',
          );
        }
      }

      const pendingPredecessor = await transaction.teamWorkDeploymentDependency.findFirst({
        select: { predecessor: { select: { identifier: true } } },
        where: {
          dependentTeamWorkId: { in: teamWorkIds },
          predecessor: {
            deploymentStatus: { not: DeploymentStatus.DEPLOYED },
            id: { notIn: teamWorkIds },
          },
        },
      });
      if (pendingPredecessor) {
        this.invalid(
          'DEPLOYMENT_PREDECESSOR_PENDING',
          `${pendingPredecessor.predecessor.identifier} 배포를 먼저 완료해 주세요.`,
        );
      }

      const deploymentGroupIds = teamWorks.flatMap(({ deploymentGroupId }) =>
        deploymentGroupId ? [deploymentGroupId] : [],
      );
      if (deploymentGroupIds.length > 0) {
        const unfinishedGroupMember = await transaction.teamWork.findFirst({
          select: { identifier: true },
          where: {
            deploymentGroupId: { in: deploymentGroupIds },
            workflowState: { category: { not: StateCategory.COMPLETED } },
            workspaceId: context.workspaceId,
          },
        });
        if (unfinishedGroupMember) {
          this.invalid(
            'DEPLOYMENT_GROUP_NOT_READY',
            `함께 배포할 ${unfinishedGroupMember.identifier} 작업이 아직 완료되지 않았습니다.`,
          );
        }
      }

      const deployedAt = new Date();
      for (const teamWork of teamWorks) {
        const updated = await transaction.teamWork.updateMany({
          data: {
            deployedAt,
            deployedByMembershipId: context.membershipId,
            deploymentStatus: DeploymentStatus.DEPLOYED,
            version: { increment: 1 },
          },
          where: { id: teamWork.id, version: teamWork.version },
        });
        if (updated.count !== 1) {
          throw new ApiError({
            code: 'TEAM_WORK_VERSION_CONFLICT',
            message: '팀 작업이 다른 요청에서 변경되었습니다.',
            status: HttpStatus.CONFLICT,
          });
        }
        await transaction.activityEvent.create({
          data: {
            actorMembershipId: context.membershipId,
            afterData: DeploymentStatus.DEPLOYED,
            beforeData: teamWork.deploymentStatus,
            eventType: 'TEAM_WORK_DEPLOYMENT_CHANGED',
            fieldName: 'deploymentStatus',
            issueId: teamWork.issue.id,
            teamWorkId: teamWork.id,
            workspaceId: context.workspaceId,
          },
        });
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: teamWork.id,
          resourceType: 'TEAM_WORK',
          version: teamWork.version + 1,
          workspaceId: context.workspaceId,
        });
      }

      const issueIds = [...new Set(teamWorks.map(({ issue }) => issue.id))];
      for (const issueId of issueIds) {
        await this.statuses.recalculate(
          transaction,
          context.workspaceId,
          issueId,
          context.membershipId,
        );
      }
      const issues = await transaction.issue.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, version: true },
        where: { id: { in: issueIds }, workspaceId: context.workspaceId },
      });
      for (const issue of issues) {
        await notifyResourceChanged(transaction, {
          changeType: 'UPDATED',
          resourceId: issue.id,
          resourceType: 'ISSUE',
          version: issue.version,
          workspaceId: context.workspaceId,
        });
      }

      const rows = await this.repository.findTeamWorksInTransaction(
        transaction,
        context.workspaceId,
        teamWorkIds,
      );
      return { items: rows.map(toTeamWorkSummary), totalCount: rows.length };
    });
  }

  async updateTeamWork(
    context: Context,
    teamWorkId: string,
    dto: UpdateTeamWorkDeploymentDto,
  ): Promise<TeamWorkSummaryResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const current = await transaction.teamWork.findFirst({
        select: {
          deploymentGroupId: true,
          deploymentStatus: true,
          id: true,
          issue: { select: { id: true, project: { select: { leadMembershipId: true } } } },
          projectTeam: { select: { deploymentTrackingEnabled: true } },
          teamId: true,
          version: true,
          workflowState: { select: { category: true } },
        },
        where: { deletedAt: null, id: teamWorkId, workspaceId: context.workspaceId },
      });
      if (!current) this.notFound();
      await this.assertCanManageTeamWork(
        context,
        current.teamId,
        current.issue.project.leadMembershipId,
      );
      if (current.version !== dto.version) {
        throw new ApiError({
          code: 'TEAM_WORK_VERSION_CONFLICT',
          currentVersion: current.version,
          message: '팀 작업이 다른 요청에서 변경되었습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      let nextStatus: DeploymentStatus;
      if (dto.action === 'REQUIRE') {
        if (!current.projectTeam?.deploymentTrackingEnabled) {
          this.invalid(
            'DEPLOYMENT_TRACKING_DISABLED',
            '이 팀은 프로젝트에서 운영 배포를 관리하지 않습니다.',
          );
        }
        nextStatus = DeploymentStatus.PENDING;
      } else if (dto.action === 'SKIP') {
        nextStatus = DeploymentStatus.NOT_APPLICABLE;
      } else if (dto.action === 'MARK_REDEPLOY_REQUIRED') {
        if (current.deploymentStatus !== DeploymentStatus.DEPLOYED) {
          this.invalid(
            'DEPLOYMENT_NOT_DEPLOYED',
            '배포 완료된 작업만 재배포 필요로 변경할 수 있습니다.',
          );
        }
        nextStatus = DeploymentStatus.REDEPLOY_REQUIRED;
      } else {
        if (
          current.deploymentStatus !== DeploymentStatus.PENDING &&
          current.deploymentStatus !== DeploymentStatus.REDEPLOY_REQUIRED
        ) {
          this.invalid(
            'DEPLOYMENT_NOT_PENDING',
            '배포 대기 또는 재배포 필요 작업만 완료할 수 있습니다.',
          );
        }
        if (current.workflowState.category !== StateCategory.COMPLETED) {
          this.invalid(
            'DEPLOYMENT_WORK_NOT_COMPLETED',
            '팀 작업을 먼저 완료해야 운영 배포를 완료할 수 있습니다.',
          );
        }
        const pendingPredecessor = await transaction.teamWorkDeploymentDependency.findFirst({
          select: { predecessor: { select: { identifier: true } } },
          where: {
            dependentTeamWorkId: teamWorkId,
            predecessor: { deploymentStatus: { not: DeploymentStatus.DEPLOYED } },
          },
        });
        if (pendingPredecessor) {
          this.invalid(
            'DEPLOYMENT_PREDECESSOR_PENDING',
            `${pendingPredecessor.predecessor.identifier} 배포를 먼저 완료해 주세요.`,
          );
        }
        if (current.deploymentGroupId) {
          const unfinishedGroupMember = await transaction.teamWork.findFirst({
            select: { identifier: true },
            where: {
              deploymentGroupId: current.deploymentGroupId,
              id: { not: teamWorkId },
              workflowState: { category: { not: StateCategory.COMPLETED } },
              workspaceId: context.workspaceId,
            },
          });
          if (unfinishedGroupMember) {
            this.invalid(
              'DEPLOYMENT_GROUP_NOT_READY',
              `함께 배포할 ${unfinishedGroupMember.identifier} 작업이 아직 완료되지 않았습니다.`,
            );
          }
        }
        nextStatus = DeploymentStatus.DEPLOYED;
      }

      if (dto.action === 'SKIP') {
        await transaction.teamWorkDeploymentDependency.deleteMany({
          where: {
            OR: [{ dependentTeamWorkId: teamWorkId }, { predecessorTeamWorkId: teamWorkId }],
          },
        });
      }
      const updated = await transaction.teamWork.update({
        data: {
          ...(dto.action === 'SKIP' ? { deploymentGroupId: null } : {}),
          deploymentStatus: nextStatus,
          ...(nextStatus === DeploymentStatus.DEPLOYED
            ? { deployedAt: new Date(), deployedByMembershipId: context.membershipId }
            : dto.action === 'REQUIRE' || dto.action === 'SKIP'
              ? { deployedAt: null, deployedByMembershipId: null }
              : {}),
          version: { increment: 1 },
        },
        select: { version: true },
        where: { id: teamWorkId },
      });
      if (dto.action === 'SKIP' && current.deploymentGroupId) {
        const remainingGroupMembers = await transaction.teamWork.findMany({
          select: { id: true },
          where: { deploymentGroupId: current.deploymentGroupId, workspaceId: context.workspaceId },
        });
        if (remainingGroupMembers.length < 2) {
          await transaction.teamWork.updateMany({
            data: { deploymentGroupId: null, version: { increment: 1 } },
            where: { id: { in: remainingGroupMembers.map(({ id }) => id) } },
          });
          await transaction.deploymentGroup.delete({ where: { id: current.deploymentGroupId } });
        }
      }
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: nextStatus,
          beforeData: current.deploymentStatus,
          eventType: 'TEAM_WORK_DEPLOYMENT_CHANGED',
          fieldName: 'deploymentStatus',
          issueId: current.issue.id,
          teamWorkId,
          workspaceId: context.workspaceId,
        },
      });
      await this.statuses.recalculate(
        transaction,
        context.workspaceId,
        current.issue.id,
        context.membershipId,
      );
      const issue = await transaction.issue.findFirst({
        select: { version: true },
        where: { id: current.issue.id, workspaceId: context.workspaceId },
      });
      if (!issue) this.notFound();
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: teamWorkId,
        resourceType: 'TEAM_WORK',
        version: updated.version,
        workspaceId: context.workspaceId,
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: current.issue.id,
        resourceType: 'ISSUE',
        version: issue.version,
        workspaceId: context.workspaceId,
      });
      return toTeamWorkSummary(
        await this.repository.findTeamWork(transaction, context.workspaceId, teamWorkId),
      );
    });
  }

  async updatePlan(
    context: Context,
    issueId: string,
    dto: UpdateIssueDeploymentPlanDto,
  ): Promise<IssueDetailResponseDto> {
    return this.database.client.$transaction(async (transaction) => {
      const issue = await transaction.issue.findFirst({
        select: { id: true, project: { select: { leadMembershipId: true } }, version: true },
        where: { deletedAt: null, id: issueId, workspaceId: context.workspaceId },
      });
      if (!issue) this.notFound();
      if (
        context.membershipRole !== MembershipRole.ADMIN &&
        issue.project.leadMembershipId !== context.membershipId
      ) {
        throw new ApiError({
          code: 'DEPLOYMENT_PLAN_MANAGE_FORBIDDEN',
          message: '워크스페이스 관리자와 프로젝트 리드만 배포 조건을 변경할 수 있습니다.',
          status: HttpStatus.FORBIDDEN,
        });
      }
      if (issue.version !== dto.version) {
        throw new ApiError({
          code: 'ISSUE_VERSION_CONFLICT',
          currentVersion: issue.version,
          message: '이슈가 다른 요청에서 변경되었습니다.',
          status: HttpStatus.CONFLICT,
        });
      }

      const requestedIds = new Set([
        ...dto.dependencies.flatMap(({ dependentTeamWorkId, predecessorTeamWorkId }) => [
          dependentTeamWorkId,
          predecessorTeamWorkId,
        ]),
        ...dto.togetherGroups.flatMap(({ teamWorkIds }) => teamWorkIds),
      ]);
      const rows = await transaction.teamWork.findMany({
        select: { deploymentStatus: true, id: true },
        where: {
          deletedAt: null,
          deploymentStatus: { not: DeploymentStatus.NOT_APPLICABLE },
          issueId,
          workspaceId: context.workspaceId,
        },
      });
      const availableIds = new Set(rows.map(({ id }) => id));
      if ([...requestedIds].some((teamWorkId) => !availableIds.has(teamWorkId))) {
        this.invalid(
          'DEPLOYMENT_PLAN_TEAM_WORK_INVALID',
          '이 이슈의 배포 관리 대상 팀 작업만 선택할 수 있습니다.',
        );
      }

      const groupedIds = new Set<string>();
      for (const group of dto.togetherGroups) {
        for (const teamWorkId of group.teamWorkIds) {
          if (groupedIds.has(teamWorkId)) {
            this.invalid(
              'DEPLOYMENT_GROUP_DUPLICATED',
              '한 팀 작업은 하나의 함께 배포 그룹에만 포함할 수 있습니다.',
            );
          }
          groupedIds.add(teamWorkId);
        }
      }
      const edgeKeys = new Set<string>();
      for (const edge of dto.dependencies) {
        if (edge.dependentTeamWorkId === edge.predecessorTeamWorkId) {
          this.invalid(
            'DEPLOYMENT_DEPENDENCY_SELF',
            '같은 팀 작업을 자신의 선행 배포로 지정할 수 없습니다.',
          );
        }
        if (
          groupedIds.has(edge.dependentTeamWorkId) ||
          groupedIds.has(edge.predecessorTeamWorkId)
        ) {
          this.invalid(
            'DEPLOYMENT_MODE_CONFLICT',
            '함께 배포와 선행 배포 조건은 같은 팀 작업에 동시에 적용할 수 없습니다.',
          );
        }
        const key = `${edge.dependentTeamWorkId}:${edge.predecessorTeamWorkId}`;
        if (edgeKeys.has(key))
          this.invalid('DEPLOYMENT_DEPENDENCY_DUPLICATED', '같은 선행 배포 조건이 중복되었습니다.');
        edgeKeys.add(key);
      }
      this.assertAcyclic(dto.dependencies);

      await transaction.teamWorkDeploymentDependency.deleteMany({ where: { issueId } });
      await transaction.teamWork.updateMany({
        data: { deploymentGroupId: null },
        where: { deploymentGroupId: { not: null }, issueId, workspaceId: context.workspaceId },
      });
      await transaction.deploymentGroup.deleteMany({ where: { issueId } });
      for (const group of dto.togetherGroups) {
        const created = await transaction.deploymentGroup.create({
          data: { issueId, workspaceId: context.workspaceId },
          select: { id: true },
        });
        await transaction.teamWork.updateMany({
          data: { deploymentGroupId: created.id },
          where: { id: { in: group.teamWorkIds }, issueId, workspaceId: context.workspaceId },
        });
      }
      if (dto.dependencies.length > 0) {
        await transaction.teamWorkDeploymentDependency.createMany({
          data: dto.dependencies.map((edge) => ({
            ...edge,
            issueId,
            workspaceId: context.workspaceId,
          })),
        });
      }
      if (rows.length > 0) {
        await transaction.teamWork.updateMany({
          data: { version: { increment: 1 } },
          where: { id: { in: rows.map(({ id }) => id) }, workspaceId: context.workspaceId },
        });
      }
      const updatedIssue = await transaction.issue.update({
        data: { version: { increment: 1 } },
        select: { version: true },
        where: { id: issueId },
      });
      await transaction.activityEvent.create({
        data: {
          actorMembershipId: context.membershipId,
          afterData: {
            dependencies: dto.dependencies.map(
              ({ dependentTeamWorkId, predecessorTeamWorkId }) => ({
                dependentTeamWorkId,
                predecessorTeamWorkId,
              }),
            ),
            togetherGroups: dto.togetherGroups.map(({ teamWorkIds }) => ({ teamWorkIds })),
          },
          eventType: 'ISSUE_DEPLOYMENT_PLAN_CHANGED',
          issueId,
          workspaceId: context.workspaceId,
        },
      });
      await notifyResourceChanged(transaction, {
        changeType: 'UPDATED',
        resourceId: issueId,
        resourceType: 'ISSUE',
        version: updatedIssue.version,
        workspaceId: context.workspaceId,
      });
      return toIssueDetail(
        await this.repository.findIssue(transaction, context.workspaceId, issueId),
      );
    });
  }

  private async assertCanManageTeamWork(
    context: Context,
    teamId: string,
    leadMembershipId: string | null,
  ): Promise<void> {
    if (
      context.membershipRole === MembershipRole.ADMIN ||
      leadMembershipId === context.membershipId
    )
      return;
    const member = await this.database.client.teamMember.findFirst({
      select: { membershipId: true },
      where: {
        membershipId: context.membershipId,
        removedAt: null,
        teamId,
        workspaceId: context.workspaceId,
      },
    });
    if (!member) {
      throw new ApiError({
        code: 'DEPLOYMENT_MANAGE_FORBIDDEN',
        message: '해당 팀 멤버와 프로젝트 리드만 배포 상태를 변경할 수 있습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }
  }

  private assertAcyclic(
    dependencies: Array<{ dependentTeamWorkId: string; predecessorTeamWorkId: string }>,
  ): void {
    const graph = new Map<string, string[]>();
    for (const { dependentTeamWorkId, predecessorTeamWorkId } of dependencies) {
      graph.set(dependentTeamWorkId, [
        ...(graph.get(dependentTeamWorkId) ?? []),
        predecessorTeamWorkId,
      ]);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id))
        this.invalid('DEPLOYMENT_DEPENDENCY_CYCLE', '배포 선행 조건이 서로 순환할 수 없습니다.');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const predecessorId of graph.get(id) ?? []) visit(predecessorId);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of graph.keys()) visit(id);
  }

  private invalid(code: string, message: string): never {
    throw new ApiError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY });
  }

  private notFound(): never {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: '배포 관리 대상을 찾을 수 없습니다.',
      status: HttpStatus.NOT_FOUND,
    });
  }
}
