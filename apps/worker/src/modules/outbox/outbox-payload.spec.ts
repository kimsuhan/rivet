import { PermanentOutboxError } from './outbox-errors';
import { validateOutboxPayload } from './outbox-payload';

describe('validateOutboxPayload', () => {
  it('accepts the supported schema version', () => {
    expect(validateOutboxPayload({ schemaVersion: 1, tokenId: 'token-id' })).toEqual({
      schemaVersion: 1,
      tokenId: 'token-id',
    });
  });

  it('permanently rejects unsupported schema versions', () => {
    expect(() => validateOutboxPayload({ schemaVersion: 2 })).toThrow(
      new PermanentOutboxError('OUTBOX_SCHEMA_VERSION_UNSUPPORTED'),
    );
  });
});
