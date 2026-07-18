import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as webPush from 'web-push';

import { WebPushDeliveryStatus, WebPushSubscriptionStatus } from '@rivet/database';
import {
  PRODUCT_EVENT_PAYLOAD_VERSION,
  type ProductEventName,
  type WebPushTestRequestedOutboxPayload,
} from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { workerConfig } from '../../config/worker.config';
import type { ClaimedOutboxEvent } from '../outbox/outbox.types';
import { PermanentOutboxError, RetryableOutboxError } from '../outbox/outbox-errors';

type DeliveryRow = Awaited<ReturnType<WebPushDeliveryService['pendingDeliveries']>>[number];
type DeliveryResult = { code: string; kind: 'permanent' | 'retry' } | null;

const DELIVERY_LEASE_MS = 5 * 60_000;
const RETRYABLE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function targetPath(notification: NonNullable<DeliveryRow['notification']>): string {
  let path = `/issues/${encodeURIComponent(notification.issue.identifier)}?tab=work`;
  if (notification.teamWork) {
    path += `&work=${encodeURIComponent(notification.teamWork.identifier)}`;
  }
  if (notification.commentId) {
    return `${path}#comment-${notification.commentId}`;
  }
  if (notification.handoffId) {
    return `${path}&handoff=${encodeURIComponent(notification.handoffId)}#handoff-${notification.handoffId}`;
  }
  return path;
}

function statusCode(error: unknown): number | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode;
  }
  return null;
}

function networkErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    RETRYABLE_NETWORK_CODES.has(error.code)
  ) {
    return error.code;
  }
  return null;
}

function isRetryableStatus(code: number): boolean {
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

function productEventId(sourceId: string, name: ProductEventName): string {
  const bytes = createHash('sha256').update(`${name}:${sourceId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isSessionActive(
  session: {
    absoluteExpiresAt: Date;
    idleExpiresAt: Date;
    revokedAt: Date | null;
  } | null,
  now: Date,
): boolean {
  return Boolean(
    session &&
    session.revokedAt === null &&
    session.idleExpiresAt.getTime() > now.getTime() &&
    session.absoluteExpiresAt.getTime() > now.getTime(),
  );
}

@Injectable()
export class WebPushDeliveryService {
  private configurationWarningLogged = false;

  constructor(
    private readonly database: DatabaseService,
    @Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>,
    private readonly logger: PinoLogger,
    private readonly observability: ObservabilityService,
  ) {
    this.logger.setContext(WebPushDeliveryService.name);
  }

  async deliverNotifications(event: ClaimedOutboxEvent): Promise<void> {
    if (event.workspaceId === null || !this.isConfigured()) return;

    await this.expireElapsedSubscriptions(event.workspaceId);
    const now = new Date();
    const notifications = await this.database.client.notification.findMany({
      select: {
        id: true,
        recipientMembership: {
          select: {
            webPushSubscriptions: {
              select: { id: true },
              where: {
                session: {
                  absoluteExpiresAt: { gt: now },
                  idleExpiresAt: { gt: now },
                  revokedAt: null,
                },
                status: WebPushSubscriptionStatus.ACTIVE,
              },
            },
          },
        },
      },
      where: { eventId: event.id, workspaceId: event.workspaceId },
    });
    const deliveries = notifications.flatMap((notification) =>
      notification.recipientMembership.webPushSubscriptions.map(({ id: subscriptionId }) => ({
        notificationId: notification.id,
        subscriptionId,
      })),
    );
    if (deliveries.length === 0) return;

    await this.database.client.webPushDelivery.createMany({
      data: deliveries,
      skipDuplicates: true,
    });
    await this.sendPending({ notification: { eventId: event.id } });
  }

  async deliverTest(
    event: ClaimedOutboxEvent,
    payload: WebPushTestRequestedOutboxPayload,
  ): Promise<void> {
    if (event.workspaceId === null || event.actorMembershipId === null || !this.isConfigured()) {
      return;
    }

    await this.expireElapsedSubscriptions(event.workspaceId);
    const now = new Date();
    const subscription = await this.database.client.webPushSubscription.findFirst({
      select: { id: true },
      where: {
        id: payload.subscriptionId,
        membershipId: event.actorMembershipId,
        session: {
          absoluteExpiresAt: { gt: now },
          idleExpiresAt: { gt: now },
          revokedAt: null,
        },
        status: WebPushSubscriptionStatus.ACTIVE,
        workspaceId: event.workspaceId,
      },
    });
    if (!subscription) return;

    await this.database.client.webPushDelivery.createMany({
      data: [{ outboxEventId: event.id, subscriptionId: subscription.id }],
      skipDuplicates: true,
    });
    await this.sendPending({ outboxEventId: event.id });
  }

  private isConfigured(): boolean {
    const configured = Boolean(
      this.config.webPush.publicKey &&
      this.config.webPush.privateKey &&
      this.config.webPush.subject,
    );
    if (!configured && !this.configurationWarningLogged) {
      this.configurationWarningLogged = true;
      this.logger.warn(
        { errorCode: 'WEB_PUSH_NOT_CONFIGURED', result: 'skipped' },
        'Web Push 전달 설정 누락',
      );
    }
    return configured;
  }

  private async expireElapsedSubscriptions(workspaceId: string): Promise<void> {
    await this.database.client.webPushSubscription.updateMany({
      data: {
        auth: null,
        disabledAt: new Date(),
        endpoint: null,
        lastErrorCode: 'WEB_PUSH_SUBSCRIPTION_EXPIRED',
        lastFailedAt: new Date(),
        p256dh: null,
        status: WebPushSubscriptionStatus.EXPIRED,
      },
      where: {
        expirationTime: { lte: new Date() },
        status: WebPushSubscriptionStatus.ACTIVE,
        workspaceId,
      },
    });
  }

  private pendingDeliveries(where: { notification?: { eventId: string }; outboxEventId?: string }) {
    return this.database.client.webPushDelivery.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        notification: {
          select: {
            commentId: true,
            handoffId: true,
            id: true,
            issue: { select: { identifier: true } },
            teamWork: { select: { identifier: true } },
            type: true,
          },
        },
        outboxEventId: true,
        subscription: {
          select: {
            auth: true,
            endpoint: true,
            id: true,
            membershipId: true,
            p256dh: true,
            session: {
              select: {
                absoluteExpiresAt: true,
                idleExpiresAt: true,
                revokedAt: true,
              },
            },
            status: true,
            workspaceId: true,
          },
        },
      },
      where: { ...where, status: WebPushDeliveryStatus.PENDING },
    });
  }

  private async sendPending(where: {
    notification?: { eventId: string };
    outboxEventId?: string;
  }): Promise<void> {
    await this.database.client.webPushDelivery.updateMany({
      data: {
        lastErrorCode: 'WEB_PUSH_DELIVERY_STALE_RECLAIMED',
        status: WebPushDeliveryStatus.PENDING,
      },
      where: {
        ...where,
        status: WebPushDeliveryStatus.SENDING,
        updatedAt: { lte: new Date(Date.now() - DELIVERY_LEASE_MS) },
      },
    });
    const deliveries = await this.pendingDeliveries(where);
    let retryCode: string | null = null;
    let permanentCode: string | null = null;

    for (const delivery of deliveries) {
      try {
        const result = await this.sendDelivery(delivery);
        if (result?.kind === 'retry') retryCode ??= result.code;
        if (result?.kind === 'permanent') permanentCode ??= result.code;
      } catch (error) {
        if (error instanceof PermanentOutboxError) {
          permanentCode ??= error.code;
          continue;
        }
        throw error;
      }
    }

    if (retryCode) throw new RetryableOutboxError(retryCode);

    const sendingCount = await this.database.client.webPushDelivery.count({
      where: { ...where, status: WebPushDeliveryStatus.SENDING },
    });
    if (sendingCount > 0) {
      throw new RetryableOutboxError('WEB_PUSH_DELIVERY_IN_PROGRESS');
    }
    if (permanentCode) throw new PermanentOutboxError(permanentCode);
  }

  private async sendDelivery(delivery: DeliveryRow): Promise<DeliveryResult> {
    const claimed = await this.database.client.webPushDelivery.updateMany({
      data: { attemptCount: { increment: 1 }, status: WebPushDeliveryStatus.SENDING },
      where: { id: delivery.id, status: WebPushDeliveryStatus.PENDING },
    });
    if (claimed.count === 0) return null;

    const { auth, endpoint, p256dh } = delivery.subscription;
    if (
      delivery.subscription.status !== WebPushSubscriptionStatus.ACTIVE ||
      !endpoint ||
      !p256dh ||
      !auth
    ) {
      await this.failPermanently(
        delivery.id,
        delivery.subscription.id,
        'WEB_PUSH_SUBSCRIPTION_INVALID',
        WebPushSubscriptionStatus.EXPIRED,
      );
      this.captureDelivery(delivery, 'push_delivery_failed', {
        errorCode: 'WEB_PUSH_SUBSCRIPTION_INVALID',
        notificationId: delivery.notification?.id,
      });
      return null;
    }
    if (!isSessionActive(delivery.subscription.session, new Date())) {
      await this.failPermanently(
        delivery.id,
        delivery.subscription.id,
        'WEB_PUSH_SESSION_INACTIVE',
        WebPushSubscriptionStatus.EXPIRED,
      );
      this.captureDelivery(delivery, 'push_delivery_failed', {
        errorCode: 'WEB_PUSH_SESSION_INACTIVE',
        notificationId: delivery.notification?.id,
      });
      return null;
    }

    const payload = delivery.notification
      ? {
          notificationId: delivery.notification.id,
          targetPath: targetPath(delivery.notification),
          type: delivery.notification.type,
          version: 1,
        }
      : {
          targetPath: '/inbox',
          testEventId: delivery.outboxEventId,
          type: 'WEB_PUSH_TEST',
          version: 1,
        };
    const sourceId = delivery.notification?.id ?? delivery.outboxEventId ?? delivery.id;

    try {
      await webPush.sendNotification(
        { endpoint, keys: { auth, p256dh } },
        JSON.stringify(payload),
        {
          TTL: 60 * 60,
          topic: createHash('sha256').update(sourceId).digest('base64url').slice(0, 32),
          urgency: 'high',
          vapidDetails: {
            privateKey: this.config.webPush.privateKey!,
            publicKey: this.config.webPush.publicKey!,
            subject: this.config.webPush.subject!,
          },
        },
      );
    } catch (error) {
      const providerStatus = statusCode(error);
      const networkCode = networkErrorCode(error);
      if (providerStatus === null && networkCode === null) {
        const code = 'WEB_PUSH_PROVIDER_INTERNAL_ERROR';
        await this.failDeliveryOnly(delivery.id, code);
        this.captureDelivery(delivery, 'push_delivery_failed', {
          errorCode: code,
          notificationId: delivery.notification?.id,
        });
        return { code, kind: 'permanent' };
      }

      const code =
        providerStatus === null
          ? `WEB_PUSH_NETWORK_${networkCode}`
          : `WEB_PUSH_PROVIDER_${providerStatus}`;
      if (providerStatus === null || isRetryableStatus(providerStatus)) {
        await this.database.client.$transaction([
          this.database.client.webPushDelivery.update({
            data: { lastErrorCode: code, status: WebPushDeliveryStatus.PENDING },
            where: { id: delivery.id },
          }),
          this.database.client.webPushSubscription.update({
            data: { lastErrorCode: code, lastFailedAt: new Date() },
            where: { id: delivery.subscription.id },
          }),
        ]);
        return { code, kind: 'retry' };
      }

      await this.failPermanently(
        delivery.id,
        delivery.subscription.id,
        code,
        providerStatus === 404 || providerStatus === 410
          ? WebPushSubscriptionStatus.EXPIRED
          : WebPushSubscriptionStatus.INACTIVE,
      );
      this.captureDelivery(delivery, 'push_delivery_failed', {
        errorCode: code,
        notificationId: delivery.notification?.id,
      });
      return null;
    }

    try {
      await this.recordSuccess(delivery.id, delivery.subscription.id);
    } catch (error) {
      if (error instanceof PermanentOutboxError) {
        this.captureDelivery(delivery, 'push_delivery_failed', {
          errorCode: error.code,
          notificationId: delivery.notification?.id,
        });
      }
      throw error;
    }
    this.captureDelivery(delivery, 'push_delivery_succeeded', {
      notificationId: delivery.notification?.id,
    });
    return null;
  }

  private captureDelivery(
    delivery: DeliveryRow,
    name: 'push_delivery_succeeded' | 'push_delivery_failed',
    properties: { errorCode?: string; notificationId: string | undefined },
  ): void {
    if (!delivery.notification || !properties.notificationId) return;
    this.observability.capture({
      eventId: productEventId(delivery.id, name),
      membershipId: delivery.subscription.membershipId,
      name,
      occurredAt: new Date().toISOString(),
      payloadVersion: PRODUCT_EVENT_PAYLOAD_VERSION,
      properties:
        name === 'push_delivery_failed'
          ? { errorCode: properties.errorCode, notificationId: properties.notificationId }
          : { notificationId: properties.notificationId },
      workspaceId: delivery.subscription.workspaceId,
    });
  }

  private async recordSuccess(deliveryId: string, subscriptionId: string): Promise<void> {
    const sentAt = new Date();
    try {
      await this.database.client.webPushDelivery.update({
        data: {
          failedAt: null,
          lastErrorCode: null,
          sentAt,
          status: WebPushDeliveryStatus.SENT,
        },
        where: { id: deliveryId },
      });
    } catch {
      const errorCode = 'WEB_PUSH_SENT_STATE_RECORD_FAILED';
      await this.database.client.webPushDelivery.updateMany({
        data: { failedAt: sentAt, lastErrorCode: errorCode, status: WebPushDeliveryStatus.FAILED },
        where: { id: deliveryId, status: WebPushDeliveryStatus.SENDING },
      });
      this.logger.error(
        { deliveryId, errorCode, result: 'failed' },
        'Web Push 성공 상태 기록 실패',
      );
      throw new PermanentOutboxError(errorCode);
    }

    try {
      await this.database.client.webPushSubscription.update({
        data: {
          lastErrorCode: null,
          lastFailedAt: null,
          lastSucceededAt: sentAt,
        },
        where: { id: subscriptionId },
      });
    } catch {
      this.logger.warn(
        {
          deliveryId,
          errorCode: 'WEB_PUSH_SUBSCRIPTION_SUCCESS_METADATA_FAILED',
          result: 'sent',
        },
        'Web Push 구독 성공 메타데이터 기록 실패',
      );
    }
  }

  private async failDeliveryOnly(deliveryId: string, code: string): Promise<void> {
    await this.database.client.webPushDelivery.update({
      data: { failedAt: new Date(), lastErrorCode: code, status: WebPushDeliveryStatus.FAILED },
      where: { id: deliveryId },
    });
  }

  private async failPermanently(
    deliveryId: string,
    subscriptionId: string,
    code: string,
    status: WebPushSubscriptionStatus,
  ): Promise<void> {
    const failedAt = new Date();
    await this.database.client.$transaction([
      this.database.client.webPushDelivery.update({
        data: {
          failedAt,
          lastErrorCode: code,
          status: WebPushDeliveryStatus.FAILED,
        },
        where: { id: deliveryId },
      }),
      this.database.client.webPushSubscription.update({
        data: {
          auth: null,
          disabledAt: failedAt,
          endpoint: null,
          lastErrorCode: code,
          lastFailedAt: failedAt,
          p256dh: null,
          status,
        },
        where: { id: subscriptionId },
      }),
    ]);
  }
}
