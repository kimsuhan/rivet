import { ProductEventsService } from './product-events.service';

describe('ProductEventsService', () => {
  const savedView = { findFirst: jest.fn() };
  const issueTemplate = { findFirst: jest.fn() };
  const notification = { findFirst: jest.fn() };
  const issue = { findFirst: jest.fn() };
  const teamWork = { findFirst: jest.fn() };
  const queryRaw = jest.fn();
  const database = {
    client: { $queryRaw: queryRaw, issue, issueTemplate, notification, savedView, teamWork },
  };
  const observability = { capture: jest.fn() };
  const rateLimits = { consume: jest.fn() };
  const service = new ProductEventsService(
    database as never,
    observability as never,
    rateLimits as never,
  );
  const context = {
    membershipId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '11111111-1111-4111-8111-111111111111',
  };
  const resourceId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimits.consume.mockResolvedValue(undefined);
    queryRaw.mockResolvedValue([{ occurredAt: new Date(), version: 1 }]);
  });

  it('creates identity and time on the server for a supported result', async () => {
    const before = Date.now();

    await expect(
      service.capture(context, {
        name: 'push_permission_result',
        properties: { result: 'UNSUPPORTED' },
      }),
    ).resolves.toEqual({ status: 'ACCEPTED' });

    const captured = observability.capture.mock.calls[0]![0];
    expect(captured).toMatchObject({
      membershipId: context.membershipId,
      name: 'push_permission_result',
      payloadVersion: 1,
      properties: { result: 'UNSUPPORTED' },
      workspaceId: context.workspaceId,
    });
    expect(captured.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(captured.occurredAt)).toBeGreaterThanOrEqual(before);
    expect(rateLimits.consume).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'PRODUCT_EVENT_MEMBERSHIP' }),
      context.membershipId,
    );
  });

  it.each([
    [
      'saved view',
      {
        name: 'saved_view_opened',
        properties: { resourceType: 'ISSUES', savedViewId: resourceId },
      },
      savedView,
    ],
    [
      'template',
      { name: 'issue_template_applied', properties: { templateId: resourceId } },
      issueTemplate,
    ],
    [
      'notification',
      { name: 'push_notification_clicked', properties: { notificationId: resourceId } },
      notification,
    ],
    [
      'issue search result',
      { name: 'search_result_selected', properties: { resourceId, resultType: 'ISSUE' } },
      issue,
    ],
    [
      'team work search result',
      { name: 'search_result_selected', properties: { resourceId, resultType: 'TEAM_WORK' } },
      teamWork,
    ],
  ])(
    'rejects an arbitrary %s UUID outside the current resource scope',
    async (_label, dto, model) => {
      model.findFirst.mockResolvedValue(null);

      await expect(service.capture(context, dto as never)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PRODUCT_EVENT_RESOURCE_INVALID' }),
        status: 422,
      });
      expect(observability.capture).not.toHaveBeenCalled();
    },
  );

  it('accepts only a notification owned by the active membership and keeps click identity stable', async () => {
    notification.findFirst.mockResolvedValue({ id: resourceId });
    const dto = {
      name: 'push_notification_clicked' as const,
      properties: { notificationId: resourceId },
    };

    await service.capture(context, dto);
    await service.capture(context, dto);

    expect(notification.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: resourceId,
        recipientMembershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
    expect(observability.capture.mock.calls[0]![0].eventId).toBe(
      observability.capture.mock.calls[1]![0].eventId,
    );
  });

  it('uses a stable daily identity for repeatable client actions', async () => {
    savedView.findFirst.mockResolvedValue({ id: resourceId });
    const dto = {
      name: 'saved_view_opened' as const,
      properties: { resourceType: 'ISSUES', savedViewId: resourceId },
    };

    await service.capture(context, dto);
    await service.capture(context, dto);

    expect(observability.capture.mock.calls[0]![0].eventId).toBe(
      observability.capture.mock.calls[1]![0].eventId,
    );
  });

  it('captures only a new push permission state transition', async () => {
    queryRaw
      .mockResolvedValueOnce([{ occurredAt: new Date('2026-07-18T00:00:00.000Z'), version: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ occurredAt: new Date('2026-07-18T00:01:00.000Z'), version: 2 }]);

    await service.capture(context, {
      name: 'push_permission_result',
      properties: { result: 'DENIED' },
    });
    await service.capture(context, {
      name: 'push_permission_result',
      properties: { result: 'DENIED' },
    });
    await service.capture(context, {
      name: 'push_permission_result',
      properties: { result: 'GRANTED' },
    });

    expect(observability.capture).toHaveBeenCalledTimes(2);
    expect(observability.capture.mock.calls.map(([event]) => event.properties.result)).toEqual([
      'DENIED',
      'GRANTED',
    ]);
    expect(observability.capture.mock.calls[0]![0].eventId).not.toBe(
      observability.capture.mock.calls[1]![0].eventId,
    );
  });

  it('does not capture when the membership rate limit rejects a burst', async () => {
    rateLimits.consume.mockRejectedValue(new Error('RATE_LIMITED'));

    await expect(
      service.capture(context, {
        name: 'push_permission_result',
        properties: { result: 'DENIED' },
      }),
    ).rejects.toThrow('RATE_LIMITED');
    expect(observability.capture).not.toHaveBeenCalled();
  });
});
