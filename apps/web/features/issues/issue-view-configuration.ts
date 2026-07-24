export const ISSUE_VISIBLE_FIELD_OPTIONS = [
  { label: '프로젝트', value: 'project' },
  { label: '라벨', value: 'labels' },
  { label: '상태', value: 'status' },
  { label: '우선순위', value: 'priority' },
  { label: '팀 작업 개수', value: 'teamWorkCount' },
  { label: '진행률', value: 'progress' },
  { label: '생성자', value: 'createdBy' },
  { label: '생성일', value: 'createdAt' },
  { label: '최근 수정일', value: 'updatedAt' },
] as const;

export const MY_WORK_VISIBLE_FIELD_OPTIONS = [
  { label: '프로젝트', value: 'project' },
  { label: '팀', value: 'team' },
  { label: '라벨', value: 'labels' },
  { label: '상태', value: 'status' },
  { label: '우선순위', value: 'priority' },
  { label: '생성일', value: 'createdAt' },
  { label: '최근 수정일', value: 'updatedAt' },
] as const;

export const ISSUE_GROUP_OPTIONS = [
  { label: '담당자', value: 'assigneeMembershipId' },
  { label: '프로젝트', value: 'projectId' },
  { label: '상태', value: 'status' },
  { label: '우선순위', value: 'priority' },
  { label: '생성자', value: 'createdByMembershipId' },
] as const;

export const MY_WORK_GROUP_OPTIONS = [
  { label: '프로젝트', value: 'projectId' },
  { label: '팀', value: 'teamId' },
  { label: '상태 범주', value: 'stateCategory' },
  { label: '워크플로 상태', value: 'workflowStateId' },
  { label: '우선순위', value: 'priority' },
] as const;

export const DEFAULT_ISSUE_VISIBLE_FIELDS = [
  'project',
  'labels',
  'status',
  'priority',
  'teamWorkCount',
  'progress',
  'updatedAt',
] as const;

export const DEFAULT_MY_WORK_VISIBLE_FIELDS = [
  'project',
  'team',
  'labels',
  'status',
  'priority',
] as const;

export function parseCsv(value: string | null | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ].sort()
    : [];
}

export function serializeCsv(values: readonly string[]): string {
  return [...new Set(values)].sort().join(',');
}

export function visibleFieldsFromSearch(
  value: string | null,
  resourceType: 'ISSUES' | 'MY_WORK',
): string[] {
  const options =
    resourceType === 'ISSUES' ? ISSUE_VISIBLE_FIELD_OPTIONS : MY_WORK_VISIBLE_FIELD_OPTIONS;
  if (value === null) {
    return [
      ...(resourceType === 'ISSUES'
        ? DEFAULT_ISSUE_VISIBLE_FIELDS
        : DEFAULT_MY_WORK_VISIBLE_FIELDS),
    ];
  }
  const selected = new Set(parseCsv(value));
  return options.flatMap((option) => (selected.has(option.value) ? [option.value] : []));
}
