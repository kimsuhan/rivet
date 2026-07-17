import {
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
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  MemberDetailResponseDto,
  MemberListQueryDto,
  MemberListResponseDto,
} from './dto/member.dto';
import { MembersService } from './members.service';

@ApiTags('members')
@ApiCookieAuth('sessionCookie')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({ summary: '현재 워크스페이스 멤버 목록' })
  @ApiOkResponse({ type: MemberListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: MemberListQueryDto,
  ): Promise<MemberListResponseDto> {
    return this.members.list(
      {
        includeEmail: authentication.session.membership?.role === 'ADMIN',
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      query,
    );
  }

  @Get(':membershipId')
  @ApiOperation({ summary: '현재 워크스페이스 멤버 상세와 팀 요약' })
  @ApiOkResponse({ type: MemberDetailResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  get(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('membershipId', new ParseUUIDPipe({ version: '4' })) membershipId: string,
  ): Promise<MemberDetailResponseDto> {
    return this.members.get(
      {
        includeEmail: authentication.session.membership?.role === 'ADMIN',
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      membershipId,
    );
  }

  @Post(':membershipId/deactivate')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '멤버 비활성화와 대상 사용자의 전체 세션 폐기' })
  @ApiOkResponse({ type: MemberDetailResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'CSRF_INVALID 또는 FORBIDDEN', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiConflictResponse({
    description: 'MEMBER_HAS_OPEN_ASSIGNMENTS',
    type: ApiErrorResponseDto,
  })
  deactivate(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('membershipId', new ParseUUIDPipe({ version: '4' })) membershipId: string,
  ): Promise<MemberDetailResponseDto> {
    return this.members.deactivate(
      {
        membershipId: authentication.session.membership!.id,
        workspaceId: authentication.session.workspace!.id,
      },
      membershipId,
    );
  }
}
