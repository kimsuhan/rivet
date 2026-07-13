export const FEATURE_ISSUE_LIST_GRID_COLUMNS =
  'xl:grid-cols-[5.5rem_minmax(11rem,1fr)_7.5rem_minmax(10rem,1fr)_6rem_4rem_7rem] 2xl:grid-cols-[6rem_minmax(19rem,1fr)_8rem_minmax(14rem,1fr)_7rem_4.5rem_8rem]';

export const FEATURE_ISSUE_LIST_GRID_CLASS = `${FEATURE_ISSUE_LIST_GRID_COLUMNS} xl:items-center xl:gap-3`;

export const FEATURE_ISSUE_LIST_GRID_ORDER = {
  currentWork: 'xl:order-4',
  issue: 'xl:order-2',
  nextAction: 'xl:order-7',
  priority: 'xl:order-1',
  progress: 'xl:order-5',
  status: 'xl:order-3',
  updatedAt: 'xl:order-6',
} as const;

export const FEATURE_ISSUE_LIST_GRID_CELL_CLASS = {
  currentWork: `col-span-2 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.currentWork}`,
  issue: `col-span-2 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.issue}`,
  nextAction: `col-span-2 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.nextAction}`,
  priority: `col-span-1 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.priority}`,
  progress: `col-span-2 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.progress}`,
  status: `col-span-1 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.status}`,
  updatedAt: `col-span-2 xl:col-span-1 ${FEATURE_ISSUE_LIST_GRID_ORDER.updatedAt}`,
} as const;
