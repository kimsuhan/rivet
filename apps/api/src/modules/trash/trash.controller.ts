import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
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
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { RestoreTrashResourceDto, TrashListQueryDto } from './dto/trash-request.dto';
import { TrashListResponseDto, TrashRestoreResponseDto } from './dto/trash-response.dto';
import { TrashService } from './trash.service';

function workspaceContext(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  workspaceId: string;
} {
  const { membership, workspace } = authentication.session;
  if (
    !membership ||
    !workspace ||
    membership.status !== 'ACTIVE' ||
    membership.role !== 'ADMIN' ||
    membership.workspaceId !== workspace.id
  ) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: '관리자만 휴지통을 관리할 수 있습니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }
  return { membershipId: membership.id, workspaceId: workspace.id };
}

@ApiTags('trash')
@ApiCookieAuth('sessionCookie')
@UseGuards(AdminGuard)
@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  @ApiOperation({ summary: '현재 워크스페이스 휴지통 조회' })
  @ApiOkResponse({ type: TrashListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: TrashListQueryDto,
  ): Promise<TrashListResponseDto> {
    return this.trash.list(workspaceContext(authentication).workspaceId, query);
  }

  @Post('issues/:issueId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '휴지통 이슈 복구' })
  @ApiParam({ format: 'uuid', name: 'issueId' })
  @ApiOkResponse({ type: TrashRestoreResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  restoreIssue(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', new ParseUUIDPipe({ version: '4' })) issueId: string,
    @Body() dto: RestoreTrashResourceDto,
  ): Promise<TrashRestoreResponseDto> {
    return this.trash.restoreIssue(workspaceContext(authentication), issueId, dto.version);
  }

  @Post('projects/:projectId/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '휴지통 프로젝트 복구' })
  @ApiParam({ format: 'uuid', name: 'projectId' })
  @ApiOkResponse({ type: TrashRestoreResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  restoreProject(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
    @Body() dto: RestoreTrashResourceDto,
  ): Promise<TrashRestoreResponseDto> {
    return this.trash.restoreProject(workspaceContext(authentication), projectId, dto.version);
  }
}
