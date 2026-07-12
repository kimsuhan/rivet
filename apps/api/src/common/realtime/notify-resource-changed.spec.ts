import { isUUID } from 'class-validator';

import type { Prisma } from '@rivet/database';

import { notifyResourceChanged } from './notify-resource-changed';

describe('notifyResourceChanged', () => {
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const resourceId = '953685f0-4921-41cd-8422-d8a1ccc3f547';

  it('parameterizes the channel and emits only the strict redacted payload', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const transaction = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
    const signal = {
      bodyMarkdown: '외부로 나가면 안 되는 본문',
      changeType: 'UPDATED' as const,
      eventId: '05ed9724-f207-447d-9f18-7026f493d3fd',
      originalName: 'secret.pdf',
      resourceId,
      resourceType: 'COMMENT' as const,
      version: 2,
      workspaceId,
    };

    await notifyResourceChanged(transaction, signal);

    const [, channel, payload] = executeRaw.mock.calls[0] as [TemplateStringsArray, string, string];
    expect(channel).toBe('rivet_resource_changed_v1');
    expect(JSON.parse(payload)).toEqual({
      changeType: 'UPDATED',
      eventId: signal.eventId,
      resourceId,
      resourceType: 'COMMENT',
      version: 2,
      workspaceId,
    });
    expect(payload).not.toContain('본문');
    expect(payload).not.toContain('secret.pdf');
  });

  it('creates a distinct UUIDv4 for every resource change signal', async () => {
    const payloads: string[] = [];
    const executeRaw = jest.fn((_: TemplateStringsArray, _channel: string, payload: string) => {
      payloads.push(payload);
      return Promise.resolve(1);
    });
    const transaction = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
    const signal = {
      changeType: 'CREATED' as const,
      resourceId,
      resourceType: 'LABEL' as const,
      version: 1,
      workspaceId,
    };

    await notifyResourceChanged(transaction, signal);
    await notifyResourceChanged(transaction, signal);

    const eventIds = payloads.map(
      (payload) => (JSON.parse(payload) as { eventId: string }).eventId,
    );
    expect(eventIds[0]).not.toBe(eventIds[1]);
    expect(eventIds.every((eventId) => isUUID(eventId, '4'))).toBe(true);
  });

  it('propagates NOTIFY failures so the owning transaction can roll back', async () => {
    const failure = new Error('NOTIFY_FAILED');
    const transaction = {
      $executeRaw: jest.fn().mockRejectedValue(failure),
    } as unknown as Prisma.TransactionClient;

    await expect(
      notifyResourceChanged(transaction, {
        changeType: 'DELETED',
        resourceId,
        resourceType: 'FILE',
        version: null,
        workspaceId,
      }),
    ).rejects.toBe(failure);
  });
});
