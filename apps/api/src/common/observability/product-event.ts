import { createHash, randomUUID } from 'node:crypto';

import type { ProductEvent, ProductEventName } from '@rivet/event-contracts';
import { PRODUCT_EVENT_PAYLOAD_VERSION } from '@rivet/event-contracts';

export type ProductEventContext = { membershipId: string; workspaceId: string };

export function deterministicProductEventId(seed: string, name: ProductEventName): string {
  const bytes = createHash('sha256').update(`${name}:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function productEvent(
  context: ProductEventContext,
  name: ProductEventName,
  properties: Record<string, unknown>,
  options: { eventId?: string; occurredAt?: Date | string } = {},
): ProductEvent {
  const occurredAt = options.occurredAt ?? new Date();
  return {
    eventId: options.eventId ?? randomUUID(),
    membershipId: context.membershipId,
    name,
    occurredAt: typeof occurredAt === 'string' ? occurredAt : occurredAt.toISOString(),
    payloadVersion: PRODUCT_EVENT_PAYLOAD_VERSION,
    properties,
    workspaceId: context.workspaceId,
  };
}
