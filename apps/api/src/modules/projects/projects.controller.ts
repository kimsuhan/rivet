import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  ArchiveProjectDto,
  CreateProjectDto,
  ProjectListQueryDto,
  UpdateProjectDto,
} from './dto/project-request.dto';
import { ProjectListResponseDto, ProjectResponseDto } from './dto/project-response.dto';
import { ProjectsService } from './projects.service';

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

@ApiTags('projects')
@ApiCookieAuth('sessionCookie')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: '현재 워크스페이스 프로젝트 목록 조회' })
  @ApiOkResponse({ type: ProjectListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: ProjectListQueryDto,
  ): Promise<ProjectListResponseDto> {
    return this.projects.list(workspaceContext(authentication).workspaceId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '프로젝트 생성' })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR, PROJECT_ROLE_REQUIRED 또는 PROJECT_DATE_INVALID',
    type: ApiErrorResponseDto,
  })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projects.create(workspaceContext(authentication), dto);
  }

  @Get(':projectId')
  @ApiOperation({ summary: '프로젝트 상세와 진행률 조회' })
  @ApiParam({ format: 'uuid', name: 'projectId' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  get(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
  ): Promise<ProjectResponseDto> {
    return this.projects.get(workspaceContext(authentication).workspaceId, projectId);
  }

  @Patch(':projectId')
  @ApiOperation({ summary: '프로젝트 기본 정보, 상태와 역할별 팀 수정' })
  @ApiParam({ format: 'uuid', name: 'projectId' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 PROJECT_ROLE_IN_USE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR, PROJECT_ROLE_REQUIRED 또는 PROJECT_DATE_INVALID',
    type: ApiErrorResponseDto,
  })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projects.update(workspaceContext(authentication), projectId, dto);
  }

  @Post(':projectId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '프로젝트 보관' })
  @ApiParam({ format: 'uuid', name: 'projectId' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  archive(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: ArchiveProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.projects.archive(workspaceContext(authentication), projectId, dto);
  }

  @Post(':projectId/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '비어 있는 프로젝트를 휴지통으로 이동' })
  @ApiParam({ format: 'uuid', name: 'projectId' })
  @ApiNoContentResponse({ description: '휴지통 이동 완료' })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 PROJECT_NOT_EMPTY',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  trash(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: ArchiveProjectDto,
  ): Promise<void> {
    return this.projects.trash(workspaceContext(authentication), projectId, dto.version);
  }
}
