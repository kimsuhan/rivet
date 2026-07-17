import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiCookieAuth('sessionCookie')
@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post('workspaces')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '첫 워크스페이스 생성' })
  @ApiCreatedResponse({ type: WorkspaceResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 CSRF_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'WORKSPACE_LIMIT_REACHED 또는 WORKSPACE_SLUG_IN_USE',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  async create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    return this.workspaces.create(authentication.session.user.id, dto);
  }

  @Get('workspace')
  @ApiOperation({ summary: '현재 워크스페이스 조회' })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  getCurrent(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
  ): Promise<WorkspaceResponseDto> {
    return this.workspaces.getCurrent(authentication.session.membership?.workspaceId ?? null);
  }
}
