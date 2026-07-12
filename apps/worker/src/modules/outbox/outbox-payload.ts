import { PermanentOutboxError } from './outbox-errors';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateOutboxPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new PermanentOutboxError('OUTBOX_PAYLOAD_INVALID');
  }

  if (payload.schemaVersion !== 1) {
    throw new PermanentOutboxError('OUTBOX_SCHEMA_VERSION_UNSUPPORTED');
  }

  return payload;
}
