'use client';

import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  ListTodo,
  type LucideIcon,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';

import {
  type IssuesControllerGroupsParams,
  type IssuesControllerListParams,
  type ListGroupResponseDto,
  type ListSubGroupResponseDto,
  type TeamWorksControllerGroupsParams,
  type TeamWorksControllerListParams,
  useIssuesControllerGroups,
  useTeamWorksControllerGroups,
} from '@rivet/api-client';

import { ProjectLogo } from '@/components/project-logo';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { type WorkflowStateCategory, WorkflowStateIcon } from '@/components/workflow-state-icon';
import { cn } from '@/lib/utils';

import { ISSUE_STATUS_PRESENTATION, PRIORITY_PRESENTATION } from './issue-attribute-presentation';
import { getIssuePagesQueryKey, useIssuePages, useTeamWorkPages } from './issue-list-queries';
import { IssueListRow } from './issue-list-row';
import { issueWorkHref } from './issue-work-routing';
import { MyWorkListRow } from './my-work-list-row';

const STATUS_LABELS: Record<string, string> = {
  CANCELED: '취소',
  DONE: '완료',
  IN_PROGRESS: '진행 중',
  PAUSED: '일시 중지',
  REVIEW: '배포 대기',
  TODO: '할 일',
  UNSORTED: '접수됨',
};
const CATEGORY_LABELS: Record<string, string> = {
  BACKLOG: '백로그',
  CANCELED: '취소',
  COMPLETED: '완료',
  STARTED: '진행 중',
  UNSTARTED: '시작 전',
};
const PRIORITY_LABELS: Record<string, string> = {
  HIGH: '높음',
  LOW: '낮음',
  MEDIUM: '보통',
  NONE: '없음',
  URGENT: '긴급',
};
const STATUS_ORDER = ['UNSORTED', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'PAUSED', 'CANCELED'];
const CATEGORY_ORDER = ['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED'];
const PRIORITY_ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
const UNASSIGNED_GROUP_VALUE = '__unassigned__';

function groupLabel(field: string, label: string): string {
  if (field === 'status') return STATUS_LABELS[label] ?? label;
  if (field === 'stateCategory') return CATEGORY_LABELS[label] ?? label;
  if (field === 'priority') return PRIORITY_LABELS[label] ?? label;
  return label;
}

function compareGroups(
  field: string,
  left: { label: string; value: string },
  right: { label: string; value: string },
): number {
  const order =
    field === 'status'
      ? STATUS_ORDER
      : field === 'stateCategory'
        ? CATEGORY_ORDER
        : field === 'priority'
          ? PRIORITY_ORDER
          : null;
  if (order) return order.indexOf(left.value) - order.indexOf(right.value);
  return left.label.localeCompare(right.label, 'ko') || left.value.localeCompare(right.value);
}

function GroupIcon({
  field,
  imageFileId,
  label,
  value,
}: {
  field: string;
  imageFileId: string | null;
  label: string;
  value: string;
}) {
  if (field === 'projectId') {
    return <ProjectLogo logoFileId={imageFileId} name={label} size="xs" />;
  }
  if (
    (field === 'assigneeMembershipId' && value !== UNASSIGNED_GROUP_VALUE) ||
    field === 'createdByMembershipId'
  ) {
    return (
      <UserAvatar avatarFileId={imageFileId} className="size-5" displayName={label} size="sm" />
    );
  }
  if (field === 'status' && value in ISSUE_STATUS_PRESENTATION) {
    const presentation = ISSUE_STATUS_PRESENTATION[value as keyof typeof ISSUE_STATUS_PRESENTATION];
    const Icon = presentation.icon;
    return <Icon aria-hidden="true" className={cn('size-4', presentation.iconClassName)} />;
  }
  if (field === 'priority' && value in PRIORITY_PRESENTATION) {
    const presentation = PRIORITY_PRESENTATION[value as keyof typeof PRIORITY_PRESENTATION];
    const Icon = presentation.icon;
    return <Icon aria-hidden="true" className={cn('size-4', presentation.iconClassName)} />;
  }
  if (
    field === 'stateCategory' &&
    ['BACKLOG', 'CANCELED', 'COMPLETED', 'STARTED', 'UNSTARTED'].includes(value)
  ) {
    return <WorkflowStateIcon category={value as WorkflowStateCategory} />;
  }

  const Icon: LucideIcon =
    field === 'assigneeMembershipId' ? UserRound : field === 'teamId' ? UsersRound : CircleDot;
  return <Icon aria-hidden="true" className="text-muted-foreground size-4" />;
}

function issueParamsForGroup(
  baseParams: IssuesControllerListParams,
  field: string,
  value: string,
): IssuesControllerListParams {
  const params: Record<string, unknown> = { ...baseParams };
  if (field === 'assigneeMembershipId') {
    delete params.assigneeMembershipId;
    delete params.unassigned;
    if (value === UNASSIGNED_GROUP_VALUE) params.unassigned = 'true';
    else params.assigneeMembershipId = value;
  } else {
    params[field] = value;
  }
  return params as IssuesControllerListParams;
}

function IssueGroupLeaf({
  baseParams,
  density,
  field,
  level,
  savedViewId,
  value,
  visibleFields,
}: {
  baseParams: IssuesControllerListParams;
  density: 'comfortable' | 'compact';
  field: string;
  level: 1 | 2;
  savedViewId: string | null;
  value: string;
  visibleFields: readonly string[];
}) {
  const params = issueParamsForGroup(baseParams, field, value);
  const issues = useIssuePages(params);
  const queryKey = getIssuePagesQueryKey(params);
  const items = issues.data?.pages.flatMap((page) => page.items) ?? [];

  if (issues.isPending) return <ContentLoading label="그룹의 이슈를 불러오는 중입니다" />;
  if (issues.isError && !issues.data) {
    return (
      <ContentError
        title="그룹의 이슈를 불러오지 못했습니다"
        description="입력한 보기 설정은 유지했습니다."
        retryLabel="다시 시도"
        onRetry={() => void issues.refetch()}
      />
    );
  }
  return (
    <>
      <ul
        className={cn(
          'border-border/70 bg-background/45 overflow-hidden border-l',
          level === 1 ? 'ml-6' : 'ml-8',
        )}
      >
        {items.map((issue) => (
          <IssueListRow
            key={issue.id}
            density={density}
            detailHref={issueWorkHref(issue.identifier, undefined, savedViewId)}
            issue={issue}
            queryKey={queryKey}
            visibleFields={visibleFields}
          />
        ))}
      </ul>
      {issues.hasNextPage ? (
        <div className="flex justify-center py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={issues.isFetchingNextPage}
            onClick={() => void issues.fetchNextPage()}
          >
            {issues.isFetchingNextPage ? '불러오는 중…' : '이 그룹 더 보기'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function MyWorkGroupLeaf({
  baseParams,
  density,
  field,
  level,
  savedViewId,
  value,
  visibleFields,
}: {
  baseParams: TeamWorksControllerListParams;
  density: 'comfortable' | 'compact';
  field: string;
  level: 1 | 2;
  savedViewId: string | null;
  value: string;
  visibleFields: readonly string[];
}) {
  const params = { ...baseParams, [field]: value };
  const works = useTeamWorkPages(params);
  const items = works.data?.pages.flatMap((page) => page.items) ?? [];

  if (works.isPending) return <ContentLoading label="그룹의 작업을 불러오는 중입니다" />;
  if (works.isError && !works.data) {
    return (
      <ContentError
        title="그룹의 작업을 불러오지 못했습니다"
        description="입력한 보기 설정은 유지했습니다."
        retryLabel="다시 시도"
        onRetry={() => void works.refetch()}
      />
    );
  }
  return (
    <>
      <ul
        className={cn(
          'border-border/70 bg-background/45 overflow-hidden border-l',
          level === 1 ? 'ml-6' : 'ml-8',
        )}
      >
        {items.map((work) => (
          <MyWorkListRow
            key={work.id}
            density={density}
            savedViewId={savedViewId}
            visibleFields={visibleFields}
            work={work}
          />
        ))}
      </ul>
      {works.hasNextPage ? (
        <div className="flex justify-center py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={works.isFetchingNextPage}
            onClick={() => void works.fetchNextPage()}
          >
            {works.isFetchingNextPage ? '불러오는 중…' : '이 그룹 더 보기'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function GroupHeader({
  count,
  expanded,
  field,
  imageFileId,
  label,
  level,
  onToggle,
  value,
}: {
  count: number;
  expanded: boolean;
  field: string;
  imageFileId: string | null;
  label: string;
  level: 1 | 2;
  onToggle: () => void;
  value: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-group-field={field}
      data-group-image-file-id={imageFileId ?? undefined}
      className={cn(
        'focus-visible:ring-ring flex w-full items-center gap-2.5 text-left transition-colors outline-none focus-visible:ring-2',
        level === 1
          ? 'border-border/60 bg-muted/55 hover:bg-muted/75 min-h-11 rounded-md border px-3 font-medium'
          : 'hover:bg-muted/35 min-h-10 rounded-sm px-2 text-sm',
      )}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown className="text-muted-foreground size-4" />
      ) : (
        <ChevronRight className="text-muted-foreground size-4" />
      )}
      <span
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-md',
          level === 1 && 'bg-background/70 shadow-xs',
        )}
      >
        <GroupIcon field={field} imageFileId={imageFileId} label={label} value={value} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {count.toLocaleString('ko-KR')}
      </span>
      {level === 2 ? (
        <span aria-hidden="true" className="border-border/70 ml-1 flex-1 border-t" />
      ) : null}
    </button>
  );
}

function IssueSubGroup({
  baseParams,
  density,
  field,
  group,
  savedViewId,
  visibleFields,
}: {
  baseParams: IssuesControllerListParams;
  density: 'comfortable' | 'compact';
  field: string;
  group: ListSubGroupResponseDto;
  savedViewId: string | null;
  visibleFields: readonly string[];
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <GroupHeader
        count={group.count}
        expanded={expanded}
        field={field}
        imageFileId={group.imageFileId}
        label={groupLabel(field, group.label)}
        level={2}
        onToggle={() => setExpanded((current) => !current)}
        value={group.value}
      />
      {expanded ? (
        <IssueGroupLeaf
          baseParams={baseParams}
          density={density}
          field={field}
          level={2}
          savedViewId={savedViewId}
          value={group.value}
          visibleFields={visibleFields}
        />
      ) : null}
    </div>
  );
}

function MyWorkSubGroup({
  baseParams,
  density,
  field,
  group,
  savedViewId,
  visibleFields,
}: {
  baseParams: TeamWorksControllerListParams;
  density: 'comfortable' | 'compact';
  field: string;
  group: ListSubGroupResponseDto;
  savedViewId: string | null;
  visibleFields: readonly string[];
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <GroupHeader
        count={group.count}
        expanded={expanded}
        field={field}
        imageFileId={group.imageFileId}
        label={groupLabel(field, group.label)}
        level={2}
        onToggle={() => setExpanded((current) => !current)}
        value={group.value}
      />
      {expanded ? (
        <MyWorkGroupLeaf
          baseParams={baseParams}
          density={density}
          field={field}
          level={2}
          savedViewId={savedViewId}
          value={group.value}
          visibleFields={visibleFields}
        />
      ) : null}
    </div>
  );
}

function IssueMainGroup({
  baseParams,
  density,
  group,
  groupBy,
  savedViewId,
  subGroupBy,
  visibleFields,
}: {
  baseParams: IssuesControllerListParams;
  density: 'comfortable' | 'compact';
  group: ListGroupResponseDto;
  groupBy: string;
  savedViewId: string | null;
  subGroupBy: string | null;
  visibleFields: readonly string[];
}) {
  const [expanded, setExpanded] = useState(true);
  const groupedParams = issueParamsForGroup(baseParams, groupBy, group.value);
  return (
    <section className="space-y-1.5">
      <GroupHeader
        count={group.count}
        expanded={expanded}
        field={groupBy}
        imageFileId={group.imageFileId}
        label={groupLabel(groupBy, group.label)}
        level={1}
        onToggle={() => setExpanded((current) => !current)}
        value={group.value}
      />
      {expanded ? (
        subGroupBy ? (
          <div className="space-y-1 pl-5">
            {[...group.subGroups]
              .sort((left, right) => compareGroups(subGroupBy, left, right))
              .map((subGroup) => (
                <IssueSubGroup
                  key={subGroup.value}
                  baseParams={groupedParams}
                  density={density}
                  field={subGroupBy}
                  group={subGroup}
                  savedViewId={savedViewId}
                  visibleFields={visibleFields}
                />
              ))}
          </div>
        ) : (
          <IssueGroupLeaf
            baseParams={baseParams}
            density={density}
            field={groupBy}
            level={1}
            savedViewId={savedViewId}
            value={group.value}
            visibleFields={visibleFields}
          />
        )
      ) : null}
    </section>
  );
}

function MyWorkMainGroup({
  baseParams,
  density,
  group,
  groupBy,
  savedViewId,
  subGroupBy,
  visibleFields,
}: {
  baseParams: TeamWorksControllerListParams;
  density: 'comfortable' | 'compact';
  group: ListGroupResponseDto;
  groupBy: string;
  savedViewId: string | null;
  subGroupBy: string | null;
  visibleFields: readonly string[];
}) {
  const [expanded, setExpanded] = useState(true);
  const groupedParams = { ...baseParams, [groupBy]: group.value };
  return (
    <section className="space-y-1.5">
      <GroupHeader
        count={group.count}
        expanded={expanded}
        field={groupBy}
        imageFileId={group.imageFileId}
        label={groupLabel(groupBy, group.label)}
        level={1}
        onToggle={() => setExpanded((current) => !current)}
        value={group.value}
      />
      {expanded ? (
        subGroupBy ? (
          <div className="space-y-1 pl-5">
            {[...group.subGroups]
              .sort((left, right) => compareGroups(subGroupBy, left, right))
              .map((subGroup) => (
                <MyWorkSubGroup
                  key={subGroup.value}
                  baseParams={groupedParams}
                  density={density}
                  field={subGroupBy}
                  group={subGroup}
                  savedViewId={savedViewId}
                  visibleFields={visibleFields}
                />
              ))}
          </div>
        ) : (
          <MyWorkGroupLeaf
            baseParams={baseParams}
            density={density}
            field={groupBy}
            level={1}
            savedViewId={savedViewId}
            value={group.value}
            visibleFields={visibleFields}
          />
        )
      ) : null}
    </section>
  );
}

export function GroupedIssueList({
  baseParams,
  density,
  groupBy,
  savedViewId,
  subGroupBy,
  visibleFields,
}: {
  baseParams: IssuesControllerListParams;
  density: 'comfortable' | 'compact';
  groupBy: IssuesControllerGroupsParams['groupBy'];
  savedViewId: string | null;
  subGroupBy?: IssuesControllerGroupsParams['subGroupBy'];
  visibleFields: readonly string[];
}) {
  const groupParams = { ...baseParams };
  delete groupParams.cursor;
  delete groupParams.limit;
  delete groupParams.sort;
  delete groupParams.sortDirection;
  delete groupParams.sorts;
  const summary = useIssuesControllerGroups({
    ...groupParams,
    groupBy,
    ...(subGroupBy ? { subGroupBy } : {}),
  });
  if (summary.isPending) return <ContentLoading label="이슈 그룹을 불러오는 중입니다" />;
  if (summary.isError || !summary.data) {
    return (
      <ContentError
        title="이슈 그룹을 불러오지 못했습니다"
        description="입력한 보기 설정은 유지했습니다."
        retryLabel="다시 시도"
        onRetry={() => void summary.refetch()}
      />
    );
  }
  if (summary.data.groups.length === 0) {
    return (
      <ContentEmpty
        align="center"
        icon={CircleDot}
        title="조건에 맞는 이슈가 없습니다"
        description="필터나 그룹 설정을 바꿔 보세요."
      />
    );
  }
  return (
    <div aria-label="그룹화된 이슈" className="space-y-3 py-2">
      {[...summary.data.groups]
        .sort((left, right) => compareGroups(summary.data.groupBy, left, right))
        .map((group) => (
          <IssueMainGroup
            key={group.value}
            baseParams={baseParams}
            density={density}
            group={group}
            groupBy={summary.data.groupBy}
            savedViewId={savedViewId}
            subGroupBy={summary.data.subGroupBy}
            visibleFields={visibleFields}
          />
        ))}
    </div>
  );
}

export function GroupedMyWorkList({
  baseParams,
  density,
  groupBy,
  savedViewId,
  subGroupBy,
  visibleFields,
}: {
  baseParams: TeamWorksControllerListParams;
  density: 'comfortable' | 'compact';
  groupBy: TeamWorksControllerGroupsParams['groupBy'];
  savedViewId: string | null;
  subGroupBy?: TeamWorksControllerGroupsParams['subGroupBy'];
  visibleFields: readonly string[];
}) {
  const groupParams = { ...baseParams };
  delete groupParams.cursor;
  delete groupParams.limit;
  delete groupParams.sort;
  delete groupParams.sortDirection;
  const summary = useTeamWorksControllerGroups({
    ...groupParams,
    groupBy,
    ...(subGroupBy ? { subGroupBy } : {}),
  });
  if (summary.isPending) return <ContentLoading label="작업 그룹을 불러오는 중입니다" />;
  if (summary.isError || !summary.data) {
    return (
      <ContentError
        title="작업 그룹을 불러오지 못했습니다"
        description="입력한 보기 설정은 유지했습니다."
        retryLabel="다시 시도"
        onRetry={() => void summary.refetch()}
      />
    );
  }
  if (summary.data.groups.length === 0) {
    return (
      <ContentEmpty
        align="center"
        icon={ListTodo}
        title="조건에 맞는 작업이 없습니다"
        description="필터나 그룹 설정을 바꿔 보세요."
      />
    );
  }
  return (
    <div aria-label="그룹화된 내 작업" className="space-y-3 py-2">
      {[...summary.data.groups]
        .sort((left, right) => compareGroups(summary.data.groupBy, left, right))
        .map((group) => (
          <MyWorkMainGroup
            key={group.value}
            baseParams={baseParams}
            density={density}
            group={group}
            groupBy={summary.data.groupBy}
            savedViewId={savedViewId}
            subGroupBy={summary.data.subGroupBy}
            visibleFields={visibleFields}
          />
        ))}
    </div>
  );
}
