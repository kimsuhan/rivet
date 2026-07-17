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

  async list(workspaceId: string, query: TeamListQueryDto): Promise<TeamListResponseDto> {
    return toTeamListResponse(await this.teams.findList(workspaceId, query.includeArchived));
  }

  async get(workspaceId: string, teamId: string): Promise<TeamResponseDto> {
    return toTeamResponse(await this.teams.findById(workspaceId, teamId));
  }

  async listWorkflowStates(
    workspaceId: string,
    teamId: string,
  ): Promise<WorkflowStateListResponseDto> {
    return toWorkflowStateListResponse(
      await this.teams.findWorkflowStatesByTeamId(workspaceId, teamId),
    );
  }
}
