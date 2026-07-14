import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  AssignTeamWorksDto,
  ClaimTeamWorkDto,
  CreateIssueDto,
  IssueListQueryDto,
  StartIssueDto,
  TrashIssueDto,
  UpdateIssueDto,
} from './dto/issue-request.dto';
import {
  AssignTeamWorksResponseDto,
  ClaimTeamWorkResponseDto,
  CreateIssueResponseDto,
  IssueDetailResponseDto,
  IssueListResponseDto,
  StartIssueResponseDto,
  TeamWorkListResponseDto,
  UpdateIssueResponseDto,
} from './dto/issue-response.dto';
import { type IssueMutationContext,IssuesService } from './issues.service';

export function workspaceContext(authentication: AuthenticatedRequestContext): IssueMutationContext {
  const { membership, workspace } = authentication.session;
  if (!membership || !workspace || membership.status !== 'ACTIVE' || membership.workspaceId !== workspace.id) {
    throw new ApiError({ code: 'FORBIDDEN', message: '활성 워크스페이스가 필요합니다.', status: HttpStatus.FORBIDDEN });
  }
  return { membershipId: membership.id, userId: authentication.session.user.id, workspaceId: workspace.id };
}

@ApiTags('issues')
@ApiCookieAuth('sessionCookie')
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get()
  @ApiOperation({ summary: '이슈 콘텐츠 목록 조회' })
  @ApiOkResponse({ type: IssueListResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  list(@CurrentAuthentication() authentication: AuthenticatedRequestContext, @Query() query: IssueListQueryDto): Promise<IssueListResponseDto> {
    return this.issues.list(workspaceContext(authentication), query);
  }

  @Get(':issueId/team-works')
  @ApiOperation({ summary: '이슈에 속한 팀 작업 조회' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiOkResponse({ type: TeamWorkListResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  listTeamWorks(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
  ): Promise<TeamWorkListResponseDto> {
    return this.issues.listTeamWorks(workspaceContext(authentication).workspaceId, issueId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '이슈 생성 및 선택적인 최초 팀 작업 시작' })
  @ApiCreatedResponse({ type: CreateIssueResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  create(@CurrentAuthentication() authentication: AuthenticatedRequestContext, @Body() dto: CreateIssueDto): Promise<CreateIssueResponseDto> {
    return this.issues.create(workspaceContext(authentication), dto);
  }

  @Post(':issueId/team-works')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이슈에서 팀 작업 시작' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiOkResponse({ type: StartIssueResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  start(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: StartIssueDto,
  ): Promise<StartIssueResponseDto> {
    return this.issues.start(workspaceContext(authentication), issueId, dto);
  }

  @Post(':issueId/claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '현재 사용자가 이슈의 팀 작업 맡기' })
  @ApiOkResponse({ type: ClaimTeamWorkResponseDto })
  claim(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: ClaimTeamWorkDto,
  ): Promise<ClaimTeamWorkResponseDto> {
    return this.issues.claim(workspaceContext(authentication), issueId, dto);
  }

  @Post(':issueId/assign-team-works')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이슈의 미할당 팀 작업 담당자 일괄 지정' })
  @ApiOkResponse({ type: AssignTeamWorksResponseDto })
  assignTeamWorks(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: AssignTeamWorksDto,
  ): Promise<AssignTeamWorksResponseDto> {
    return this.issues.assignTeamWorks(workspaceContext(authentication), issueId, dto);
  }

  @Get(':issueRef')
  @ApiOperation({ summary: 'UUID 또는 F-* 표시 ID로 이슈 통합 상세 조회' })
  @ApiOkResponse({ type: IssueDetailResponseDto })
  get(@CurrentAuthentication() authentication: AuthenticatedRequestContext, @Param('issueRef') issueRef: string): Promise<IssueDetailResponseDto> {
    return this.issues.get(workspaceContext(authentication).workspaceId, issueRef);
  }

  @Patch(':issueId')
  @ApiOperation({ summary: '이슈 콘텐츠와 상태 행동 수정' })
  @ApiOkResponse({ type: UpdateIssueResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: UpdateIssueDto,
  ): Promise<UpdateIssueResponseDto> {
    return this.issues.update(workspaceContext(authentication), issueId, dto);
  }

  @Post(':issueId/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '이슈와 소속 팀 작업을 휴지통으로 이동' })
  @ApiNoContentResponse()
  trash(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: TrashIssueDto,
  ): Promise<void> {
    return this.issues.trash(workspaceContext(authentication), issueId, dto.version);
  }
}
