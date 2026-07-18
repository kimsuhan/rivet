import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  ApplyIssueTemplateDto,
  ArchiveIssueTemplateDto,
  CreateIssueTemplateDto,
  IssueTemplateListQueryDto,
  IssueTemplateListResponseDto,
  IssueTemplateResponseDto,
  RestoreIssueTemplateDto,
  UpdateIssueTemplateDto,
} from './dto/issue-template.dto';
import { IssueTemplatesService } from './issue-templates.service';

function workspaceContext(authentication: AuthenticatedRequestContext): {
  membershipRole: 'ADMIN' | 'MEMBER';
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
  return { membershipRole: membership.role, workspaceId: workspace.id };
}

@ApiTags('issue-templates')
@ApiCookieAuth('sessionCookie')
@Controller('issue-templates')
export class IssueTemplatesController {
  constructor(private readonly issueTemplates: IssueTemplatesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '워크스페이스 이슈 템플릿 목록 조회' })
  @ApiOkResponse({ type: IssueTemplateListResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'MEMBERSHIP_INACTIVE 또는 보관 템플릿 조회 권한 없음',
    type: ApiErrorResponseDto,
  })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: IssueTemplateListQueryDto,
  ): Promise<IssueTemplateListResponseDto> {
    const context = workspaceContext(authentication);
    return this.issueTemplates.list(
      context.workspaceId,
      query.includeArchived,
      context.membershipRole,
    );
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '워크스페이스 이슈 템플릿 생성' })
  @ApiCreatedResponse({ type: IssueTemplateResponseDto })
  @ApiConflictResponse({ description: 'ISSUE_TEMPLATE_NAME_IN_USE', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN 또는 CSRF_INVALID', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR, MARKDOWN_INVALID 또는 ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
    type: ApiErrorResponseDto,
  })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.issueTemplates.create(workspaceContext(authentication).workspaceId, dto);
  }

  @Patch(':issueTemplateId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '워크스페이스 이슈 템플릿 수정' })
  @ApiParam({ format: 'uuid', name: 'issueTemplateId' })
  @ApiOkResponse({ type: IssueTemplateResponseDto })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT, ISSUE_TEMPLATE_NAME_IN_USE 또는 ISSUE_TEMPLATE_UNAVAILABLE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN 또는 CSRF_INVALID', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR, MARKDOWN_INVALID 또는 ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
    type: ApiErrorResponseDto,
  })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueTemplateId', new ParseUUIDPipe({ version: '4' })) issueTemplateId: string,
    @Body() dto: UpdateIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.issueTemplates.update(
      workspaceContext(authentication).workspaceId,
      issueTemplateId,
      dto,
    );
  }

  @Post(':issueTemplateId/archive')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '워크스페이스 이슈 템플릿 보관' })
  @ApiParam({ format: 'uuid', name: 'issueTemplateId' })
  @ApiOkResponse({ type: IssueTemplateResponseDto })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN 또는 CSRF_INVALID', type: ApiErrorResponseDto })
  archive(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueTemplateId', new ParseUUIDPipe({ version: '4' })) issueTemplateId: string,
    @Body() dto: ArchiveIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.issueTemplates.archive(
      workspaceContext(authentication).workspaceId,
      issueTemplateId,
      dto,
    );
  }

  @Post(':issueTemplateId/restore')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '보관된 워크스페이스 이슈 템플릿 복구' })
  @ApiParam({ format: 'uuid', name: 'issueTemplateId' })
  @ApiOkResponse({ type: IssueTemplateResponseDto })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 ISSUE_TEMPLATE_NAME_IN_USE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN 또는 CSRF_INVALID', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
    type: ApiErrorResponseDto,
  })
  restore(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueTemplateId', new ParseUUIDPipe({ version: '4' })) issueTemplateId: string,
    @Body() dto: RestoreIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.issueTemplates.restore(
      workspaceContext(authentication).workspaceId,
      issueTemplateId,
      dto,
    );
  }

  @Post(':issueTemplateId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이슈 생성 입력에 적용할 템플릿 복사본 조회' })
  @ApiParam({ format: 'uuid', name: 'issueTemplateId' })
  @ApiOkResponse({ type: IssueTemplateResponseDto })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 ISSUE_TEMPLATE_UNAVAILABLE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'MEMBERSHIP_INACTIVE', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE',
    type: ApiErrorResponseDto,
  })
  apply(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueTemplateId', new ParseUUIDPipe({ version: '4' })) issueTemplateId: string,
    @Body() dto: ApplyIssueTemplateDto,
  ): Promise<IssueTemplateResponseDto> {
    return this.issueTemplates.apply(
      workspaceContext(authentication).workspaceId,
      issueTemplateId,
      dto,
    );
  }
}
