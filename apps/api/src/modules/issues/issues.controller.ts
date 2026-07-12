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
  ApiBody,
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
  getSchemaPath,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  CreateFeatureIssueDto,
  CreateIssueDto,
  CreateTeamTaskIssueDto,
  IssueListQueryDto,
  TrashIssueDto,
  UpdateIssueDto,
} from './dto/issue-request.dto';
import { IssueDetailResponseDto, IssueListResponseDto } from './dto/issue-response.dto';
import { IssuesService } from './issues.service';

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

@ApiTags('issues')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(CreateFeatureIssueDto, CreateTeamTaskIssueDto)
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get()
  @ApiOperation({
    description:
      '기본 `updatedAt desc`와 불변 `id` 동률 해소를 사용합니다. 응답 cursor는 같은 정렬·필터 조건의 다음 페이지 조회에만 사용하는 불투명 값입니다.',
    summary: '현재 워크스페이스 이슈 목록 조회',
  })
  @ApiOkResponse({ type: IssueListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: IssueListQueryDto,
  ): Promise<IssueListResponseDto> {
    return this.issues.list(workspaceContext(authentication), query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '기능 이슈 또는 팀 작업 생성' })
  @ApiBody({
    schema: {
      discriminator: {
        mapping: {
          FEATURE: getSchemaPath(CreateFeatureIssueDto),
          TEAM_TASK: getSchemaPath(CreateTeamTaskIssueDto),
        },
        propertyName: 'type',
      },
      oneOf: [
        { $ref: getSchemaPath(CreateFeatureIssueDto) },
        { $ref: getSchemaPath(CreateTeamTaskIssueDto) },
      ],
    },
  })
  @ApiCreatedResponse({ type: IssueDetailResponseDto })
  @ApiConflictResponse({ description: 'FILE_ALREADY_LINKED', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      'VALIDATION_ERROR, ISSUE_TYPE_FIELD_INVALID, ASSIGNEE_NOT_TEAM_MEMBER, PROJECT_ROLE_TEAM_MISMATCH, PARENT_ISSUE_PROJECT_MISMATCH, MARKDOWN_INVALID, MENTION_INVALID 또는 FILE_REFERENCE_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_INLINE_DISPLAYABLE',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateIssueDto,
  ): Promise<IssueDetailResponseDto> {
    return this.issues.create(workspaceContext(authentication), dto);
  }

  @Get(':issueRef')
  @ApiOperation({ summary: 'UUID 또는 표시 ID로 이슈 상세 조회' })
  @ApiParam({ name: 'issueRef' })
  @ApiOkResponse({ type: IssueDetailResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  get(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueRef') issueRef: string,
  ): Promise<IssueDetailResponseDto> {
    return this.issues.get(workspaceContext(authentication).workspaceId, issueRef);
  }

  @Patch(':issueId')
  @ApiOperation({ summary: '이슈 제목과 유형별 속성 수정' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiOkResponse({ type: IssueDetailResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'VERSION_CONFLICT, ISSUE_TEAM_IMMUTABLE, ISSUE_PROJECT_IMMUTABLE, HANDOFF_REQUIRED, INITIAL_HANDOFF_EXISTS 또는 FILE_ALREADY_LINKED',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description:
      'VALIDATION_ERROR, ISSUE_TYPE_FIELD_INVALID, ASSIGNEE_NOT_TEAM_MEMBER, PROJECT_ROLE_TEAM_MISMATCH, PARENT_ISSUE_PROJECT_MISMATCH, HANDOFF_NOT_ALLOWED, HANDOFF_REQUIRES_COMPLETION, MARKDOWN_INVALID, MENTION_INVALID 또는 FILE_REFERENCE_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_INLINE_DISPLAYABLE',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: UpdateIssueDto,
  ): Promise<IssueDetailResponseDto> {
    return this.issues.update(workspaceContext(authentication), issueId, dto);
  }

  @Post(':issueId/trash')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '조건 확인 후 이슈를 휴지통으로 이동' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiNoContentResponse({ description: '휴지통 이동 완료' })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT, ISSUE_HAS_CHILDREN 또는 ISSUE_BLOCKS_OTHERS',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  trash(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: TrashIssueDto,
  ): Promise<void> {
    return this.issues.trash(workspaceContext(authentication), issueId, dto.version);
  }
}
