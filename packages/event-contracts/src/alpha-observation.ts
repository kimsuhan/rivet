import type { ProductEvent, ProductEventName } from './product-events';
import { validateProductEvent } from './product-events';

export type AlphaObservation = {
  duplicateEventCount: number;
  eventCounts: Partial<Record<ProductEventName, number>>;
  feedbackByCategory: Record<'BUG' | 'USABILITY' | 'IDEA' | 'OTHER', number>;
  csvValidationByExecution: Array<{
    errorCodes: Record<string, number>;
    executionId: string;
    retryCount: number;
    validationAttemptCount: number;
  }>;
  firstFlowDurationsMinutes: Array<{
    completedByMembershipId: string | null;
    createdByMembershipId: string;
    firstIssueToFirstWorkCompleted: number | null;
    firstIssueToFirstWorkStarted: number | null;
    issueId: string;
    startedByMembershipId: string | null;
    workspaceId: string;
  }>;
  issueTemplatesCreated: number;
  notificationReadDurationsMinutes: number[];
  onboardingFlows: Array<{
    csvImportCompletedAt: string | null;
    invitationAcceptedAt: string | null;
    membershipId: string;
    signupCompletedAt: string | null;
    workspaceCreatedAt: string | null;
    workspaceId: string;
  }>;
  pushClickRate: number | null;
  pushDeliveryResults: Record<'SUCCEEDED' | 'FAILED', number>;
  pushPermissionResults: Record<'GRANTED' | 'DENIED' | 'DISMISSED' | 'UNSUPPORTED', number>;
  pushPermissionTransitionCount: number;
  rejectedEventCount: number;
  semanticDuplicateEventCount: number;
  templateApplications: number;
  templateIssuesCreated: number;
  uniqueSavedViewCreators: number;
  validatedEventCount: number;
};

function minutesBetween(
  start: ProductEvent | undefined,
  end: ProductEvent | undefined,
): number | null {
  if (!start || !end) return null;
  return Math.max(0, (Date.parse(end.occurredAt) - Date.parse(start.occurredAt)) / 60_000);
}

export function calculateAlphaObservation(values: readonly unknown[]): AlphaObservation {
  const unique = new Map<string, ProductEvent>();
  let rejectedEventCount = 0;
  let duplicateEventCount = 0;
  for (const value of values) {
    const result = validateProductEvent(value);
    if (!result.success) {
      rejectedEventCount += 1;
      continue;
    }
    if (unique.has(result.event.eventId)) {
      duplicateEventCount += 1;
      continue;
    }
    unique.set(result.event.eventId, result.event);
  }
  const events = [...unique.values()].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );
  const metricEvents: ProductEvent[] = [];
  const seenClientSemantics = new Set<string>();
  const latestPushPermission = new Map<string, ProductEvent>();
  let pushPermissionTransitionCount = 0;
  let semanticDuplicateEventCount = 0;
  for (const event of events) {
    const actorKey = `${event.workspaceId}:${event.membershipId}`;
    if (event.name === 'push_permission_result') {
      const previous = latestPushPermission.get(actorKey);
      if (previous?.properties.result === event.properties.result) {
        semanticDuplicateEventCount += 1;
      } else if (previous) {
        pushPermissionTransitionCount += 1;
      }
      latestPushPermission.set(actorKey, event);
      continue;
    }

    let semanticKey: string | null = null;
    const utcDay = event.occurredAt.slice(0, 10);
    if (event.name === 'saved_view_opened') {
      semanticKey = `${event.name}:${actorKey}:${event.properties.savedViewId}:${utcDay}`;
    } else if (event.name === 'issue_template_applied') {
      semanticKey = `${event.name}:${actorKey}:${event.properties.templateId}:${utcDay}`;
    } else if (event.name === 'search_result_selected') {
      semanticKey = `${event.name}:${actorKey}:${event.properties.resultType}:${event.properties.resourceId}:${utcDay}`;
    } else if (event.name === 'push_notification_clicked') {
      semanticKey = `${event.name}:${actorKey}:${event.properties.notificationId}`;
    }
    if (semanticKey && seenClientSemantics.has(semanticKey)) {
      semanticDuplicateEventCount += 1;
      continue;
    }
    if (semanticKey) seenClientSemantics.add(semanticKey);
    metricEvents.push(event);
  }
  metricEvents.push(...latestPushPermission.values());
  metricEvents.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const eventCounts: Partial<Record<ProductEventName, number>> = {};
  const feedbackByCategory = { BUG: 0, IDEA: 0, OTHER: 0, USABILITY: 0 };
  const pushDeliveryResults = { FAILED: 0, SUCCEEDED: 0 };
  const pushPermissionResults = { DENIED: 0, DISMISSED: 0, GRANTED: 0, UNSUPPORTED: 0 };
  const firstByIssue = new Map<string, Partial<Record<ProductEventName, ProductEvent>>>();
  const onboardingByActor = new Map<string, Partial<Record<ProductEventName, ProductEvent>>>();
  const csvValidationByExecution = new Map<
    string,
    { attempts: Set<string>; errorCodes: Record<string, number> }
  >();
  const notificationCreated = new Map<string, ProductEvent>();
  const notificationReadDurationsMinutes: number[] = [];
  const savedViewCreators = new Set<string>();
  const successfulPushNotifications = new Set<string>();
  const clickedPushNotifications = new Set<string>();

  for (const event of metricEvents) {
    eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
    const actorKey = `${event.workspaceId}:${event.membershipId}`;
    if (
      event.name === 'invitation_accepted' ||
      event.name === 'signup_completed' ||
      event.name === 'workspace_created' ||
      event.name === 'csv_import_completed'
    ) {
      const stages = onboardingByActor.get(actorKey) ?? {};
      stages[event.name] ??= event;
      onboardingByActor.set(actorKey, stages);
    }
    if (
      event.name === 'issue_created' ||
      event.name === 'team_work_started' ||
      event.name === 'team_work_completed'
    ) {
      const issueKey = `${event.workspaceId}:${String(event.properties.issueId)}`;
      const first = firstByIssue.get(issueKey) ?? {};
      first[event.name] ??= event;
      firstByIssue.set(issueKey, first);
    }

    if (event.name === 'csv_import_validated') {
      const executionId = event.properties.executionId as string;
      const summary = csvValidationByExecution.get(executionId) ?? {
        attempts: new Set<string>(),
        errorCodes: {},
      };
      summary.attempts.add(event.properties.attemptId as string);
      for (const code of event.properties.errorCodes as string[]) {
        summary.errorCodes[code] = (summary.errorCodes[code] ?? 0) + 1;
      }
      csvValidationByExecution.set(executionId, summary);
    }

    if (event.name === 'feedback_submitted') {
      feedbackByCategory[event.properties.category as keyof typeof feedbackByCategory] += 1;
    }
    if (event.name === 'push_permission_result') {
      pushPermissionResults[event.properties.result as keyof typeof pushPermissionResults] += 1;
    }
    if (event.name === 'push_delivery_succeeded') {
      pushDeliveryResults.SUCCEEDED += 1;
      successfulPushNotifications.add(event.properties.notificationId as string);
    }
    if (event.name === 'push_delivery_failed') pushDeliveryResults.FAILED += 1;
    if (event.name === 'push_notification_clicked') {
      clickedPushNotifications.add(event.properties.notificationId as string);
    }
    if (event.name === 'saved_view_created') savedViewCreators.add(actorKey);
    if (event.name === 'notification_created') {
      notificationCreated.set(event.properties.notificationId as string, event);
    }
    if (event.name === 'notification_read') {
      const created = notificationCreated.get(event.properties.notificationId as string);
      const duration = minutesBetween(created, event);
      if (duration !== null) notificationReadDurationsMinutes.push(duration);
    }
  }

  return {
    duplicateEventCount,
    csvValidationByExecution: [...csvValidationByExecution.entries()].map(
      ([executionId, summary]) => ({
        errorCodes: summary.errorCodes,
        executionId,
        retryCount: Math.max(0, summary.attempts.size - 1),
        validationAttemptCount: summary.attempts.size,
      }),
    ),
    eventCounts,
    feedbackByCategory,
    issueTemplatesCreated: eventCounts.issue_template_created ?? 0,
    firstFlowDurationsMinutes: [...firstByIssue.entries()]
      .filter(([, first]) => first.issue_created)
      .map(([key, first]) => {
        const [workspaceId, issueId] = key.split(':') as [string, string];
        return {
          completedByMembershipId: first.team_work_completed?.membershipId ?? null,
          createdByMembershipId: first.issue_created!.membershipId,
          firstIssueToFirstWorkCompleted: minutesBetween(
            first.issue_created,
            first.team_work_completed,
          ),
          firstIssueToFirstWorkStarted: minutesBetween(
            first.issue_created,
            first.team_work_started,
          ),
          issueId,
          startedByMembershipId: first.team_work_started?.membershipId ?? null,
          workspaceId,
        };
      }),
    notificationReadDurationsMinutes,
    onboardingFlows: [...onboardingByActor.entries()].map(([key, stages]) => {
      const [workspaceId, membershipId] = key.split(':') as [string, string];
      return {
        csvImportCompletedAt: stages.csv_import_completed?.occurredAt ?? null,
        invitationAcceptedAt: stages.invitation_accepted?.occurredAt ?? null,
        membershipId,
        signupCompletedAt: stages.signup_completed?.occurredAt ?? null,
        workspaceCreatedAt: stages.workspace_created?.occurredAt ?? null,
        workspaceId,
      };
    }),
    pushClickRate:
      successfulPushNotifications.size === 0
        ? null
        : [...clickedPushNotifications].filter((id) => successfulPushNotifications.has(id)).length /
          successfulPushNotifications.size,
    pushDeliveryResults,
    pushPermissionResults,
    pushPermissionTransitionCount,
    rejectedEventCount,
    semanticDuplicateEventCount,
    templateApplications: eventCounts.issue_template_applied ?? 0,
    templateIssuesCreated: eventCounts.template_issue_created ?? 0,
    uniqueSavedViewCreators: savedViewCreators.size,
    validatedEventCount: events.length,
  };
}
