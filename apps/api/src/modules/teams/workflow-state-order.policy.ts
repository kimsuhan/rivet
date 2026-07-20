import { StateCategory } from '@rivet/database';

export const WORKFLOW_STATE_CATEGORY_ORDER = [
  StateCategory.BACKLOG,
  StateCategory.UNSTARTED,
  StateCategory.STARTED,
  StateCategory.COMPLETED,
  StateCategory.CANCELED,
] as const;

export function workflowStateCategoryRank(category: StateCategory): number {
  return WORKFLOW_STATE_CATEGORY_ORDER.indexOf(category);
}
