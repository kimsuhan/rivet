import {
  parseResourceChangedSignal,
  type ResourceChangedSignal,
  serializeResourceChangedEvent,
} from './resource-changed.signal';

const validSignal: ResourceChangedSignal = {
  changeType: 'UPDATED',
  eventId: '4ae24db1-f652-4c11-833a-f44fef4ed56a',
  recipientMembershipId: 'c5853bcc-5294-4098-8594-519f2df1e8a9',
  resourceId: '468ef342-f335-4dc6-b15d-57df4cc8f4e9',
  resourceType: 'ISSUE',
  version: 3,
  workspaceId: 'd3186916-533d-4e87-a678-b9c9ec773249',
};

describe('resource changed signal', () => {
  it('accepts the exact version 1 signal contract', () => {
    expect(parseResourceChangedSignal(JSON.stringify(validSignal))).toEqual(validSignal);
    expect(
      parseResourceChangedSignal(
        JSON.stringify({ ...validSignal, recipientMembershipId: undefined, version: null }),
      ),
    ).toEqual({
      ...validSignal,
      recipientMembershipId: undefined,
      version: null,
    });
  });

  it.each([
    undefined,
    '{',
    '[]',
    JSON.stringify({ ...validSignal, body: 'sensitive' }),
    JSON.stringify({ ...validSignal, eventId: 'not-a-uuid' }),
    JSON.stringify({ ...validSignal, workspaceId: '00000000-0000-0000-0000-000000000000' }),
    JSON.stringify({ ...validSignal, resourceId: '468ef342-f335-1dc6-b15d-57df4cc8f4e9' }),
    JSON.stringify({ ...validSignal, recipientMembershipId: null }),
    JSON.stringify({ ...validSignal, resourceType: 'USER' }),
    JSON.stringify({ ...validSignal, changeType: 'READ' }),
    JSON.stringify({ ...validSignal, version: 0 }),
    JSON.stringify({ ...validSignal, version: 1.5 }),
    JSON.stringify({ ...validSignal, version: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...validSignal, version: undefined }),
  ])('rejects malformed or expanded payload %#', (payload) => {
    expect(parseResourceChangedSignal(payload)).toBeNull();
  });

  it('serializes only the browser resource.changed contract', () => {
    const event = serializeResourceChangedEvent(validSignal);

    expect(event).toBe(
      'event: resource.changed\n' +
        'id: 4ae24db1-f652-4c11-833a-f44fef4ed56a\n' +
        'data: {"resourceType":"ISSUE","resourceId":"468ef342-f335-4dc6-b15d-57df4cc8f4e9","changeType":"UPDATED","version":3}\n\n',
    );
    expect(event).not.toContain('workspaceId');
    expect(event).not.toContain('recipientMembershipId');
  });
});
