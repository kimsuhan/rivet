import { PinoLogger } from 'nestjs-pino';
import { Client } from 'pg';

import { DatabaseService } from '../src/common/database/database.service';
import { ObservabilityService } from '../src/common/observability/observability.service';
import { EventsService, type PostgresListenerClient } from '../src/modules/events/events.service';

const CHANNEL = 'rivet_resource_changed_v1';
const COMMITTED_EVENT_ID = '55cf3811-daf3-4444-b143-e22010726264';
const MARKER_EVENT_ID = 'f7bf54ed-511e-4a9e-8d9e-a9f7de817302';
const ROLLED_BACK_EVENT_ID = '0bcf19b8-e48c-4c62-87bf-52b451f94fba';
const WORKSPACE_ID = 'cb627c9a-071f-4d93-9830-d13c522a51c8';

function signal(eventId: string): string {
  return JSON.stringify({
    changeType: 'UPDATED',
    eventId,
    resourceId: 'a21e74b9-943f-4cda-819d-8528e4fbeaa1',
    resourceType: 'ISSUE',
    version: 4,
    workspaceId: WORKSPACE_ID,
  });
}

function withTimeout(promise: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('listener notification timeout')), 2_000);

    void promise.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

describe('PostgreSQL events listener', () => {
  let listenerClient: Client | undefined;
  let sender: Client;
  let service: EventsService;

  beforeEach(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    sender = new Client({ connectionString: databaseUrl });
    await sender.connect();
    service = new EventsService(
      {
        client: { $queryRaw: jest.fn().mockResolvedValue([{ isValid: true }]) },
      } as unknown as DatabaseService,
      {
        info: jest.fn(),
        setContext: jest.fn(),
        warn: jest.fn(),
      } as unknown as PinoLogger,
      { alert: jest.fn() } as unknown as ObservabilityService,
      () => {
        listenerClient = new Client({ connectionString: databaseUrl });
        return listenerClient as PostgresListenerClient;
      },
    );
    await service.onApplicationBootstrap();
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
    await sender.end();
  });

  it('delivers committed NOTIFY, suppresses rolled-back NOTIFY, and closes streams on loss', async () => {
    expect(service.isReady()).toBe(true);

    const messages: string[] = [];
    let resolveCommitted: () => void = () => undefined;
    let resolveMarker: () => void = () => undefined;
    let resolveClosed: () => void = () => undefined;
    const committed = new Promise<void>((resolve) => {
      resolveCommitted = resolve;
    });
    const marker = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const registration = service.openStream({
      end: resolveClosed,
      membershipId: '18606655-04ed-4ee6-9596-4b15533ca5b9',
      sessionId: 'c49e70fd-54f5-4e17-9eb3-5e5ac29b31e9',
      userId: '84653be4-fbf7-4e2b-840a-713533cd57a6',
      workspaceId: WORKSPACE_ID,
      write: (chunk) => {
        messages.push(chunk);
        if (chunk.includes(`id: ${COMMITTED_EVENT_ID}`)) resolveCommitted();
        if (chunk.includes(`id: ${MARKER_EVENT_ID}`)) resolveMarker();
        return true;
      },
    });
    expect(registration).toMatchObject({ opened: true });

    await sender.query('SELECT pg_notify($1, $2)', [CHANNEL, signal(COMMITTED_EVENT_ID)]);
    await withTimeout(committed);

    await sender.query('BEGIN');
    await sender.query('SELECT pg_notify($1, $2)', [CHANNEL, signal(ROLLED_BACK_EVENT_ID)]);
    await sender.query('ROLLBACK');
    await sender.query('SELECT pg_notify($1, $2)', [CHANNEL, signal(MARKER_EVENT_ID)]);
    await withTimeout(marker);

    expect(messages.join('')).toContain(`id: ${COMMITTED_EVENT_ID}`);
    expect(messages.join('')).not.toContain(ROLLED_BACK_EVENT_ID);

    if (!listenerClient) throw new Error('listener client was not created');
    await listenerClient.end();
    await withTimeout(closed);

    expect(service.isReady()).toBe(false);
  });
});
