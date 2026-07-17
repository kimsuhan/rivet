import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';

import { ApiError } from '../../common/errors/api-error';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { EventsController } from './events.controller';
import type { EventsService, EventStreamConnection } from './events.service';

type MockResponse = Response & {
  end: jest.Mock;
  flushHeaders: jest.Mock;
  setHeader: jest.Mock;
  status: jest.Mock;
  write: jest.Mock;
};

const authentication: AuthenticatedRequestContext = {
  session: {
    membership: {
      id: 'c5853bcc-5294-4098-8594-519f2df1e8a9',
      role: 'MEMBER',
      status: 'ACTIVE',
      workspaceId: 'd3186916-533d-4e87-a678-b9c9ec773249',
    },
    sessionId: 'acfe0c55-17e7-4666-948c-59b9a21aa055',
    user: {
      avatarFileId: null,
      displayName: 'SSE 사용자',
      email: 'sse@example.test',
      emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'),
      id: '7379679a-e989-48d2-9245-ed90c4ea5fce',
    },
    workspace: {
      id: 'd3186916-533d-4e87-a678-b9c9ec773249',
      name: 'SSE 워크스페이스',
      slug: 'sse-workspace',
      version: 1,
    },
  },
  sessionToken: 'session-token',
};

describe('EventsController', () => {
  const unsubscribe = jest.fn();
  const openStream = jest.fn().mockReturnValue({ opened: true, unsubscribe });
  const events = { openStream } as unknown as EventsService;
  let controller: EventsController;

  beforeEach(() => {
    jest.clearAllMocks();
    openStream.mockReturnValue({ opened: true, unsubscribe });
    controller = new EventsController(events, { webOrigin: 'http://localhost:3000' });
  });

  function request(origin?: string): Request & EventEmitter {
    return Object.assign(new EventEmitter(), {
      get: jest.fn((name: string) => (name.toLowerCase() === 'origin' ? origin : undefined)),
    }) as unknown as Request & EventEmitter;
  }

  function response(): MockResponse {
    const value = Object.assign(new EventEmitter(), {
      end: jest.fn(),
      flushHeaders: jest.fn(),
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn(),
      writableEnded: false,
      write: jest.fn().mockReturnValue(true),
    });
    value.status.mockReturnValue(value);
    return value as unknown as MockResponse;
  }

  it('allows an Origin-less same-origin EventSource and opens the exact SSE headers lazily', () => {
    const httpRequest = request();
    const httpResponse = response();

    controller.connect(authentication, httpRequest, httpResponse);

    const connection = openStream.mock.calls[0]?.[0] as EventStreamConnection;
    expect(connection).toMatchObject({
      membershipId: authentication.session.membership?.id,
      sessionId: authentication.session.sessionId,
      userId: authentication.session.user.id,
      workspaceId: authentication.session.workspace?.id,
    });
    expect(connection.write('retry: 3000\n\n')).toBe(true);
    expect(httpResponse.status).toHaveBeenCalledWith(200);
    expect(httpResponse.setHeader.mock.calls).toEqual([
      ['Content-Type', 'text/event-stream; charset=utf-8'],
      ['Cache-Control', 'no-cache, no-transform'],
      ['Connection', 'keep-alive'],
      ['X-Accel-Buffering', 'no'],
    ]);
    expect(httpResponse.flushHeaders).toHaveBeenCalledTimes(1);
    expect(httpResponse.write).toHaveBeenCalledWith('retry: 3000\n\n');

    httpResponse.emit('close');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('accepts only the exact configured Origin when the header is present', () => {
    expect(() =>
      controller.connect(authentication, request('https://attacker.example'), response()),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CSRF_INVALID' }),
        status: 403,
      }),
    );
    expect(openStream).not.toHaveBeenCalled();

    expect(() =>
      controller.connect(authentication, request('http://localhost:3000'), response()),
    ).not.toThrow();
  });

  it('returns 503 before opening headers while the listener is unavailable', () => {
    openStream.mockReturnValueOnce(null);
    const httpResponse = response();

    let thrown: unknown;

    try {
      controller.connect(authentication, request(), httpResponse);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      response: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
      status: 503,
    });
    expect(httpResponse.setHeader).not.toHaveBeenCalled();
    expect(httpResponse.flushHeaders).not.toHaveBeenCalled();
    expect(httpResponse.write).not.toHaveBeenCalled();
  });

  it('rejects a session without a matching active workspace context', () => {
    const withoutWorkspace: AuthenticatedRequestContext = {
      ...authentication,
      session: { ...authentication.session, membership: null, workspace: null },
    };

    expect(() => controller.connect(withoutWorkspace, request(), response())).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 403,
      }),
    );
    expect(openStream).not.toHaveBeenCalled();
  });
});
