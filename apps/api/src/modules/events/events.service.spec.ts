import { EventEmitter } from 'node:events';

import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import {
  EventsService,
  type EventStreamConnection,
  type PostgresListenerClient,
} from './events.service';

const EVENT_ID = '4ae24db1-f652-4c11-833a-f44fef4ed56a';
const MEMBERSHIP_ID = 'c5853bcc-5294-4098-8594-519f2df1e8a9';
const OTHER_MEMBERSHIP_ID = '619dbaca-166d-4189-838e-256ae68df456';
const OTHER_WORKSPACE_ID = '3ffde6ee-5a25-4f10-b038-8ca98d213e83';
const RESOURCE_ID = '468ef342-f335-4dc6-b15d-57df4cc8f4e9';
const SESSION_ID = 'acfe0c55-17e7-4666-948c-59b9a21aa055';
const USER_ID = '7379679a-e989-48d2-9245-ed90c4ea5fce';
const WORKSPACE_ID = 'd3186916-533d-4e87-a678-b9c9ec773249';

class FakeListenerClient extends EventEmitter {
  readonly connect = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  readonly end = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  readonly query = jest.fn<Promise<unknown>, []>().mockResolvedValue({ rows: [] });
}

function signal(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    changeType: 'UPDATED',
    eventId: EVENT_ID,
    resourceId: RESOURCE_ID,
    resourceType: 'ISSUE',
    version: 2,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  });
}

describe('EventsService', () => {
  const info = jest.fn();
  const warn = jest.fn();
  const alert = jest.fn();
  const logger = {
    info,
    setContext: jest.fn(),
    warn,
  } as unknown as PinoLogger;
  let clients: FakeListenerClient[];
  let createClient: jest.Mock<PostgresListenerClient>;
  let revalidate: jest.Mock;
  let service: EventsService;

  beforeEach(() => {
    jest.useFakeTimers();
    clients = [];
    createClient = jest.fn(() => {
      const client = new FakeListenerClient();
      clients.push(client);
      return client as unknown as PostgresListenerClient;
    });
    revalidate = jest.fn().mockResolvedValue([{ isValid: true }]);
    service = new EventsService(
      { client: { $queryRaw: revalidate } } as unknown as DatabaseService,
      logger,
      { alert } as unknown as ObservabilityService,
      createClient,
    );
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
    jest.useRealTimers();
  });

  function stream(
    overrides: Partial<EventStreamConnection> = {},
  ): EventStreamConnection & { end: jest.Mock; write: jest.Mock } {
    return {
      end: jest.fn(),
      membershipId: MEMBERSHIP_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      write: jest.fn().mockReturnValue(true),
      ...overrides,
    } as EventStreamConnection & { end: jest.Mock; write: jest.Mock };
  }

  async function start(): Promise<FakeListenerClient> {
    await service.onApplicationBootstrap();
    const client = clients[0];

    if (!client) throw new Error('listener client was not created');
    return client;
  }

  it('subscribes with a dedicated client and reports readiness only after LISTEN', async () => {
    expect(service.isReady()).toBe(false);

    const client = await start();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('LISTEN rivet_resource_changed_v1');
    expect(service.isReady()).toBe(true);
  });

  it('routes only to the same workspace and optional recipient and strips routing data', async () => {
    const client = await start();
    const recipient = stream();
    const otherRecipient = stream({ membershipId: OTHER_MEMBERSHIP_ID });
    const otherWorkspace = stream({ workspaceId: OTHER_WORKSPACE_ID });
    service.openStream(recipient);
    service.openStream(otherRecipient);
    service.openStream(otherWorkspace);
    recipient.write.mockClear();
    otherRecipient.write.mockClear();
    otherWorkspace.write.mockClear();

    client.emit('notification', {
      channel: 'rivet_resource_changed_v1',
      payload: signal({ recipientMembershipId: MEMBERSHIP_ID }),
    });

    expect(recipient.write).toHaveBeenCalledWith(
      'event: resource.changed\n' +
        `id: ${EVENT_ID}\n` +
        `data: {"resourceType":"ISSUE","resourceId":"${RESOURCE_ID}","changeType":"UPDATED","version":2}\n\n`,
    );
    expect(otherRecipient.write).not.toHaveBeenCalled();
    expect(otherWorkspace.write).not.toHaveBeenCalled();
    expect(recipient.write.mock.calls[0]?.[0]).not.toContain('workspaceId');
    expect(recipient.write.mock.calls[0]?.[0]).not.toContain('recipientMembershipId');

    recipient.write.mockClear();
    otherRecipient.write.mockClear();
    client.emit('notification', {
      channel: 'rivet_resource_changed_v1',
      payload: signal(),
    });
    expect(recipient.write).toHaveBeenCalledTimes(1);
    expect(otherRecipient.write).toHaveBeenCalledTimes(1);
    expect(otherWorkspace.write).not.toHaveBeenCalled();
  });

  it('quietly ignores invalid payloads without logging the payload', async () => {
    const client = await start();
    const connection = stream();
    service.openStream(connection);
    connection.write.mockClear();

    client.emit('notification', {
      channel: 'rivet_resource_changed_v1',
      payload: JSON.stringify({ ...JSON.parse(signal()), body: 'secret' }),
    });

    expect(connection.write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      {
        connectionState: 'connected',
        count: 1,
        errorCode: 'POSTGRES_LISTENER_SIGNAL_INVALID',
      },
      '잘못된 PostgreSQL listener 신호 무시',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('sends heartbeat and closes a slow response instead of buffering', async () => {
    const client = await start();
    const connection = stream();
    connection.write.mockReturnValueOnce(true).mockReturnValueOnce(false);
    service.openStream(connection);

    await jest.advanceTimersByTimeAsync(20_000);
    client.emit('notification', {
      channel: 'rivet_resource_changed_v1',
      payload: signal(),
    });

    expect(connection.write).toHaveBeenNthCalledWith(1, 'retry: 3000\n\n');
    expect(connection.write).toHaveBeenNthCalledWith(2, ': heartbeat\n\n');
    expect(connection.write).toHaveBeenCalledTimes(2);
    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('reports a failed registration when the initial retry write cannot be sent', async () => {
    await start();
    const connection = stream();
    connection.write.mockReturnValue(false);

    expect(service.openStream(connection)).toEqual({ opened: false });
    expect(connection.end).toHaveBeenCalledTimes(1);
  });

  it('revalidates without touching session activity and closes an invalid session', async () => {
    revalidate.mockResolvedValue([{ isValid: false }]);
    await start();
    const connection = stream();
    service.openStream(connection);

    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(revalidate).toHaveBeenCalledTimes(1);
    const [template, ...values] = revalidate.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(template.join('?')).not.toMatch(/UPDATE|last_seen_at|idle_expires_at\s*=/);
    expect(values).toEqual([SESSION_ID, USER_ID, MEMBERSHIP_ID, WORKSPACE_ID, WORKSPACE_ID]);
    expect(connection.end).toHaveBeenCalledTimes(1);
  });

  it('closes a stream when session revalidation cannot query PostgreSQL', async () => {
    revalidate.mockRejectedValue(new Error('database unavailable'));
    await start();
    const connection = stream();
    service.openStream(connection);

    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {
        connectionState: 'stream_closed',
        count: 1,
        errorCode: 'SSE_SESSION_REVALIDATION_FAILED',
      },
      'SSE 세션 재검증 실패',
    );
  });

  it('closes existing streams, rejects new streams, and reconnects after listener loss', async () => {
    const firstClient = await start();
    const connection = stream();
    service.openStream(connection);

    firstClient.emit('error', new Error('connection lost'));

    expect(service.isReady()).toBe(false);
    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(service.openStream(stream())).toBeNull();

    await jest.advanceTimersByTimeAsync(1_000);

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(service.isReady()).toBe(true);
  });

  it('alerts only after the PostgreSQL listener stays disconnected for 30 seconds', async () => {
    const firstClient = await start();
    createClient.mockImplementation(() => {
      const client = new FakeListenerClient();
      client.connect.mockRejectedValue(new Error('still disconnected'));
      clients.push(client);
      return client as unknown as PostgresListenerClient;
    });

    firstClient.emit('error', new Error('connection lost'));
    await jest.advanceTimersByTimeAsync(29_999);
    expect(alert).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(alert).toHaveBeenCalledWith({
      errorCode: 'POSTGRES_LISTENER_DISCONNECTED',
      type: 'POSTGRES_LISTENER_DISCONNECTED',
    });
  });

  it('uses exponential reconnect delays and cancels them on shutdown', async () => {
    const first = new FakeListenerClient();
    const second = new FakeListenerClient();
    first.connect.mockRejectedValue(new Error('first failure'));
    second.connect.mockRejectedValue(new Error('second failure'));
    createClient
      .mockReturnValueOnce(first as unknown as PostgresListenerClient)
      .mockReturnValueOnce(second as unknown as PostgresListenerClient);

    await service.onApplicationBootstrap();
    expect(createClient).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(999);
    expect(createClient).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(createClient).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(createClient).toHaveBeenCalledTimes(2);

    await service.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
