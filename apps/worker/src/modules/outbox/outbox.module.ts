import { Module } from '@nestjs/common';

import { ObservabilityModule } from '../../common/observability/observability.module';
import { EmailModule } from '../email/email.module';
import { WebPushModule } from '../web-push/web-push.module';
import { AccountEmailHandler } from './handlers/account-email.handler';
import { ApiHandoffNotificationHandler } from './handlers/api-handoff-notification.handler';
import { IssueCollaborationNotificationHandler } from './handlers/issue-collaboration-notification.handler';
import { ResourcePurgeHandler } from './handlers/resource-purge.handler';
import { WorkspaceInvitationEmailHandler } from './handlers/workspace-invitation-email.handler';
import { OutboxService } from './outbox.service';
import { OutboxPollerService } from './outbox-poller.service';
import { OutboxProcessorService } from './outbox-processor.service';

@Module({
  imports: [EmailModule, ObservabilityModule, WebPushModule],
  providers: [
    AccountEmailHandler,
    ApiHandoffNotificationHandler,
    IssueCollaborationNotificationHandler,
    ResourcePurgeHandler,
    WorkspaceInvitationEmailHandler,
    OutboxPollerService,
    OutboxProcessorService,
    OutboxService,
  ],
})
export class OutboxModule {}
