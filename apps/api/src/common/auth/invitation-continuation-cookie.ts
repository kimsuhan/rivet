import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { apiConfig } from '../../config/api.config';

function getCookiePolicy(
  config: Pick<ConfigType<typeof apiConfig>, 'environment' | 'webOrigin'>,
): { name: '__Host-rivet_invite_flow' | 'rivet_invite_flow'; secure: boolean } {
  const secure = new URL(config.webOrigin).protocol === 'https:';

  return {
    name: secure ? '__Host-rivet_invite_flow' : 'rivet_invite_flow',
    secure,
  };
}

export function readInvitationContinuationCookie(
  request: Pick<Request, 'headers'>,
  config: Pick<ConfigType<typeof apiConfig>, 'environment' | 'webOrigin'>,
): string | null {
  const cookieHeader = request.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  const cookieName = getCookiePolicy(config).name;
  for (const segment of cookieHeader.split(';')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex === -1 || segment.slice(0, separatorIndex).trim() !== cookieName) {
      continue;
    }

    const token = segment.slice(separatorIndex + 1).trim();
    return token || null;
  }

  return null;
}

export function setInvitationContinuationCookie(
  response: Response,
  config: Pick<ConfigType<typeof apiConfig>, 'environment' | 'webOrigin'>,
  token: string,
  expires: Date,
): void {
  const policy = getCookiePolicy(config);
  response.cookie(policy.name, token, {
    expires,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: policy.secure,
  });
}

export function clearInvitationContinuationCookie(
  response: Response,
  config: Pick<ConfigType<typeof apiConfig>, 'environment' | 'webOrigin'>,
): void {
  const policy = getCookiePolicy(config);
  response.clearCookie(policy.name, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: policy.secure,
  });
}
