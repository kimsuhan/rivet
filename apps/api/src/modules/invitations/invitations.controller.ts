import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import type { Request } from 'express';

import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { PublicEndpoint } from '../auth/public.decorator';
import {
  AcceptInvitationResponseDto,
  CreateInvitationsDto,
  CreateInvitationsResponseDto,
  InvitationListQueryDto,
  InvitationListResponseDto,
  InvitationPreviewResponseDto,
  InvitationResponseDto,
  InvitationTokenDto,
} from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

@ApiTags('invitations')
@Controller('auth/invitations')
export class InvitationAuthController {
  constructor(private readonly invitations: InvitationsService) {}

  @PublicEndpoint()
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: '초대 토큰의 안전한 표시 정보 조회' })
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
  preview(
    @Body() dto: InvitationTokenDto,
    @Req() request: Request,
  ): Promise<InvitationPreviewResponseDto> {
    return this.invitations.preview(dto.token, clientIp(request));
  }

  @Post('accept')
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
  accept(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: InvitationTokenDto,
    @Req() request: Request,
  ): Promise<AcceptInvitationResponseDto> {
    return this.invitations.accept(authentication.session.user.id, dto.token, clientIp(request));
  }
}

@ApiTags('invitations')
@ApiCookieAuth('sessionCookie')
@UseGuards(AdminGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

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
    return this.invitations.list(authentication.session.workspace!.id, query);
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
