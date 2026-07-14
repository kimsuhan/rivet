import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiConflictResponse, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { RemoveTeamWorkDto, TeamWorkListQueryDto, UpdateTeamWorkDto } from './dto/issue-request.dto';
import { IssueDetailResponseDto, TeamWorkDetailResponseDto, TeamWorkListResponseDto, UpdateTeamWorkResponseDto } from './dto/issue-response.dto';
import { workspaceContext } from './issues.controller';
import { TeamWorksService } from './team-works.service';

@ApiTags('team-works')
@ApiCookieAuth('sessionCookie')
@Controller('team-works')
export class TeamWorksController {
  constructor(private readonly teamWorks: TeamWorksService) {}

  @Get()
  @ApiOperation({ summary: '내 작업과 팀 작업 목록 조회' })
  @ApiOkResponse({ type: TeamWorkListResponseDto })
  list(@CurrentAuthentication() authentication: AuthenticatedRequestContext, @Query() query: TeamWorkListQueryDto): Promise<TeamWorkListResponseDto> {
    return this.teamWorks.list(workspaceContext(authentication), query);
  }

  @Get(':teamWorkRef')
  @ApiOperation({ summary: 'UUID 또는 팀 표시 ID로 팀 작업과 상위 이슈 요약 조회' })
  @ApiOkResponse({ type: TeamWorkDetailResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(@CurrentAuthentication() authentication: AuthenticatedRequestContext, @Param('teamWorkRef') teamWorkRef: string): Promise<TeamWorkDetailResponseDto> {
    return this.teamWorks.get(workspaceContext(authentication).workspaceId, teamWorkRef);
  }

  @Patch(':teamWorkId')
  @ApiOperation({ summary: '팀 작업 상태, 담당자와 Markdown 작업 노트 수정' })
  @ApiOkResponse({ type: UpdateTeamWorkResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamWorkId', new ParseUUIDPipe({ version: '4' })) teamWorkId: string,
    @Body() dto: UpdateTeamWorkDto,
  ): Promise<UpdateTeamWorkResponseDto> {
    return this.teamWorks.update(workspaceContext(authentication), teamWorkId, dto);
  }

  @Post(':teamWorkId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이슈 안에서 팀 작업 제거' })
  @ApiOkResponse({ type: IssueDetailResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  remove(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamWorkId', new ParseUUIDPipe({ version: '4' })) teamWorkId: string,
    @Body() dto: RemoveTeamWorkDto,
  ): Promise<IssueDetailResponseDto> {
    return this.teamWorks.remove(workspaceContext(authentication), teamWorkId, dto);
  }
}
