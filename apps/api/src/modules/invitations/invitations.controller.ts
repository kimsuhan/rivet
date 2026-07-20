import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  clearInvitationContinuationCookie,
  readInvitationContinuationCookie,
  setInvitationContinuationCookie,
} from '../../common/auth/invitation-continuation-cookie';
import { readSessionCookie } from '../../common/auth/session-cookie';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { apiConfig } from '../../config/api.config';
import { AuthSessionService } from '../auth/auth-session.service';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { PublicEndpoint } from '../auth/public.decorator';
import {
  AcceptInvitationResponseDto,
  CreateInvitationsDto,
  CreateInvitationsResponseDto,
  InvitationContinuationResponseDto,
  InvitationListQueryDto,
  InvitationListResponseDto,
  InvitationPreviewResponseDto,
  InvitationResponseDto,
  InvitationTokenDto,
} from './dto/invitation.dto';
import { InvitationContinuationService } from './invitation-continuation.service';
import { InvitationQueryService } from './invitation-query.service';
import { InvitationsService } from './invitations.service';

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

@ApiTags('invitations')
@Controller('auth/invitations')
export class InvitationAuthController {
  constructor(
    private readonly continuations: InvitationContinuationService,
    private readonly sessions: AuthSessionService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  @PublicEndpoint()
  @Post('continuation')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: '초대 링크를 브라우저의 안전한 진행 상태로 교환' })
  @ApiOkResponse({ type: InvitationPreviewResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_REQUEST', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'CSRF_INVALID', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'TOKEN_ALREADY_USED', type: ApiErrorResponseDto })
  @ApiGoneResponse({ description: 'TOKEN_EXPIRED', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR 또는 TOKEN_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'RATE_LIMITED',
    headers: {
      'Retry-After': {
        description: '다시 요청할 수 있을 때까지 남은 초',
        schema: { minimum: 1, type: 'integer' },
      },
    },
    type: ApiErrorResponseDto,
  })
  async startContinuation(
    @Body() dto: InvitationTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvitationPreviewResponseDto> {
    const result = await this.continuations.startContinuation(
      dto.token,
      readInvitationContinuationCookie(request, this.config),
      clientIp(request),
    );
    setInvitationContinuationCookie(
      response,
      this.config,
      result.continuationToken,
      result.expiresAt,
    );
    return result.response;
  }

  @PublicEndpoint()
  @Get('continuation')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: '현재 브라우저 또는 로그인 계정의 초대 진행 상태 조회' })
  @ApiOkResponse({ type: InvitationContinuationResponseDto })
  @ApiConflictResponse({ description: 'TOKEN_ALREADY_USED', type: ApiErrorResponseDto })
  @ApiGoneResponse({ description: 'TOKEN_EXPIRED', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'INVITATION_CONTINUATION_NOT_FOUND',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'TOKEN_INVALID', type: ApiErrorResponseDto })
  async getContinuation(@Req() request: Request): Promise<InvitationContinuationResponseDto> {
    return this.continuations.getContinuation(
      readInvitationContinuationCookie(request, this.config),
      await this.optionalUserId(request),
    );
  }

  @PublicEndpoint()
  @Delete('continuation')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '현재 초대 진행 상태 닫기' })
  async dismissContinuation(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.continuations.dismissContinuation(
      readInvitationContinuationCookie(request, this.config),
      await this.optionalUserId(request),
    );
    clearInvitationContinuationCookie(response, this.config);
  }

  @Post('continuation/accept')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({
    description:
      '멤버십이 없으면 새 MEMBER를 만들고, 같은 워크스페이스의 기존 활성 MEMBER가 재발급 링크를 확인하면 멤버십을 재사용해 초대와 토큰만 종료한다.',
    summary: '현재 로그인 계정으로 초대 수락',
  })
  @ApiOkResponse({
    description: '수락에 사용한 신규 또는 기존 활성 멤버십과 워크스페이스',
    type: AcceptInvitationResponseDto,
  })
  @ApiBadRequestResponse({ description: 'INVALID_REQUEST', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 CSRF_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'TOKEN_ALREADY_USED, INVITATION_EMAIL_MISMATCH 또는 WORKSPACE_LIMIT_REACHED',
    type: ApiErrorResponseDto,
  })
  @ApiGoneResponse({ description: 'TOKEN_EXPIRED', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'INVITATION_CONTINUATION_NOT_FOUND',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_ERROR 또는 TOKEN_INVALID',
    type: ApiErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'RATE_LIMITED',
    headers: {
      'Retry-After': {
        description: '다시 요청할 수 있을 때까지 남은 초',
        schema: { minimum: 1, type: 'integer' },
      },
    },
    type: ApiErrorResponseDto,
  })
  async accept(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AcceptInvitationResponseDto> {
    const result = await this.continuations.accept(
      authentication.session.user.id,
      readInvitationContinuationCookie(request, this.config),
    );
    clearInvitationContinuationCookie(response, this.config);
    return result;
  }

  private async optionalUserId(request: Request): Promise<string | null> {
    const sessionToken = readSessionCookie(request, this.config);
    if (!sessionToken) {
      return null;
    }

    return (await this.sessions.resolve(sessionToken))?.user.id ?? null;
  }
}

@ApiTags('invitations')
@ApiCookieAuth('sessionCookie')
@UseGuards(AdminGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitationQueries: InvitationQueryService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: '워크스페이스 초대 목록' })
  @ApiOkResponse({ type: InvitationListResponseDto })
  @ApiBadRequestResponse({
    description: 'INVALID_QUERY (cursor 또는 status)',
    type: ApiErrorResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: InvitationListQueryDto,
  ): Promise<InvitationListResponseDto> {
    return this.invitationQueries.list(authentication.session.workspace!.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이메일 여러 건으로 워크스페이스 초대' })
  @ApiOkResponse({ type: CreateInvitationsResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'CSRF_INVALID 또는 FORBIDDEN', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'RATE_LIMITED',
    headers: {
      'Retry-After': {
        description: '다시 요청할 수 있을 때까지 남은 초',
        schema: { minimum: 1, type: 'integer' },
      },
    },
    type: ApiErrorResponseDto,
  })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateInvitationsDto,
  ): Promise<CreateInvitationsResponseDto> {
    return this.invitations.create(
      {
        membershipId: authentication.session.membership!.id,
        role: authentication.session.membership!.role,
        workspaceId: authentication.session.workspace!.id,
      },
      dto.emails,
    );
  }

  @Post(':invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    description:
      '대기·만료 초대는 같은 행을 갱신하고 수락·취소 초대는 새 이력 행을 만들어 재발송한다.',
    summary: '초대 재발송 또는 종료 이력 재초대',
  })
  @ApiParam({ format: 'uuid', name: 'invitationId' })
  @ApiOkResponse({
    description: '실제 유효한 초대 행. 종료 이력 재발송이면 요청 경로와 다른 새 id를 반환한다.',
    type: InvitationResponseDto,
  })
  @ApiBadRequestResponse({ description: 'INVALID_REQUEST', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'CSRF_INVALID 또는 FORBIDDEN', type: ApiErrorResponseDto })
  @ApiConflictResponse({
    description: 'INVITATION_ALREADY_PENDING',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'RATE_LIMITED',
    headers: {
      'Retry-After': {
        description: '다시 요청할 수 있을 때까지 남은 초',
        schema: { minimum: 1, type: 'integer' },
      },
    },
    type: ApiErrorResponseDto,
  })
  resend(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('invitationId', new ParseUUIDPipe({ version: '4' })) invitationId: string,
  ): Promise<InvitationResponseDto> {
    return this.invitations.resend(
      {
        membershipId: authentication.session.membership!.id,
        workspaceId: authentication.session.workspace!.id,
      },
      invitationId,
    );
  }

  @Post(':invitationId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '대기 중인 초대 취소' })
  @ApiOkResponse({ type: InvitationResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  cancel(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('invitationId', new ParseUUIDPipe({ version: '4' })) invitationId: string,
  ): Promise<InvitationResponseDto> {
    return this.invitations.cancel(authentication.session.workspace!.id, invitationId);
  }
}

@ApiTags('invitations')
@ApiCookieAuth('sessionCookie')
@Controller('teams/:teamId/invitations')
export class TeamInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '관리 중인 팀으로 이메일 초대' })
  @ApiOkResponse({ type: CreateInvitationsResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'CSRF_INVALID 또는 FORBIDDEN', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('teamId', new ParseUUIDPipe({ version: '4' })) teamId: string,
    @Body() dto: CreateInvitationsDto,
  ): Promise<CreateInvitationsResponseDto> {
    return this.invitations.create(
      {
        membershipId: authentication.session.membership!.id,
        role: authentication.session.membership!.role,
        workspaceId: authentication.session.workspace!.id,
      },
      dto.emails,
      teamId,
    );
  }
}
