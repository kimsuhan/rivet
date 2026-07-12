import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamListQueryDto, UpdateTeamDto, VersionDto } from './dto/team-request.dto';
import {
  TeamListResponseDto,
  TeamResponseDto,
  WorkflowStateListResponseDto,
  WorkflowStateResponseDto,
} from './dto/team-response.dto';
import {
  DeleteWorkflowStateQueryDto,
  ReorderWorkflowStatesDto,
  UpdateWorkflowStateDto,
} from './dto/workflow-state-request.dto';
import { TeamsService } from './teams.service';

function workspaceContext(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  workspaceId: string;
} {
  const { membership, workspace } = authentication.session;

  if (
    !membership ||
    !workspace ||
    membership.status !== 'ACTIVE' ||
    membership.workspaceId !== workspace.id
  ) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: '활성 워크스페이스가 필요합니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }

  return { membershipId: membership.id, workspaceId: workspace.id };
}

@ApiTags('teams')
@ApiCookieAuth('sessionCookie')
@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('teams')
  @ApiOperation({ summary: '팀 목록 조회' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiOkResponse({ type: TeamListResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: TeamListQueryDto,
  ): Promise<TeamListResponseDto> {
    return this.teams.list(workspaceContext(authentication).workspaceId, query);
  }

  @Post('teams')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '팀과 기본 워크플로 생성' })
  @ApiCreatedResponse({ type: TeamResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'TEAM_NAME_IN_USE 또는 TEAM_KEY_IN_USE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateTeamDto,
  ): Promise<TeamResponseDto> {
    return this.teams.create(workspaceContext(authentication), dto);
  }

  @Get('teams/:teamId')
  @ApiOperation({ summary: '팀 상세 조회' })
  @ApiOkResponse({ type: TeamResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  get(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
  ): Promise<TeamResponseDto> {
    return this.teams.get(workspaceContext(authentication).workspaceId, teamId);
  }

  @Patch('teams/:teamId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '팀 이름과 키 수정' })
  @ApiOkResponse({ type: TeamResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT, TEAM_NAME_IN_USE, TEAM_KEY_IN_USE 또는 TEAM_KEY_LOCKED',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    return this.teams.update(workspaceContext(authentication).workspaceId, teamId, dto);
  }

  @Put('teams/:teamId/members/:membershipId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '활성 멤버를 팀에 추가하거나 복귀' })
  @ApiOkResponse({ type: TeamResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  addMember(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Param('membershipId', new ParseUUIDPipe({ version: '4' })) membershipId: string,
  ): Promise<TeamResponseDto> {
    return this.teams.addMember(workspaceContext(authentication).workspaceId, teamId, membershipId);
  }

  @Delete('teams/:teamId/members/:membershipId')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '팀 멤버 제거' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'TEAM_MEMBER_HAS_OPEN_ASSIGNMENTS',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  async removeMember(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Param('membershipId', new ParseUUIDPipe({ version: '4' })) membershipId: string,
  ): Promise<void> {
    await this.teams.removeMember(
      workspaceContext(authentication).workspaceId,
      teamId,
      membershipId,
    );
  }

  @Post('teams/:teamId/archive')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '팀 보관' })
  @ApiOkResponse({ type: TeamResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 TEAM_HAS_OPEN_ISSUES',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  archive(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Body() dto: VersionDto,
  ): Promise<TeamResponseDto> {
    return this.teams.archive(workspaceContext(authentication).workspaceId, teamId, dto);
  }

  @Get('teams/:teamId/workflow-states')
  @ApiOperation({ summary: '팀 워크플로 상태 조회' })
  @ApiOkResponse({ type: WorkflowStateListResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  listWorkflowStates(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
  ): Promise<WorkflowStateListResponseDto> {
    return this.teams.listWorkflowStates(workspaceContext(authentication).workspaceId, teamId);
  }

  @Patch('workflow-states/:stateId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '워크플로 상태 이름 수정' })
  @ApiOkResponse({ type: WorkflowStateResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  updateWorkflowState(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('stateId', new ParseUUIDPipe({ version: '4' })) stateId: string,
    @Body() dto: UpdateWorkflowStateDto,
  ): Promise<WorkflowStateResponseDto> {
    return this.teams.updateWorkflowState(
      workspaceContext(authentication).workspaceId,
      stateId,
      dto,
    );
  }

  @Put('teams/:teamId/workflow-states/order')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '워크플로 상태 순서 교체' })
  @ApiOkResponse({ type: WorkflowStateListResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  reorderWorkflowStates(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Body() dto: ReorderWorkflowStatesDto,
  ): Promise<WorkflowStateListResponseDto> {
    return this.teams.reorderWorkflowStates(
      workspaceContext(authentication).workspaceId,
      teamId,
      dto,
    );
  }

  @Delete('workflow-states/:stateId')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '미사용 워크플로 상태 삭제' })
  @ApiQuery({ minimum: 1, name: 'version', required: true, type: Number })
  @ApiQuery({ format: 'uuid', name: 'replacementStateId', required: false, type: String })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 WORKFLOW_STATE_IN_USE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  async deleteWorkflowState(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('stateId', new ParseUUIDPipe({ version: '4' })) stateId: string,
    @Query() query: DeleteWorkflowStateQueryDto,
  ): Promise<void> {
    await this.teams.deleteWorkflowState(workspaceContext(authentication), stateId, query);
  }
}
