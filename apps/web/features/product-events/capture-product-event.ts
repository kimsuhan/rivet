import { productEventsControllerCapture } from '@rivet/api-client';

type ClientProductEventName =
  | 'saved_view_opened'
  | 'issue_template_applied'
  | 'push_permission_result'
  | 'push_notification_clicked'
  | 'search_result_selected';

export function captureProductEvent(
  name: ClientProductEventName,
  properties: Record<string, unknown>,
): void {
  void productEventsControllerCapture({
    name,
    properties,
  }).catch(() => undefined);
}
