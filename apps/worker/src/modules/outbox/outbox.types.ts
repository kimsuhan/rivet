export type ClaimedOutboxEvent = {
  actorMembershipId: string | null;
  aggregateId: string;
  aggregateType: string;
  attemptCount: number;
  availableAt: Date;
  createdAt: Date;
  eventType: string;
  id: string;
  payload: unknown;
  workspaceId: string | null;
};
