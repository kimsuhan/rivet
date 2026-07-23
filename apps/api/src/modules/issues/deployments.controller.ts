import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { DeploymentsService } from './deployments.service';
import {
  CompleteProjectDeploymentsDto,
  DeploymentListQueryDto,
  DeploymentListResponseDto,
  UpdateIssueDeploymentPlanDto,
  UpdateTeamWorkDeploymentDto,
} from './dto/deployment.dto';
import { IssueDetailResponseDto, TeamWorkSummaryResponseDto } from './dto/issue-response.dto';
import { workspaceContext } from './issues.controller';

function deploymentContext(authentication: AuthenticatedRequestContext) {
  const context = workspaceContext(authentication);
  return {
    ...context,
    membershipRole: authentication.session.membership!.role,
  };
}

@ApiTags('deployments')
@ApiCookieAuth('sessionCookie')
@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Get()
  @ApiOperation({ summary: '현재 워크스페이스 운영 배포 현황 조회' })
  @ApiOkResponse({ type: DeploymentListResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: DeploymentListQueryDto,
  ): Promise<DeploymentListResponseDto> {
    return this.deployments.list(deploymentContext(authentication), query);
  }

  @Patch('team-works/:teamWorkId')
  @ApiOperation({ summary: '팀 작업 운영 배포 상태 변경' })
  @ApiOkResponse({ type: TeamWorkSummaryResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  updateTeamWork(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamWorkId', new ParseUUIDPipe({ version: '4' })) teamWorkId: string,
    @Body() dto: UpdateTeamWorkDeploymentDto,
  ): Promise<TeamWorkSummaryResponseDto> {
    return this.deployments.updateTeamWork(deploymentContext(authentication), teamWorkId, dto);
  }

  @Patch('projects/:projectId')
  @ApiOperation({ summary: '프로젝트에서 준비된 운영 배포 일괄 완료' })
  @ApiOkResponse({ type: DeploymentListResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  completeProjectDeployments(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: CompleteProjectDeploymentsDto,
  ): Promise<DeploymentListResponseDto> {
    return this.deployments.completeProjectDeployments(
      deploymentContext(authentication),
      projectId,
      dto,
    );
  }

  @Put('issues/:issueId/plan')
  @ApiOperation({ summary: '이슈 운영 배포 조건 변경' })
  @ApiOkResponse({ type: IssueDetailResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  updatePlan(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: UpdateIssueDeploymentPlanDto,
  ): Promise<IssueDetailResponseDto> {
    return this.deployments.updatePlan(deploymentContext(authentication), issueId, dto);
  }
}
