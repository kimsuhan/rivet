import { randomUUID } from 'node:crypto';

import type { Prisma } from '@rivet/database';

export async function notifyResourceChanged(
  transaction: Prisma.TransactionClient,
  signal: {
    changeType: 'CREATED' | 'UPDATED' | 'DELETED' | 'RESTORED';
    eventId?: string;
    resourceId: string;
    resourceType:
      | 'ISSUE'
      | 'TEAM_WORK'
      | 'PROJECT'
      | 'COMMENT'
      | 'HANDOFF'
      | 'MEMBER'
      | 'TEAM'
      | 'WORKFLOW_STATE'
      | 'LABEL'
      | 'FILE';
    version: number | null;
    workspaceId: string;
  },
): Promise<void> {
  const payload = JSON.stringify({
    changeType: signal.changeType,
    eventId: signal.eventId ?? randomUUID(),
    resourceId: signal.resourceId,
    resourceType: signal.resourceType,
    version: signal.version,
    workspaceId: signal.workspaceId,
  });

  await transaction.$executeRaw`
    SELECT pg_notify(${'rivet_resource_changed_v1'}, ${payload})
  `;
}
