import { createHmac } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OneTimeTokenLinkInput = {
  hmacKey: string;
  tokenId: string;
  webOrigin: string;
};

function createOneTimeToken(
  tokenId: string,
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'WORKSPACE_INVITATION',
  hmacKey: string,
): string {
  if (!UUID_PATTERN.test(tokenId)) {
    throw new TypeError('tokenId는 UUID여야 합니다.');
  }

  const normalizedTokenId = tokenId.toLowerCase();
  const encodedTokenId = Buffer.from(normalizedTokenId.replaceAll('-', ''), 'hex').toString(
    'base64url',
  );
  const mac = createHmac('sha256', hmacKey)
    .update(`${purpose}:${normalizedTokenId}`)
    .digest('base64url');

  return `${encodedTokenId}.${mac}`;
}

function createTokenLink(
  input: OneTimeTokenLinkInput,
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'WORKSPACE_INVITATION',
  path: '/verify-email' | '/reset-password' | '/invite',
): string {
  const url = new URL(path, input.webOrigin);
  url.hash = `token=${createOneTimeToken(input.tokenId, purpose, input.hmacKey)}`;
  return url.toString();
}

export function createEmailVerificationLink(input: OneTimeTokenLinkInput): string {
  return createTokenLink(input, 'EMAIL_VERIFICATION', '/verify-email');
}

export function createPasswordResetLink(input: OneTimeTokenLinkInput): string {
  return createTokenLink(input, 'PASSWORD_RESET', '/reset-password');
}

export function createWorkspaceInvitationLink(input: OneTimeTokenLinkInput): string {
  return createTokenLink(input, 'WORKSPACE_INVITATION', '/invite');
}
