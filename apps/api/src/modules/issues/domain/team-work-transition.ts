import { StateCategory } from '@rivet/database';

export function shouldAutoStartOnAssignment(state: {
  isDefault: boolean;
  category: StateCategory;
}): boolean {
  return state.isDefault && state.category === StateCategory.BACKLOG;
}
