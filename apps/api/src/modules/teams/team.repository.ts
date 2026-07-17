import { Injectable } from '@nestjs/common';

import { Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { teamResourceNotFound } from './team.errors';
import {
  TEAM_LIST_SELECT,
  TEAM_RESPONSE_SELECT,
  type TeamListRow,
  type TeamResponseRow,
  WORKFLOW_STATE_SELECT,
  type WorkflowStateRow,
} from './team-response.mapper';

type DatabaseClient = Prisma.TransactionClient | DatabaseService['client'];

@Injectable()
export class TeamRepository {
  constructor(private readonly database: DatabaseService) {}

  findList(workspaceId: string, includeArchived: boolean): Promise<TeamListRow[]> {
    return this.database.client.team.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: TEAM_LIST_SELECT,
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        workspaceId,
      },
    });
  }

  findById(workspaceId: string, teamId: string): Promise<TeamResponseRow> {
    return this.find(this.database.client, workspaceId, teamId);
  }

  async find(
    client: DatabaseClient,
    workspaceId: string,
    teamId: string,
  ): Promise<TeamResponseRow> {
    const team = await client.team.findFirst({
      select: TEAM_RESPONSE_SELECT,
      where: { id: teamId, workspaceId },
    });
    if (!team) {
      throw teamResourceNotFound('팀을 찾을 수 없습니다.');
    }
    return team;
  }

  async findWorkflowStatesByTeamId(
    workspaceId: string,
    teamId: string,
  ): Promise<WorkflowStateRow[]> {
    const team = await this.database.client.team.findFirst({
      select: { id: true },
      where: { id: teamId, workspaceId },
    });
    if (!team) {
      throw teamResourceNotFound('팀을 찾을 수 없습니다.');
    }
    return this.findWorkflowStates(this.database.client, workspaceId, teamId);
  }

  findWorkflowStates(
    client: DatabaseClient,
    workspaceId: string,
    teamId: string,
  ): Promise<WorkflowStateRow[]> {
    return client.workflowState.findMany({
      orderBy: { position: 'asc' },
      select: WORKFLOW_STATE_SELECT,
      where: { teamId, workspaceId },
    });
  }
}
