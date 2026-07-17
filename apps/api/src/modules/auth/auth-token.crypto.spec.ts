import { createHash } from 'node:crypto';

import {
  createCsrfToken,
  createOneTimeToken,
  createSessionToken,
  getOneTimeTokenRateLimitKey,
  hashSessionToken,
  verifyCsrfToken,
  verifyOneTimeToken,
} from './auth-token.crypto';

const hmacKey = Buffer.alloc(32, 7);

describe('auth tokens', () => {
  it('creates an opaque 32-byte session token and its SHA-256 hash', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toEqual(createHash('sha256').update(first.token).digest());
    expect(hashSessionToken(first.token)).toEqual(first.tokenHash);
  });

  it('creates a deterministic purpose-bound one-time token from UUID bytes', () => {
    const tokenId = '123e4567-e89b-42d3-a456-426614174000';
    const first = createOneTimeToken('EMAIL_VERIFICATION', hmacKey, tokenId);
    const second = createOneTimeToken('EMAIL_VERIFICATION', hmacKey, tokenId);
    const encodedId = first.token.split('.')[0] ?? '';

    expect(first).toEqual(second);
    expect(Buffer.from(encodedId, 'base64url').toString('hex')).toBe(tokenId.replaceAll('-', ''));
    expect(first.tokenHash).toEqual(createHash('sha256').update(first.token).digest());
    expect(verifyOneTimeToken(first.token, 'EMAIL_VERIFICATION', hmacKey)).toEqual({
      tokenHash: first.tokenHash,
      tokenId,
    });
  });

  it('rejects a one-time token for another purpose or with a changed MAC', () => {
    const { token } = createOneTimeToken('EMAIL_VERIFICATION', hmacKey);
    const changedToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(verifyOneTimeToken(token, 'PASSWORD_RESET', hmacKey)).toBeNull();
    expect(verifyOneTimeToken(changedToken, 'EMAIL_VERIFICATION', hmacKey)).toBeNull();
    expect(verifyOneTimeToken(`${token}=`, 'EMAIL_VERIFICATION', hmacKey)).toBeNull();
  });

  it('rejects malformed one-time token IDs and short HMAC keys', () => {
    expect(() => createOneTimeToken('EMAIL_VERIFICATION', hmacKey, 'not-a-uuid')).toThrow(
      'tokenId must be a UUID',
    );
    expect(() => createOneTimeToken('EMAIL_VERIFICATION', 'short')).toThrow(
      'HMAC key must contain at least 32 bytes',
    );
  });

  it('groups MAC variants by token ID and hashes a completely malformed rate-limit key', () => {
    const token = createOneTimeToken(
      'EMAIL_VERIFICATION',
      hmacKey,
      '123e4567-e89b-42d3-a456-426614174000',
    ).token;
    const encodedId = token.split('.')[0];
    const malformedToken = 'not-a-token';

    expect(getOneTimeTokenRateLimitKey(`${encodedId}.changed-mac`)).toBe(
      getOneTimeTokenRateLimitKey(`${encodedId}.another-mac`),
    );
    expect(getOneTimeTokenRateLimitKey(malformedToken)).toMatch(/^malformed:[A-Za-z0-9_-]{43}$/);
    expect(getOneTimeTokenRateLimitKey(malformedToken)).not.toContain(malformedToken);
  });

  it('binds a CSRF token to the session and verifies its MAC', () => {
    const { token: sessionToken } = createSessionToken();
    const { token: anotherSessionToken } = createSessionToken();
    const csrfToken = createCsrfToken(sessionToken, hmacKey);

    expect(Buffer.from(csrfToken, 'base64url')).toHaveLength(32);
    expect(verifyCsrfToken(sessionToken, csrfToken, hmacKey)).toBe(true);
    expect(verifyCsrfToken(anotherSessionToken, csrfToken, hmacKey)).toBe(false);
    expect(verifyCsrfToken(sessionToken, `${csrfToken}=`, hmacKey)).toBe(false);
  });
});
