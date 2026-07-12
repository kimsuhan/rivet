import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Client, Notification as PostgresNotification } from 'pg';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import {
  parseResourceChangedSignal,
  type ResourceChangedSignal,
  serializeResourceChangedEvent,
} from './resource-changed-signal';

const CHANNEL = 'rivet_resource_changed_v1';
const HEARTBEAT_INTERVAL_MS = 20_000;
const LISTENER_ALERT_DELAY_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_DELAY_MS = 1_000;
const SESSION_REVALIDATION_INTERVAL_MS = 5 * 60_000;
const SESSION_REVALIDATION_TIMEOUT_MS = 5_000;

export const POSTGRES_LISTENER_CLIENT_FACTORY = Symbol('POSTGRES_LISTENER_CLIENT_FACTORY');

export type PostgresListenerClient = Pick<Client, 'connect' | 'end' | 'on' | 'query'>;
export type PostgresListenerClientFactory = () => PostgresListenerClient;

export type EventStreamConnection = {
  end: () => void;
  membershipId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  write: (chunk: string) => boolean;
};

export type EventStreamRegistration =
  | {
      opened: true;
      unsubscribe: () => void;
    }
  | {
      opened: false;
    }
  | null;

type ActiveStream = EventStreamConnection & {
  heartbeatTimer: NodeJS.Timeout | null;
  id: string;
  isRevalidating: boolean;
  revalidationTimer: NodeJS.Timeout | null;
};

@Injectable()
export class EventsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private client: PostgresListenerClient | null = null;
  private connecting: Promise<void> | null = null;
  private isConnected = false;
  private isStopping = false;
  private listenerAlertTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sseReconnectTotal = 0;
  private readonly streams = new Map<string, ActiveStream>();

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: PinoLogger,
    private readonly observability: ObservabilityService,
    @Inject(POSTGRES_LISTENER_CLIENT_FACTORY)
    private readonly createClient: PostgresListenerClientFactory,
  ) {
    this.logger.setContext(EventsService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.isStopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.listenerAlertTimer) {
      clearTimeout(this.listenerAlertTimer);
      this.listenerAlertTimer = null;
    }

    const client = this.client;
    this.client = null;
    this.isConnected = false;
    this.closeAllStreams();

    if (client) {
      await client.end().catch(() => {
        this.logger.warn(
          { connectionState: 'stopping', count: 0, errorCode: 'POSTGRES_LISTENER_CLOSE_FAILED' },
          'PostgreSQL listener 종료 실패',
        );
      });
    }

    await this.connecting?.catch(() => undefined);
  }

  isReady(): boolean {
    return this.isConnected;
  }

  metrics(): {
    postgresListenerConnected: boolean;
    sseConnections: number;
    sseReconnectTotal: number;
  } {
    return {
      postgresListenerConnected: this.isConnected,
      sseConnections: this.streams.size,
      sseReconnectTotal: this.sseReconnectTotal,
    };
  }

  openStream(connection: EventStreamConnection): EventStreamRegistration {
    if (!this.isConnected) return null;

    const stream: ActiveStream = {
      ...connection,
      heartbeatTimer: null,
      id: randomUUID(),
      isRevalidating: false,
      revalidationTimer: null,
    };
    this.streams.set(stream.id, stream);

    if (!this.write(stream, 'retry: 3000\n\n')) return { opened: false };

    stream.heartbeatTimer = setInterval(() => {
      this.write(stream, ': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);
    stream.revalidationTimer = setInterval(() => {
      void this.revalidate(stream);
    }, SESSION_REVALIDATION_INTERVAL_MS);
    this.logMetrics();

    return { opened: true, unsubscribe: () => this.removeStream(stream, false) };
  }

  private async connect(): Promise<void> {
    if (this.isStopping || this.isConnected) return;
    if (this.connecting) return this.connecting;

    const connecting = this.connectOnce();
    this.connecting = connecting;

    try {
      await connecting;
    } finally {
      if (this.connecting === connecting) {
        this.connecting = null;
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const client = this.createClient();
    this.client = client;
    client.on('notification', (notification: PostgresNotification) => {
      this.handleNotification(notification);
    });
    client.on('error', () => {
      this.handleDisconnect(client, 'POSTGRES_LISTENER_ERROR');
    });
    client.on('end', () => {
      this.handleDisconnect(client, 'POSTGRES_LISTENER_ENDED');
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);

      if (this.client !== client || this.isStopping) {
        await client.end().catch(() => undefined);
        return;
      }

      this.isConnected = true;
      this.reconnectAttempt = 0;
      if (this.listenerAlertTimer) {
        clearTimeout(this.listenerAlertTimer);
        this.listenerAlertTimer = null;
      }
      this.logger.info(
        {
          connectionState: 'connected',
          count: this.streams.size,
          postgres_listener_connected: true,
          sse_connections: this.streams.size,
          sse_reconnect_total: this.sseReconnectTotal,
        },
        'PostgreSQL listener 연결됨',
      );
    } catch {
      this.handleDisconnect(client, 'POSTGRES_LISTENER_CONNECT_FAILED');
    }
  }

  private handleDisconnect(client: PostgresListenerClient, errorCode: string): void {
    if (this.client !== client) return;

    const count = this.streams.size;
    this.client = null;
    this.isConnected = false;
    this.closeAllStreams();
    this.logger.warn(
      {
        connectionState: 'disconnected',
        count,
        errorCode,
        postgres_listener_connected: false,
        sse_connections: this.streams.size,
        sse_reconnect_total: this.sseReconnectTotal,
      },
      'PostgreSQL listener 연결 끊김',
    );
    void client.end().catch(() => undefined);

    if (!this.isStopping && !this.listenerAlertTimer) {
      this.listenerAlertTimer = setTimeout(() => {
        this.listenerAlertTimer = null;
        if (!this.isStopping && !this.isConnected) {
          this.observability.alert({
            errorCode: 'POSTGRES_LISTENER_DISCONNECTED',
            type: 'POSTGRES_LISTENER_DISCONNECTED',
          });
        }
      }, LISTENER_ALERT_DELAY_MS);
    }

    if (!this.isStopping && !this.reconnectTimer) {
      const delay = Math.min(
        RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
        MAX_RECONNECT_DELAY_MS,
      );
      this.reconnectAttempt += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect();
      }, delay);
    }
  }

  private handleNotification(notification: PostgresNotification): void {
    if (notification.channel !== CHANNEL) return;

    const signal = parseResourceChangedSignal(notification.payload);

    if (!signal) {
      this.logger.warn(
        {
          connectionState: this.isConnected ? 'connected' : 'disconnected',
          count: this.streams.size,
          errorCode: 'POSTGRES_LISTENER_SIGNAL_INVALID',
        },
        '잘못된 PostgreSQL listener 신호 무시',
      );
      return;
    }

    this.broadcast(signal);
  }

  private broadcast(signal: ResourceChangedSignal): void {
    const message = serializeResourceChangedEvent(signal);

    for (const stream of [...this.streams.values()]) {
      if (
        stream.workspaceId !== signal.workspaceId ||
        (signal.recipientMembershipId !== undefined &&
          stream.membershipId !== signal.recipientMembershipId)
      ) {
        continue;
      }

      this.write(stream, message);
    }
  }

  private write(stream: ActiveStream, chunk: string): boolean {
    if (this.streams.get(stream.id) !== stream) return false;

    try {
      if (stream.write(chunk)) return true;
    } catch {
      // 응답 전송 실패는 해당 스트림만 종료하고 PostgreSQL 신호는 재처리하지 않는다.
    }

    this.removeStream(stream, true);
    return false;
  }

  private async revalidate(stream: ActiveStream): Promise<void> {
    if (this.streams.get(stream.id) !== stream || stream.isRevalidating) return;

    stream.isRevalidating = true;
    let timeout: NodeJS.Timeout | undefined;

    try {
      const rows = await Promise.race([
        this.database.client.$queryRaw<Array<{ isValid: boolean }>>`
          SELECT EXISTS (
            SELECT 1
            FROM "sessions" AS session
            JOIN "users" AS account ON account."id" = session."user_id"
            JOIN "workspace_memberships" AS membership
              ON membership."user_id" = account."id"
            JOIN "workspaces" AS workspace ON workspace."id" = membership."workspace_id"
            WHERE session."id" = ${stream.sessionId}::uuid
              AND account."id" = ${stream.userId}::uuid
              AND membership."id" = ${stream.membershipId}::uuid
              AND membership."workspace_id" = ${stream.workspaceId}::uuid
              AND membership."status" = 'ACTIVE'
              AND workspace."id" = ${stream.workspaceId}::uuid
              AND session."revoked_at" IS NULL
              AND session."idle_expires_at" > NOW()
              AND session."absolute_expires_at" > NOW()
              AND account."email_verified_at" IS NOT NULL
          ) AS "isValid"
        `,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('SSE_SESSION_REVALIDATION_TIMEOUT')),
            SESSION_REVALIDATION_TIMEOUT_MS,
          );
        }),
      ]);

      if (rows[0]?.isValid !== true) {
        this.removeStream(stream, true);
      }
    } catch {
      this.logger.warn(
        {
          connectionState: 'stream_closed',
          count: this.streams.size,
          errorCode: 'SSE_SESSION_REVALIDATION_FAILED',
        },
        'SSE 세션 재검증 실패',
      );
      this.removeStream(stream, true);
    } finally {
      if (timeout) clearTimeout(timeout);
      stream.isRevalidating = false;
    }
  }

  private closeAllStreams(): void {
    for (const stream of [...this.streams.values()]) {
      this.removeStream(stream, true);
    }
  }

  private removeStream(stream: ActiveStream, endResponse: boolean): void {
    if (this.streams.get(stream.id) !== stream) return;

    this.streams.delete(stream.id);

    if (endResponse) this.sseReconnectTotal += 1;

    if (stream.heartbeatTimer) clearInterval(stream.heartbeatTimer);
    if (stream.revalidationTimer) clearInterval(stream.revalidationTimer);
    stream.heartbeatTimer = null;
    stream.revalidationTimer = null;

    if (endResponse) {
      try {
        stream.end();
      } catch {
        // 닫힌 소켓의 종료 실패에는 추가 복구 동작이 없다.
      }
    }

    this.logMetrics();
  }

  private logMetrics(): void {
    this.logger.info(
      {
        postgres_listener_connected: this.isConnected,
        sse_connections: this.streams.size,
        sse_reconnect_total: this.sseReconnectTotal,
      },
      '실시간 연결 지표',
    );
  }
}
