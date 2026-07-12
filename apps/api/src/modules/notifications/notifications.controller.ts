import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { ObservabilityService } from '../../common/observability/observability.service';
import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  NotificationListQueryDto,
  NotificationListResponseDto,
  NotificationReadAllResponseDto,
  NotificationResponseDto,
  NotificationUnreadCountResponseDto,
  UpdateNotificationReadDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

function activeWorkspace(authentication: AuthenticatedRequestContext): {
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

@ApiTags('notifications')
@ApiCookieAuth('sessionCookie')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly observability: ObservabilityService,
  ) {}

  @Get()
  @ApiOperation({ summary: '현재 사용자의 알림 목록' })
  @ApiOkResponse({ type: NotificationListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  async list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: NotificationListQueryDto,
  ): Promise<NotificationListResponseDto> {
    const context = activeWorkspace(authentication);
    const result = await this.notifications.list(context, query);
    if (query.cursor === undefined && this.observability.isProductAnalyticsEnabled()) {
      void this.notifications
        .unreadCount(context)
        .then((unread) =>
          this.observability.capture({
            distinctId: context.membershipId,
            name: 'inbox_opened',
            properties: {
              unreadCount: unread.count,
              workspaceId: context.workspaceId,
            },
          }),
        )
        .catch(() =>
          this.logger.warn(
            { errorCode: 'INBOX_ANALYTICS_COUNT_FAILED', workspaceId: context.workspaceId },
            '알림함 분석 개수 조회 실패',
          ),
        );
    }
    return result;
  }

  @Get('unread-count')
  @ApiOperation({ summary: '현재 사용자의 읽지 않은 알림 개수' })
  @ApiOkResponse({ type: NotificationUnreadCountResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  unreadCount(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
  ): Promise<NotificationUnreadCountResponseDto> {
    return this.notifications.unreadCount(activeWorkspace(authentication));
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '현재 사용자의 모든 알림 읽음 처리' })
  @ApiOkResponse({ type: NotificationReadAllResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  async readAll(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
  ): Promise<NotificationReadAllResponseDto> {
    const context = activeWorkspace(authentication);
    const result = await this.notifications.readAll(context);
    if (result.updatedCount > 0) {
      this.observability.capture({
        distinctId: context.membershipId,
        name: 'notification_read',
        properties: { notificationType: 'ALL', workspaceId: context.workspaceId },
      });
    }
    return result;
  }

  @Patch(':notificationId')
  @ApiOperation({ summary: '알림 읽음 상태 변경' })
  @ApiParam({ format: 'uuid', name: 'notificationId' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiBadRequestResponse({ description: '잘못된 notificationId', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  async updateRead(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' })) notificationId: string,
    @Body() dto: UpdateNotificationReadDto,
  ): Promise<NotificationResponseDto> {
    const context = activeWorkspace(authentication);
    return this.notifications.updateRead(context, notificationId, dto);
  }
}
