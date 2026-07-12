'use client';

import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';

const RESOURCE_TYPES = [
  'ISSUE',
  'PROJECT',
  'COMMENT',
  'HANDOFF',
  'NOTIFICATION',
  'MEMBER',
  'TEAM',
  'WORKFLOW_STATE',
  'LABEL',
  'FILE',
] as const;
const CHANGE_TYPES = ['CREATED', 'UPDATED', 'DELETED', 'RESTORED'] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SEEN_EVENT_IDS = 200;

type ResourceType = (typeof RESOURCE_TYPES)[number];
type ChangeType = (typeof CHANGE_TYPES)[number];

type ResourceChangedEvent = {
  changeType: ChangeType;
  resourceId: string;
  resourceType: ResourceType;
  version: number | null;
};

const RESOURCE_QUERY_PREFIXES: Record<ResourceType, readonly string[]> = {
  ISSUE: ['/api/v1/issues', '/api/v1/projects', '/api/v1/search/issues', '/api/v1/notifications'],
  PROJECT: ['/api/v1/projects', '/api/v1/issues', '/api/v1/search/issues'],
  COMMENT: ['/api/v1/issues'],
  HANDOFF: ['/api/v1/issues'],
  NOTIFICATION: ['/api/v1/notifications'],
  MEMBER: [
    '/api/v1/members',
    '/api/v1/issues',
    '/api/v1/projects',
    '/api/v1/notifications',
    '/api/v1/search/issues',
    '/api/v1/auth/session',
  ],
  TEAM: ['/api/v1/teams', '/api/v1/issues', '/api/v1/projects', '/api/v1/search/issues'],
  WORKFLOW_STATE: ['/api/v1/teams', '/api/v1/issues', '/api/v1/search/issues'],
  LABEL: ['/api/v1/labels', '/api/v1/issues', '/api/v1/search/issues'],
  FILE: [
    '/api/v1/files',
    '/api/v1/issues',
    '/api/v1/projects',
    '/api/v1/members',
    '/api/v1/notifications',
    '/api/v1/search/issues',
    '/api/v1/auth/session',
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseResourceChangedEvent(data: string): ResourceChangedEvent | null {
  let value: unknown;

  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    !['changeType', 'resourceId', 'resourceType', 'version'].every((key) =>
      Object.hasOwn(value, key),
    ) ||
    typeof value.resourceType !== 'string' ||
    !RESOURCE_TYPES.includes(value.resourceType as ResourceType) ||
    typeof value.changeType !== 'string' ||
    !CHANGE_TYPES.includes(value.changeType as ChangeType) ||
    typeof value.resourceId !== 'string' ||
    !UUID_V4.test(value.resourceId) ||
    !(
      value.version === null ||
      (typeof value.version === 'number' &&
        Number.isSafeInteger(value.version) &&
        value.version >= 1)
    )
  ) {
    return null;
  }

  return {
    changeType: value.changeType as ChangeType,
    resourceId: value.resourceId,
    resourceType: value.resourceType as ResourceType,
    version: value.version,
  };
}

export function queryMatchesResource(queryKey: QueryKey, resourceType: ResourceType): boolean {
  const path = queryKey[0];
  if (typeof path !== 'string') return false;

  return RESOURCE_QUERY_PREFIXES[resourceType].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function RealtimeSync({
  children,
  labels,
}: {
  children: ReactNode;
  labels: { disconnected: string; reconnecting: string };
}) {
  const queryClient = useQueryClient();
  const [disconnected, setDisconnected] = useState(false);
  const hasOpened = useRef(false);
  const connectionWasInterrupted = useRef(false);
  const seenEventIds = useRef(new Set<string>());
  const seenEventOrder = useRef<string[]>([]);

  useEffect(() => {
    const source = new EventSource('/api/v1/events', { withCredentials: true });

    function revalidateActiveQueries() {
      void queryClient.invalidateQueries({ refetchType: 'active' }).catch(() => undefined);
    }

    function handleOpen() {
      setDisconnected(false);

      if (hasOpened.current || connectionWasInterrupted.current) revalidateActiveQueries();
      hasOpened.current = true;
      connectionWasInterrupted.current = false;
    }

    function handleError() {
      connectionWasInterrupted.current = true;
      setDisconnected(true);
    }

    function handleResourceChanged(event: Event) {
      const message = event as MessageEvent<string>;
      const eventId = message.lastEventId;
      const change = parseResourceChangedEvent(message.data);

      if (!change || !UUID_V4.test(eventId) || seenEventIds.current.has(eventId)) return;

      seenEventIds.current.add(eventId);
      seenEventOrder.current.push(eventId);
      if (seenEventOrder.current.length > MAX_SEEN_EVENT_IDS) {
        const oldest = seenEventOrder.current.shift();
        if (oldest) seenEventIds.current.delete(oldest);
      }

      void queryClient
        .invalidateQueries({
          predicate: ({ queryKey }) => queryMatchesResource(queryKey, change.resourceType),
          refetchType: 'active',
        })
        .catch(() => undefined);
    }

    source.addEventListener('open', handleOpen);
    source.addEventListener('error', handleError);
    source.addEventListener('resource.changed', handleResourceChanged);
    window.addEventListener('focus', revalidateActiveQueries);

    return () => {
      source.removeEventListener('open', handleOpen);
      source.removeEventListener('error', handleError);
      source.removeEventListener('resource.changed', handleResourceChanged);
      window.removeEventListener('focus', revalidateActiveQueries);
      source.close();
    };
  }, [queryClient]);

  return (
    <>
      {children}
      {disconnected ? (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-surface-1 text-foreground app-floating-layer pointer-events-none fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-w-[calc(100vw-1.5rem)] rounded-lg border px-3 py-2 shadow-lg lg:right-5 lg:bottom-5"
        >
          <p className="text-sm font-medium">{labels.disconnected}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{labels.reconnecting}</p>
        </div>
      ) : null}
    </>
  );
}
