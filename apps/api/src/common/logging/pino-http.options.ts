import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ConfigType } from '@nestjs/config';
import type { Params } from 'nestjs-pino';

import type { apiConfig } from '../../config/api.config';
import type { AuthenticatedRequestContext } from '../../modules/auth/authenticated-request';

type LoggedRequest = IncomingMessage & {
  authentication?: AuthenticatedRequestContext;
  route?: { path?: unknown };
};

function createRequestId(
  _request: IncomingMessage,
  response: ServerResponse,
  config: ConfigType<typeof apiConfig>,
): string {
  const requestId = `req_${randomUUID()}`;
  response.setHeader('X-Request-ID', requestId);
  response.setHeader('X-Rivet-Environment', config.environment);
  response.setHeader('X-Rivet-Release-Id', config.releaseId);
  return requestId;
}

function requestPath(request: IncomingMessage): string {
  const loggedRequest = request as LoggedRequest;
  const routePath = loggedRequest.route?.path;

  return typeof routePath === 'string' && routePath.length > 0 ? routePath : 'UNMATCHED_ROUTE';
}

function requestIdentifiers(request: IncomingMessage): {
  membershipId?: string;
  workspaceId?: string;
} {
  const session = (request as LoggedRequest).authentication?.session;
  const membership = session?.membership;
  const workspace = session?.workspace;

  if (
    !membership ||
    !workspace ||
    membership.status !== 'ACTIVE' ||
    membership.workspaceId !== workspace.id
  ) {
    return {};
  }

  return { membershipId: membership.id, workspaceId: workspace.id };
}

function requestCompletion(
  request: IncomingMessage,
  response: ServerResponse,
  value: unknown,
): Record<string, unknown> {
  const duration =
    typeof value === 'object' &&
    value !== null &&
    'responseTime' in value &&
    typeof value.responseTime === 'number'
      ? value.responseTime
      : 0;
  const requestId =
    typeof request.id === 'string' || typeof request.id === 'number'
      ? String(request.id)
      : 'unknown_request';

  return {
    duration,
    method: request.method ?? 'UNKNOWN',
    path: requestPath(request),
    requestId,
    status: response.statusCode,
  };
}

export function createLoggerOptions(config: ConfigType<typeof apiConfig>): Params {
  return {
    pinoHttp: {
      customErrorObject: (request, response, error, value) => ({
        ...requestCompletion(request, response, value),
        errorName: error.name,
      }),
      customProps: (request) => ({
        environment: config.environment,
        releaseId: config.releaseId,
        ...requestIdentifiers(request),
      }),
      customSuccessObject: requestCompletion,
      genReqId: (request, response) => createRequestId(request, response, config),
      level: config.environment === 'production' ? 'info' : 'debug',
      quietResLogger: true,
      redact: {
        censor: '[REDACTED]',
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.endpoint',
          'req.body.keys.auth',
          'req.body.keys.p256dh',
          'res.headers.set-cookie',
        ],
      },
      serializers: {
        req(request) {
          return {
            method: request.method,
            path: requestPath(request.raw ?? request),
            requestId: request.id,
          };
        },
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
  };
}
