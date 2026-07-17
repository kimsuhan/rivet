import { Controller, Get, HttpStatus, Inject, Req, Res } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { apiConfig } from '../../config/api.config';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { EventsService } from './events.service';

function activeWorkspace(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
} {
  const { membership, sessionId, user, workspace } = authentication.session;

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
    sessionId,
    userId: user.id,
    workspaceId: workspace.id,
  };
}

@ApiTags('events')
@ApiCookieAuth('sessionCookie')
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    @Inject(apiConfig.KEY)
    private readonly config: Pick<ConfigType<typeof apiConfig>, 'webOrigin'>,
  ) {}

  @Get()
  @ApiOperation({ summary: '현재 워크스페이스 실시간 변경 스트림 연결' })
  @ApiOkResponse({
    content: {
      'text/event-stream': {
        schema: {
          example:
            'retry: 3000\n\nevent: resource.changed\nid: 7dd63904-4ca3-4e38-aa87-5398f021bb62\ndata: {"resourceType":"ISSUE","resourceId":"468ef342-f335-4dc6-b15d-57df4cc8f4e9","changeType":"UPDATED","version":8}\n\n',
          type: 'string',
        },
      },
    },
    description: 'resource.changed SSE 스트림',
  })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'SERVICE_UNAVAILABLE', type: ApiErrorResponseDto })
  connect(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const origin = request.get('origin');

    if (origin !== undefined && origin !== this.config.webOrigin) {
      throw new ApiError({
        code: 'CSRF_INVALID',
        message: '요청 출처를 확인할 수 없습니다.',
        status: HttpStatus.FORBIDDEN,
      });
    }

    const registration = this.events.openStream({
      ...activeWorkspace(authentication),
      end: () => {
        if (!response.writableEnded) response.end();
      },
      write: (chunk) => {
        if (response.writableEnded) return false;

        if (!response.headersSent) {
          response.status(HttpStatus.OK);
          response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          response.setHeader('Cache-Control', 'no-cache, no-transform');
          response.setHeader('Connection', 'keep-alive');
          response.setHeader('X-Accel-Buffering', 'no');
          response.flushHeaders();
        }

        return response.write(chunk);
      },
    });

    if (registration === null) {
      throw new ApiError({
        code: 'SERVICE_UNAVAILABLE',
        message: '실시간 연결을 일시적으로 사용할 수 없습니다.',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }

    if (registration.opened) {
      response.once('close', registration.unsubscribe);
    }
  }
}
