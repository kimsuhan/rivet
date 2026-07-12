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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  CreateCommentDto,
  CreateIssueBlockRelationDto,
  CreateIssueHandoffDto,
  DeleteCommentQueryDto,
  IssueTimelineQueryDto,
  RemoveIssueBlockRelationDto,
  UpdateCommentDto,
} from './dto/issue-collaboration-request.dto';
import {
  ActivityTimelineItemResponseDto,
  CommentResourceResponseDto,
  CommentTimelineItemResponseDto,
  HandoffResourceResponseDto,
  HandoffTimelineItemResponseDto,
  IssueBlockRelationMutationResponseDto,
  TimelineResponseDto,
} from './dto/issue-collaboration-response.dto';
import { IssueCollaborationService } from './issue-collaboration.service';

function workspaceContext(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  userId: string;
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
  return {
    membershipId: membership.id,
    userId: authentication.session.user.id,
    workspaceId: workspace.id,
  };
}

@ApiTags('issue block relations')
@ApiCookieAuth('sessionCookie')
@Controller('issue-block-relations')
export class IssueBlockRelationsController {
  constructor(private readonly collaboration: IssueCollaborationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '두 팀 작업 사이 차단 관계 생성' })
  @ApiCreatedResponse({ type: IssueBlockRelationMutationResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT, BLOCK_RELATION_DUPLICATE 또는 BLOCK_RELATION_CYCLE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR 또는 BLOCK_RELATION_SELF',
    type: ApiErrorResponseDto,
  })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateIssueBlockRelationDto,
  ): Promise<IssueBlockRelationMutationResponseDto> {
    return this.collaboration.createBlockRelation(workspaceContext(authentication), dto);
  }

  @Post(':relationId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '차단 관계 제거' })
  @ApiParam({ format: 'uuid', name: 'relationId' })
  @ApiOkResponse({ type: IssueBlockRelationMutationResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  remove(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('relationId', new ParseUUIDPipe({ version: '4' })) relationId: string,
    @Body() dto: RemoveIssueBlockRelationDto,
  ): Promise<IssueBlockRelationMutationResponseDto> {
    return this.collaboration.removeBlockRelation(
      workspaceContext(authentication),
      relationId,
      dto,
    );
  }
}

@ApiTags('issue collaboration')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(
  ActivityTimelineItemResponseDto,
  CommentTimelineItemResponseDto,
  HandoffTimelineItemResponseDto,
)
@Controller('issues')
export class IssueCollaborationController {
  constructor(private readonly collaboration: IssueCollaborationService) {}

  @Post(':issueId/handoffs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '최초 또는 추가 작업 전달 작성' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiCreatedResponse({ type: HandoffResourceResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'INITIAL_HANDOFF_EXISTS, INITIAL_HANDOFF_REQUIRED 또는 FILE_ALREADY_LINKED',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      'VALIDATION_ERROR, HANDOFF_NOT_ALLOWED, HANDOFF_CONTENT_REQUIRED, MARKDOWN_INVALID 또는 FILE_REFERENCE_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_INLINE_DISPLAYABLE',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  createHandoff(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: CreateIssueHandoffDto,
  ): Promise<HandoffResourceResponseDto> {
    return this.collaboration.createHandoff(workspaceContext(authentication), issueId, dto);
  }

  @Post(':issueId/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '이슈 댓글 작성' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiCreatedResponse({ type: CommentResourceResponseDto })
  @ApiConflictResponse({ description: 'FILE_ALREADY_LINKED', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR, MARKDOWN_INVALID, MENTION_INVALID 또는 FILE_REFERENCE_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_INLINE_DISPLAYABLE',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  createComment(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResourceResponseDto> {
    return this.collaboration.createComment(workspaceContext(authentication), issueId, dto);
  }

  @Get(':issueId/timeline')
  @ApiOperation({ summary: '댓글·활동·작업 전달 통합 타임라인 조회' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiOkResponse({ type: TimelineResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  timeline(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Query() dto: IssueTimelineQueryDto,
  ): Promise<TimelineResponseDto> {
    return this.collaboration.timeline(workspaceContext(authentication).workspaceId, issueId, dto);
  }
}

@ApiTags('issue comments')
@ApiCookieAuth('sessionCookie')
@Controller('comments')
export class CommentsController {
  constructor(private readonly collaboration: IssueCollaborationService) {}

  @Patch(':commentId')
  @ApiOperation({ summary: '자신의 댓글 수정' })
  @ApiParam({ format: 'uuid', name: 'commentId' })
  @ApiOkResponse({ type: CommentResourceResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 FILE_ALREADY_LINKED',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR, MARKDOWN_INVALID, MENTION_INVALID 또는 FILE_REFERENCE_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_INLINE_DISPLAYABLE',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentResourceResponseDto> {
    return this.collaboration.updateComment(workspaceContext(authentication), commentId, dto);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '자신의 댓글 본문 삭제' })
  @ApiParam({ format: 'uuid', name: 'commentId' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  remove(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Query() query: DeleteCommentQueryDto,
  ): Promise<void> {
    return this.collaboration.deleteComment(
      workspaceContext(authentication),
      commentId,
      query.version,
    );
  }
}
