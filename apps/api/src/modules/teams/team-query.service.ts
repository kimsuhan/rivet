import { Injectable } from '@nestjs/common';

import type { TeamListQueryDto } from './dto/team-request.dto';
import type {
  TeamListResponseDto,
  TeamResponseDto,
  WorkflowStateListResponseDto,
} from './dto/team-response.dto';
import { TeamRepository } from './team.repository';
import {
  toTeamListResponse,
  toTeamResponse,
  toWorkflowStateListResponse,
} from './team-response.mapper';

@Injectable()
export class TeamQueryService {
  constructor(private readonly teams: TeamRepository) {}

  async list(
    context: { membershipId: string; role: 'ADMIN' | 'MEMBER'; workspaceId: string },
    query: TeamListQueryDto,
  ): Promise<TeamListResponseDto> {
    return toTeamListResponse(
      await this.teams.findList(context.workspaceId, query.includeArchived),
      context,
    );
  }

  async get(
    context: { membershipId: string; role: 'ADMIN' | 'MEMBER'; workspaceId: string },
    teamId: string,
  ): Promise<TeamResponseDto> {
    return toTeamResponse(await this.teams.findById(context.workspaceId, teamId), context);
  }

  async listWorkflowStates(
    workspaceId: string,
    teamId: string,
    includeDisabled: boolean,
  ): Promise<WorkflowStateListResponseDto> {
    return toWorkflowStateListResponse(
      await this.teams.findWorkflowStatesByTeamId(workspaceId, teamId, includeDisabled),
    );
  }
}
