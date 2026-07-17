import type { Request } from 'express';

import type { AuthSessionContext } from './auth-session.service';

export type AuthenticatedRequestContext = {
  session: AuthSessionContext;
  sessionToken: string;
};

export type RequestWithAuthentication = Request & {
  authentication?: AuthenticatedRequestContext;
};
