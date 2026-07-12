import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseResourceChangedEvent, queryMatchesResource, RealtimeSync } from './realtime-sync';

const EVENT_ID = '4ae24db1-f652-4c11-833a-f44fef4ed56a';
const RESOURCE_ID = '468ef342-f335-4dc6-b15d-57df4cc8f4e9';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  readonly close = vi.fn();

  constructor(
    readonly url: string | URL,
    readonly options?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (listener) this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

function renderSync(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RealtimeSync labels={{ disconnected: '실시간 연결 끊김', reconnecting: '재연결 중' }}>
        <span>업무 화면</span>
      </RealtimeSync>
    </QueryClientProvider>,
  );
}

function resourceEvent(resourceType: string, lastEventId = EVENT_ID) {
  return new MessageEvent('resource.changed', {
    data: JSON.stringify({
      changeType: 'UPDATED',
      resourceId: RESOURCE_ID,
      resourceType,
      version: 2,
    }),
    lastEventId,
  });
}

describe('RealtimeSync', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses only the exact public resource.changed payload', () => {
    expect(parseResourceChangedEvent(resourceEvent('ISSUE').data)).toEqual({
      changeType: 'UPDATED',
      resourceId: RESOURCE_ID,
      resourceType: 'ISSUE',
      version: 2,
    });
    expect(parseResourceChangedEvent('{')).toBeNull();
    expect(
      parseResourceChangedEvent(
        JSON.stringify({
          body: '노출 금지',
          changeType: 'UPDATED',
          resourceId: RESOURCE_ID,
          resourceType: 'ISSUE',
          version: 2,
        }),
      ),
    ).toBeNull();
  });

  it('maps resource changes to their dependent REST query keys', () => {
    expect(queryMatchesResource(['/api/v1/issues', { teamId: 'team' }], 'ISSUE')).toBe(true);
    expect(queryMatchesResource(['/api/v1/projects/project-id'], 'ISSUE')).toBe(true);
    expect(queryMatchesResource(['/api/v1/search/issues', { query: 'API' }], 'ISSUE')).toBe(true);
    expect(queryMatchesResource(['/api/v1/notifications/unread-count'], 'NOTIFICATION')).toBe(true);
    expect(queryMatchesResource(['/api/v1/projects'], 'NOTIFICATION')).toBe(false);
  });

  it('uses one credentialed EventSource, shows disconnect state and revalidates after reconnect', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const view = renderSync(queryClient);
    const source = FakeEventSource.instances[0];

    expect(source?.url).toBe('/api/v1/events');
    expect(source?.options).toEqual({ withCredentials: true });

    act(() => source?.dispatch('open', new Event('open')));
    expect(invalidate).not.toHaveBeenCalled();

    act(() => source?.dispatch('error', new Event('error')));
    const disconnectedStatus = screen.getByRole('status');
    expect(disconnectedStatus).toHaveTextContent('실시간 연결 끊김');
    expect(disconnectedStatus).toHaveClass('pointer-events-none');

    act(() => source?.dispatch('open', new Event('open')));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });

    view.unmount();
    expect(source?.close).toHaveBeenCalledOnce();
  });

  it('revalidates if the initial connection was interrupted before its first open', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    renderSync(queryClient);
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.dispatch('error', new Event('error'));
      source?.dispatch('open', new Event('open'));
    });

    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
  });

  it('deduplicates event IDs and invalidates only the resource query family', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    renderSync(queryClient);
    const source = FakeEventSource.instances[0];

    act(() => {
      source?.dispatch('resource.changed', resourceEvent('NOTIFICATION'));
      source?.dispatch('resource.changed', resourceEvent('NOTIFICATION'));
    });

    expect(invalidate).toHaveBeenCalledOnce();
    const options = invalidate.mock.calls[0]?.[0];
    expect(options?.predicate?.({ queryKey: ['/api/v1/notifications'] } as never)).toBe(true);
    expect(options?.predicate?.({ queryKey: ['/api/v1/issues'] } as never)).toBe(false);
  });
});
