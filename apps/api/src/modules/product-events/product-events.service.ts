import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { validateProductEvent } from '@rivet/event-contracts';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { ObservabilityService } from '../../common/observability/observability.service';
import {
  deterministicProductEventId,
  productEvent,
} from '../../common/observability/product-event';
import { AUTH_RATE_LIMITS, AuthRateLimitService } from '../auth/auth-rate-limit.service';
import type {
  CaptureProductEventDto,
  CaptureProductEventResponseDto,
} from './dto/capture-product-event.dto';

@Injectable()
export class ProductEventsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly observability: ObservabilityService,
    private readonly rateLimits: AuthRateLimitService,
  ) {}

  async capture(
    context: { membershipId: string; workspaceId: string },
    dto: CaptureProductEventDto,
  ): Promise<CaptureProductEventResponseDto> {
    await this.rateLimits.consume(AUTH_RATE_LIMITS.productEventMembership, context.membershipId);
    const candidate = productEvent(context, dto.name, dto.properties);
    const validation = validateProductEvent(candidate);
    if (!validation.success) {
      throw new ApiError({
        code: 'PRODUCT_EVENT_INVALID',
        message: '허용되지 않은 제품 이벤트 또는 필드입니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
    await this.assertResourceOwnership(context, dto.name, validation.event.properties);
    const event = await this.clientEvent(context, validation.event);
    if (!event) return { status: 'ACCEPTED' };
    this.observability.capture(event);
    return { status: 'ACCEPTED' };
  }

  private async clientEvent(
    context: { membershipId: string; workspaceId: string },
    event: ReturnType<typeof productEvent>,
  ): Promise<ReturnType<typeof productEvent> | null> {
    if (event.name === 'push_permission_result') {
      const transition = await this.recordPushPermissionTransition(
        context,
        event.properties.result as string,
      );
      if (!transition) return null;
      return productEvent(context, event.name, event.properties, {
        eventId: deterministicProductEventId(
          `${context.workspaceId}:${context.membershipId}:push-permission:${transition.version}:${event.properties.result}`,
          event.name,
        ),
        occurredAt: transition.occurredAt,
      });
    }

    const semanticKey = this.semanticKey(event);
    return productEvent(context, event.name, event.properties, {
      eventId: deterministicProductEventId(
        `${context.workspaceId}:${context.membershipId}:${semanticKey}`,
        event.name,
      ),
      occurredAt: event.occurredAt,
    });
  }

  private semanticKey(event: ReturnType<typeof productEvent>): string {
    if (event.name === 'push_notification_clicked') {
      return `notification:${event.properties.notificationId}`;
    }
    const utcDay = event.occurredAt.slice(0, 10);
    if (event.name === 'saved_view_opened') {
      return `saved-view:${event.properties.savedViewId}:${utcDay}`;
    }
    if (event.name === 'issue_template_applied') {
      return `template:${event.properties.templateId}:${utcDay}`;
    }
    if (event.name === 'search_result_selected') {
      return `search:${event.properties.resultType}:${event.properties.resourceId}:${utcDay}`;
    }
    return `${event.eventId}:${utcDay}`;
  }

  private async recordPushPermissionTransition(
    context: { membershipId: string; workspaceId: string },
    result: string,
  ): Promise<{ occurredAt: Date; version: number } | null> {
    const rows = await this.database.client.$queryRaw<Array<{ occurredAt: Date; version: number }>>`
      INSERT INTO "product_event_states" (
        "id",
        "workspace_id",
        "membership_id",
        "semantic_key",
        "state_value",
        "version",
        "created_at",
        "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid,
        ${context.workspaceId}::uuid,
        ${context.membershipId}::uuid,
        'push-permission',
        ${result},
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT ("workspace_id", "membership_id", "semantic_key")
      DO UPDATE SET
        "state_value" = EXCLUDED."state_value",
        "version" = "product_event_states"."version" + 1,
        "updated_at" = NOW()
      WHERE "product_event_states"."state_value" <> EXCLUDED."state_value"
      RETURNING "version", "updated_at" AS "occurredAt"
    `;
    return rows[0] ?? null;
  }

  private async assertResourceOwnership(
    context: { membershipId: string; workspaceId: string },
    name: CaptureProductEventDto['name'],
    properties: Record<string, unknown>,
  ): Promise<void> {
    let exists = true;
    if (name === 'saved_view_opened') {
      exists = Boolean(
        await this.database.client.savedView.findFirst({
          select: { id: true },
          where: {
            id: properties.savedViewId as string,
            membershipId: context.membershipId,
            resourceType: properties.resourceType as 'ISSUES' | 'MY_WORK',
            workspaceId: context.workspaceId,
          },
        }),
      );
    } else if (name === 'issue_template_applied') {
      exists = Boolean(
        await this.database.client.issueTemplate.findFirst({
          select: { id: true },
          where: {
            archivedAt: null,
            id: properties.templateId as string,
            workspaceId: context.workspaceId,
          },
        }),
      );
    } else if (name === 'push_notification_clicked') {
      exists = Boolean(
        await this.database.client.notification.findFirst({
          select: { id: true },
          where: {
            id: properties.notificationId as string,
            recipientMembershipId: context.membershipId,
            workspaceId: context.workspaceId,
          },
        }),
      );
    } else if (name === 'search_result_selected') {
      const where = {
        deletedAt: null,
        id: properties.resourceId as string,
        workspaceId: context.workspaceId,
      };
      exists = Boolean(
        properties.resultType === 'ISSUE'
          ? await this.database.client.issue.findFirst({ select: { id: true }, where })
          : await this.database.client.teamWork.findFirst({ select: { id: true }, where }),
      );
    }
    if (!exists) {
      throw new ApiError({
        code: 'PRODUCT_EVENT_RESOURCE_INVALID',
        message: '현재 워크스페이스에서 관찰 가능한 리소스가 아닙니다.',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    }
  }
}
