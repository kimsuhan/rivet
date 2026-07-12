import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export type OneTimeTokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'WORKSPACE_INVITATION';

function assertHmacKey(key: string | Buffer): void {
  if (Buffer.byteLength(key) < 32) {
    throw new RangeError('HMAC key must contain at least 32 bytes');
  }
}

function createTokenHmac(key: string | Buffer, value: string): Buffer {
  assertHmacKey(key);
  return createHmac('sha256', key).update(value).digest();
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function uuidToBytes(tokenId: string): Buffer {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(tokenId)) {
    throw new TypeError('tokenId must be a UUID');
  }

  return Buffer.from(tokenId.replaceAll('-', ''), 'hex');
}

function uuidFromBytes(bytes: Buffer): string {
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20,
  )}-${value.slice(20)}`;
}

function decodeBase64Url(value: string, expectedByteLength: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === expectedByteLength && decoded.toString('base64url') === value
    ? decoded
    : null;
}

export function createSessionToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashSessionToken(token: string): Buffer {
  return hashToken(token);
}

export function createOneTimeToken(
  purpose: OneTimeTokenPurpose,
  key: string | Buffer,
  tokenId: string = randomUUID(),
): { token: string; tokenHash: Buffer; tokenId: string } {
  const normalizedTokenId = tokenId.toLowerCase();
  const id = uuidToBytes(normalizedTokenId).toString('base64url');
  const mac = createTokenHmac(key, `${purpose}:${normalizedTokenId}`).toString('base64url');
  const token = `${id}.${mac}`;

  return { token, tokenHash: hashToken(token), tokenId: normalizedTokenId };
}

export function verifyOneTimeToken(
  token: string,
  purpose: OneTimeTokenPurpose,
  key: string | Buffer,
): { tokenHash: Buffer; tokenId: string } | null {
  const [encodedId, encodedMac, extra] = token.split('.');
  if (!encodedId || !encodedMac || extra !== undefined) {
    return null;
  }

  const id = decodeBase64Url(encodedId, 16);
  const mac = decodeBase64Url(encodedMac, 32);
  if (!id || !mac) {
    return null;
  }

  const tokenId = uuidFromBytes(id);
  const expectedMac = createTokenHmac(key, `${purpose}:${tokenId}`);
  if (!timingSafeEqual(mac, expectedMac)) {
    return null;
  }

  return { tokenHash: hashToken(token), tokenId };
}

export function getOneTimeTokenRateLimitKey(token: string): string {
  const encodedId = token.split('.', 1)[0];
  const id = encodedId ? decodeBase64Url(encodedId, 16) : null;

  return id ? `id:${uuidFromBytes(id)}` : `malformed:${hashToken(token).toString('base64url')}`;
}

export function createCsrfToken(sessionToken: string, key: string | Buffer): string {
  return createTokenHmac(key, sessionToken).toString('base64url');
}

export function verifyCsrfToken(
  sessionToken: string,
  csrfToken: string,
  key: string | Buffer,
): boolean {
  const providedToken = decodeBase64Url(csrfToken, 32);
  if (!providedToken) {
    return false;
  }

  return timingSafeEqual(providedToken, createTokenHmac(key, sessionToken));
}
