import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { Prisma, WebPushSubscriptionStatus } from '@rivet/database';
import {
  WEB_PUSH_TEST_REQUESTED,
  WEB_PUSH_TEST_REQUESTED_SCHEMA_VERSION,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { apiConfig } from '../../config/api.config';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from '../auth/auth-rate-limit.service';
import type {
  RegisterWebPushSubscriptionDto,
  WebPushConfigResponseDto,
  WebPushSubscriptionListResponseDto,
  WebPushSubscriptionResponseDto,
  WebPushTestAcceptedResponseDto,
} from './dto/web-push-subscription.dto';

const SUBSCRIPTION_SELECT = {
  browser: true,
  createdAt: true,
  expirationTime: true,
  id: true,
  lastFailedAt: true,
  lastSucceededAt: true,
  sessionId: true,
  status: true,
} satisfies Prisma.WebPushSubscriptionSelect;

type SubscriptionRow = Prisma.WebPushSubscriptionGetPayload<{
  select: typeof SUBSCRIPTION_SELECT;
}>;

function toResponse(row: SubscriptionRow, sessionId: string): WebPushSubscriptionResponseDto {
  return {
    browser: row.browser,
    createdAt: row.createdAt.toISOString(),
    expirationTime: row.expirationTime?.toISOString() ?? null,
    id: row.id,
    isCurrentSession: row.sessionId === sessionId,
    lastFailedAt: row.lastFailedAt?.toISOString() ?? null,
    lastSucceededAt: row.lastSucceededAt?.toISOString() ?? null,
    status: row.status,
  };
}

function notFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: 'Push 구독을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function endpointInUse(): never {
  throw new ApiError({
    code: 'WEB_PUSH_SUBSCRIPTION_IN_USE',
    message: '이 브라우저 구독은 다른 로그인에 연결되어 있습니다.',
    status: HttpStatus.CONFLICT,
  });
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class WebPushSubscriptionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: AuthRateLimitService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  configResponse(): WebPushConfigResponseDto {
    const publicKey = this.config.webPush.vapidPublicKey;
    return { enabled: publicKey !== null, publicKey };
  }

  async list(context: {
    membershipId: string;
    sessionId: string;
    workspaceId: string;
  }): Promise<WebPushSubscriptionListResponseDto> {
    const items = await this.database.client.webPushSubscription.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: SUBSCRIPTION_SELECT,
      where: { membershipId: context.membershipId, workspaceId: context.workspaceId },
    });

    return { items: items.map((item) => toResponse(item, context.sessionId)) };
  }

  async register(
    context: { membershipId: string; sessionId: string; workspaceId: string },
    dto: RegisterWebPushSubscriptionDto,
  ): Promise<WebPushSubscriptionResponseDto> {
    if (!this.config.webPush.vapidPublicKey) {
      throw new ApiError({
        code: 'WEB_PUSH_NOT_CONFIGURED',
        message: 'Web Push 운영 설정이 완료되지 않았습니다.',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }

    const p256dh = Buffer.from(dto.keys.p256dh, 'base64url');
    const auth = Buffer.from(dto.keys.auth, 'base64url');
    if (
      p256dh.byteLength !== 65 ||
      p256dh[0] !== 4 ||
      auth.byteLength !== 16 ||
      p256dh.toString('base64url') !== dto.keys.p256dh ||
      auth.toString('base64url') !== dto.keys.auth
    ) {
      throw new ApiError({
        code: 'INVALID_WEB_PUSH_SUBSCRIPTION',
        message: '브라우저 Push 구독 키가 올바르지 않습니다.',
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const expirationTime =
      dto.expirationTime === undefined || dto.expirationTime === null
        ? null
        : new Date(dto.expirationTime);
    if (expirationTime !== null && expirationTime.getTime() <= Date.now()) {
      throw new ApiError({
        code: 'WEB_PUSH_SUBSCRIPTION_EXPIRED',
        message: '만료된 Push 구독입니다. 브라우저에서 다시 등록해 주세요.',
        status: HttpStatus.CONFLICT,
      });
    }

    const endpointHash = createHash('sha256').update(dto.endpoint).digest('hex');
    const activeOwner = await this.database.client.webPushSubscription.findFirst({
      select: { membershipId: true },
      where: { endpointHash, status: WebPushSubscriptionStatus.ACTIVE },
    });
    if (activeOwner && activeOwner.membershipId !== context.membershipId) endpointInUse();

    let row: SubscriptionRow;
    try {
      row = await this.database.client.$transaction((transaction) =>
        transaction.webPushSubscription.upsert({
          create: {
            auth: dto.keys.auth,
            browser: dto.browser,
            endpoint: dto.endpoint,
            endpointHash,
            expirationTime,
            membershipId: context.membershipId,
            p256dh: dto.keys.p256dh,
            sessionId: context.sessionId,
            workspaceId: context.workspaceId,
          },
          select: SUBSCRIPTION_SELECT,
          update: {
            auth: dto.keys.auth,
            browser: dto.browser,
            disabledAt: null,
            endpoint: dto.endpoint,
            expirationTime,
            lastErrorCode: null,
            p256dh: dto.keys.p256dh,
            sessionId: context.sessionId,
            status: WebPushSubscriptionStatus.ACTIVE,
          },
          where: {
            membershipId_endpointHash: {
              endpointHash,
              membershipId: context.membershipId,
            },
          },
        }),
      );
    } catch (error) {
      if (isUniqueConflict(error)) endpointInUse();
      throw error;
    }

    return toResponse(row, context.sessionId);
  }

  async deactivate(
    context: { membershipId: string; workspaceId: string },
    subscriptionId: string,
  ): Promise<void> {
    const updated = await this.database.client.webPushSubscription.updateMany({
      data: {
        auth: null,
        disabledAt: new Date(),
        endpoint: null,
        p256dh: null,
        status: WebPushSubscriptionStatus.INACTIVE,
      },
      where: {
        id: subscriptionId,
        membershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
    if (updated.count === 0) notFound();
  }

  async requestTest(
    context: { membershipId: string; workspaceId: string },
    subscriptionId: string,
  ): Promise<WebPushTestAcceptedResponseDto> {
    const eventId = randomUUID();
    const subscription = await this.database.client.webPushSubscription.findFirst({
      select: { id: true },
      where: {
        id: subscriptionId,
        membershipId: context.membershipId,
        status: WebPushSubscriptionStatus.ACTIVE,
        workspaceId: context.workspaceId,
      },
    });
    if (!subscription) notFound();

    await this.rateLimits.consume(AUTH_RATE_LIMITS.webPushTestMembership, context.membershipId);
    await this.rateLimits.consume(
      AUTH_RATE_LIMITS.webPushTestSubscription,
      `${context.membershipId}:${subscriptionId}`,
    );

    await this.database.client.outboxEvent.create({
      data: {
        actorMembershipId: context.membershipId,
        aggregateId: subscriptionId,
        aggregateType: 'WEB_PUSH_SUBSCRIPTION',
        eventType: WEB_PUSH_TEST_REQUESTED,
        id: eventId,
        payload: {
          schemaVersion: WEB_PUSH_TEST_REQUESTED_SCHEMA_VERSION,
          subscriptionId,
        },
        workspaceId: context.workspaceId,
      },
      select: { id: true },
    });

    return { accepted: true, eventId };
  }
}
