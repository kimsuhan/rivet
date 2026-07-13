'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import {
  ApiError,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  getMembersControllerListQueryKey,
  getProjectsControllerGetQueryKey,
  type IssueListResponseDto,
  issuesControllerList,
  type MemberListResponseDto,
  membersControllerList,
  type MemberSummaryResponseDto,
  useIssuesControllerAssignTeamTasks,
  useIssuesControllerClaim,
  useIssuesControllerStart,
  useProjectsControllerGet,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';

import type { FeatureProjectRole } from './feature-issue-list-state';
import type { FeatureIssueAction } from './feature-issue-next-action';
import type { FeatureIssueListItem } from './feature-issue-row';
import { useIssueInlineMutation } from './issue-mutations';

type DialogAction = Exclude<FeatureIssueAction, 'OPEN_MY_WORK' | 'VIEW_DETAIL'>;

function isClosedTask(task: { status: { category: string } }): boolean {
  return task.status.category === 'COMPLETED' || task.status.category === 'CANCELED';
}

export async function listAllFeatureTeamTasks(
  issueId: string,
  signal: AbortSignal,
): Promise<IssueListResponseDto> {
  const items = new Map<string, IssueListResponseDto['items'][number]>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let totalCount: number | undefined;

  do {
    const page = await issuesControllerList(
      {
        ...(cursor ? { cursor } : {}),
        limit: 100,
        parentIssueId: issueId,
        type: 'TEAM_TASK',
      },
      { signal },
    );
    for (const task of page.items) items.set(task.id, task);
    totalCount ??= page.totalCount;
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error('ISSUE_CHILD_CURSOR_REPEATED');
      seenCursors.add(cursor);
    }
  } while (cursor);

  return { items: [...items.values()], nextCursor: null, totalCount: totalCount ?? 0 };
}

export async function listAllActiveTeamMembers(
  teamId: string,
  signal: AbortSignal,
): Promise<MemberListResponseDto> {
  const items = new Map<string, MemberSummaryResponseDto>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await membersControllerList(
      { ...(cursor ? { cursor } : {}), limit: 100, status: 'ACTIVE', teamId },
      { signal },
    );
    for (const member of page.items) items.set(member.id, member);
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error('MEMBER_CURSOR_REPEATED');
      seenCursors.add(cursor);
    }
  } while (cursor);

  return { items: [...items.values()], nextCursor: null };
}

export function FeatureIssueActions({
  action,
  issue,
  onClose,
}: {
  action: DialogAction;
  issue: FeatureIssueListItem;
  onClose: () => void;
}) {
  const t = useTranslations('FeatureIssues');
  const queryClient = useQueryClient();
  const errorRef = useRef<HTMLDivElement>(null);
  const projectId = issue.project?.id ?? '';
  const needsProject =
    action === 'START_WORK' || action === 'START_FROM_MY_TEAM' || action === 'ASSIGN_TEAM_TASKS';
  const needsMembers = action === 'START_WORK' || action === 'ASSIGN_TEAM_TASKS';
  const childrenParams = { limit: 100, parentIssueId: issue.id, type: 'TEAM_TASK' as const };
  const project = useProjectsControllerGet(projectId, {
    query: { enabled: needsProject && Boolean(projectId), retry: false },
  });
  const children = useQuery({
    queryFn: ({ signal }) => listAllFeatureTeamTasks(issue.id, signal),
    queryKey: [...getIssuesControllerListQueryKey(childrenParams), 'all-pages'],
    retry: false,
  });
  const start = useIssuesControllerStart();
  const claim = useIssuesControllerClaim();
  const assign = useIssuesControllerAssignTeamTasks();
  const complete = useIssueInlineMutation();
  const roleTeams = project.data?.roleTeams ?? [];
  const uniqueTeamIds = needsMembers ? [...new Set(roleTeams.map(({ team }) => team.id))] : [];
  const memberQueries = useQueries({
    queries: uniqueTeamIds.map((teamId) => {
      const params = { limit: 100, status: 'ACTIVE', teamId };
      return {
        queryFn: ({ signal }: { signal: AbortSignal }) => listAllActiveTeamMembers(teamId, signal),
        queryKey: [...getMembersControllerListQueryKey(params), 'all-pages'],
        retry: false,
      };
    }),
  });
  const [selectedRoles, setSelectedRoles] = useState<FeatureProjectRole[]>(() => {
    if (action === 'START_FROM_MY_TEAM') {
      const available = issue.workflowSummary.currentUserTeamRoles.filter(
        (role) => !issue.workflowSummary.activeRoles.includes(role),
      );
      return available.length === 1 ? available : [];
    }
    return [];
  });
  const [roleAssignees, setRoleAssignees] = useState<Record<string, { id: string; name: string }>>(
    {},
  );
  const [claimRole, setClaimRole] = useState<FeatureProjectRole | ''>(() => {
    const roles = issue.workflowSummary.currentUserTeamRoles;
    return action === 'CLAIM' && roles.length === 1 ? roles[0]! : '';
  });
  const [claimTargetId, setClaimTargetId] = useState('');
  const [assignments, setAssignments] = useState<Record<string, { id: string; name: string }>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const childItems = children.data?.items ?? [];
  const activeTasks = childItems.filter((task) => !isClosedTask(task));
  const unassignedTasks = activeTasks.filter((task) => !task.assignee);
  const completedTasks = childItems.filter((task) => task.status.category === 'COMPLETED');
  const canceledTasks = childItems.filter((task) => task.status.category === 'CANCELED');
  const targetTasks = childItems.filter((task) => task.status.category !== 'CANCELED');
  const completionIssue = complete.conflict?.latest ?? issue;
  const completionReady =
    targetTasks.length > 0 &&
    targetTasks.every((task) => task.status.category === 'COMPLETED') &&
    completionIssue.status.featureStatus !== 'DONE' &&
    completionIssue.status.featureStatus !== 'CANCELED' &&
    (!complete.conflict || Boolean(complete.conflict.latest));
  const availableMyTeamRoles = issue.workflowSummary.currentUserTeamRoles.filter(
    (role) => !issue.workflowSummary.activeRoles.includes(role),
  );
  const claimCandidates = claimRole
    ? unassignedTasks.filter((task) => task.projectRole === claimRole)
    : [];
  const assignmentTasks = activeTasks.filter(
    (task) => !task.assignee || Boolean(assignments[task.id]),
  );
  const projectLoading =
    needsProject && Boolean(projectId) && (project.isPending || Boolean(project.isFetching));
  const membersLoading =
    needsMembers && memberQueries.some((query) => query.isPending || Boolean(query.isFetching));
  const loading =
    children.isPending || Boolean(children.isFetching) || projectLoading || membersLoading;
  const optionsError =
    children.isError ||
    (needsProject && (!projectId || project.isError)) ||
    (needsMembers && memberQueries.some((query) => query.isError));
  const pending = start.isPending || claim.isPending || assign.isPending || complete.isPending;
  const mutationError = start.error ?? claim.error ?? assign.error ?? complete.error;
  const errorCode = mutationError instanceof ApiError ? mutationError.body.code : null;
  const errorMessage =
    localError ??
    (errorCode === 'ISSUE_COMPLETION_NOT_READY'
      ? t('actionsDialog.errors.completionNotReady')
      : mutationError
        ? t('actionsDialog.errors.default')
        : null);

  const teamByRole = new Map(roleTeams.map(({ role, team }) => [role as FeatureProjectRole, team]));

  function membersForRole(role: FeatureProjectRole): MemberSummaryResponseDto[] {
    const team = teamByRole.get(role);
    if (!team) return [];
    const index = uniqueTeamIds.indexOf(team.id);
    return memberQueries[index]?.data?.items ?? [];
  }

  function roleName(role: FeatureProjectRole): string {
    return t(`roles.${role}`);
  }

  async function invalidateAffectedQueries(): Promise<void> {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.identifier) }),
      ...(issue.project
        ? [
            queryClient.invalidateQueries({
              queryKey: getProjectsControllerGetQueryKey(issue.project.id),
            }),
          ]
        : []),
    ]);
  }

  function recoverFromError(): void {
    void children.refetch();
    if (needsProject && projectId) void project.refetch();
    if (needsMembers) {
      for (const query of memberQueries) void query.refetch();
    }
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  function startWork(): void {
    if (selectedRoles.length === 0) {
      setLocalError(t('actionsDialog.errors.roleRequired'));
      return;
    }
    const hasUnavailableSelection = selectedRoles.some((role) => {
      const assignment = roleAssignees[role];
      if (!assignment) return false;
      return !membersForRole(role).some((candidate) => candidate.id === assignment.id);
    });
    if (hasUnavailableSelection) {
      setLocalError(t('actionsDialog.errors.assignmentCandidateChanged'));
      return;
    }
    setLocalError(null);
    start.mutate(
      {
        data: {
          roleAssignments: selectedRoles.map((projectRole) => ({
            assigneeMembershipId: roleAssignees[projectRole]?.id ?? null,
            projectRole,
          })),
        },
        issueId: issue.id,
      },
      {
        onError: recoverFromError,
        onSuccess: async () => {
          await invalidateAffectedQueries();
          onClose();
        },
      },
    );
  }

  function startFromMyTeam(): void {
    if (selectedRoles.length === 0) {
      setLocalError(t('actionsDialog.errors.roleRequired'));
      return;
    }
    setLocalError(null);
    start.mutate(
      {
        data: {
          initialRoles: selectedRoles,
          requireCurrentUserTeamMembership: true,
        },
        issueId: issue.id,
      },
      {
        onError: recoverFromError,
        onSuccess: async () => {
          await invalidateAffectedQueries();
          onClose();
        },
      },
    );
  }

  function claimWork(): void {
    if (!claimRole) {
      setLocalError(t('actionsDialog.errors.roleRequired'));
      return;
    }
    if (claimCandidates.length > 1 && !claimTargetId) {
      setLocalError(t('actionsDialog.errors.claimTargetRequired'));
      return;
    }
    setLocalError(null);
    claim.mutate(
      {
        data: {
          projectRole: claimRole,
          ...(claimTargetId ? { teamTaskIssueId: claimTargetId } : {}),
        },
        issueId: issue.id,
      },
      {
        onError: recoverFromError,
        onSuccess: async () => {
          await invalidateAffectedQueries();
          onClose();
        },
      },
    );
  }

  function assignTeamTasks(): void {
    const hasUnavailableSelection = unassignedTasks.some((task) => {
      const assignment = assignments[task.id];
      if (!assignment) return false;
      return !membersForRole(task.projectRole as FeatureProjectRole).some(
        (candidate) => candidate.id === assignment.id,
      );
    });
    if (hasUnavailableSelection) {
      setLocalError(t('actionsDialog.errors.assignmentCandidateChanged'));
      return;
    }

    const selected = unassignedTasks.flatMap((task) => {
      const assignment = assignments[task.id];
      const role = task.projectRole as FeatureProjectRole;
      const remainsCandidate = membersForRole(role).some(
        (candidate) => candidate.id === assignment?.id,
      );
      return assignment && remainsCandidate
        ? [
            {
              assigneeMembershipId: assignment.id,
              teamTaskIssueId: task.id,
              version: task.version,
            },
          ]
        : [];
    });
    if (selected.length === 0) {
      setLocalError(t('actionsDialog.errors.assignmentRequired'));
      return;
    }
    setLocalError(null);
    assign.mutate(
      { data: { assignments: selected }, issueId: issue.id },
      {
        onError: recoverFromError,
        onSuccess: async () => {
          await invalidateAffectedQueries();
          onClose();
        },
      },
    );
  }

  function completeIssue(): void {
    if (!completionReady) {
      setLocalError(t('actionsDialog.errors.completionNotReady'));
      return;
    }
    setLocalError(null);
    complete.mutate(
      {
        change: {
          kind: 'featureStatus',
          requireCompletedTeamTasks: true,
          value: 'DONE',
        },
        issue: completionIssue,
      },
      {
        onError: recoverFromError,
        onSuccess: async () => {
          await invalidateAffectedQueries();
          onClose();
        },
      },
    );
  }

  const actionTitles: Record<DialogAction, string> = {
    ASSIGN_TEAM_TASKS: t('actionsDialog.assign.title'),
    CLAIM: t('actionsDialog.claim.title'),
    COMPLETE_ISSUE: t('actionsDialog.complete.title'),
    START_FROM_MY_TEAM: t('actionsDialog.teamStart.title'),
    START_WORK: t('actionsDialog.start.title'),
  };
  const actionDescriptions: Record<DialogAction, string> = {
    ASSIGN_TEAM_TASKS: t('actionsDialog.assign.description'),
    CLAIM: t('actionsDialog.claim.description'),
    COMPLETE_ISSUE: t('actionsDialog.complete.description'),
    START_FROM_MY_TEAM: t('actionsDialog.teamStart.description'),
    START_WORK: t('actionsDialog.start.description'),
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        closeLabel={t('actionsDialog.close')}
        closeButtonClassName="h-11 w-11 sm:h-10 sm:w-10"
        className="inset-0 h-dvh max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] rounded-none border-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border"
      >
        <DialogHeader>
          <DialogTitle>{actionTitles[action]}</DialogTitle>
          <DialogDescription>{actionDescriptions[action]}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-1">
          <p className="mb-4 text-sm font-medium">
            {issue.identifier} · {issue.title}
          </p>
          {loading ? (
            <div
              role="status"
              className="text-muted-foreground flex min-h-40 items-center justify-center gap-2 text-sm"
            >
              <Spinner aria-hidden="true" />
              {t('actionsDialog.loading')}
            </div>
          ) : optionsError ? (
            <Alert variant="destructive">
              <AlertTitle>{t('actionsDialog.optionsErrorTitle')}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('actionsDialog.optionsErrorDescription')}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 sm:h-10"
                  onClick={recoverFromError}
                >
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {errorMessage ? (
                <Alert ref={errorRef} tabIndex={-1} variant="destructive" className="mb-4">
                  <AlertTitle>
                    {errorCode === 'ISSUE_ASSIGNMENT_CONFLICT' ||
                    errorCode === 'ISSUE_VERSION_CONFLICT'
                      ? t('actionsDialog.conflictTitle')
                      : t('actionsDialog.errorTitle')}
                  </AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}

              {action === 'START_WORK' ? (
                <FieldSet data-invalid={Boolean(localError)}>
                  <FieldLegend>{t('actionsDialog.roles')}</FieldLegend>
                  <FieldDescription>{t('actionsDialog.start.roleDescription')}</FieldDescription>
                  <FieldGroup>
                    {roleTeams.map(({ role, team }) => {
                      const projectRole = role as FeatureProjectRole;
                      const checked = selectedRoles.includes(projectRole);
                      const selectedAssignee = roleAssignees[projectRole];
                      const selectionAvailable = membersForRole(projectRole).some(
                        (candidate) => candidate.id === selectedAssignee?.id,
                      );
                      const hasExisting = activeTasks.some(
                        (task) => task.projectRole === projectRole,
                      );
                      return (
                        <Field key={role} className="rounded-lg border p-3">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              id={`start-role-${role}`}
                              checked={checked}
                              onCheckedChange={(value) =>
                                setSelectedRoles((current) =>
                                  value
                                    ? [...new Set([...current, projectRole])]
                                    : current.filter((candidate) => candidate !== projectRole),
                                )
                              }
                            />
                            <FieldLabel htmlFor={`start-role-${role}`} className="flex-1">
                              {roleName(projectRole)} · {team.name}
                            </FieldLabel>
                            {hasExisting ? (
                              <Badge variant="outline">{t('actionsDialog.existingTask')}</Badge>
                            ) : null}
                          </div>
                          {checked ? (
                            <Select
                              items={[
                                { label: t('actionsDialog.unassigned'), value: 'unassigned' },
                                ...membersForRole(projectRole).map((member) => ({
                                  label: member.user.displayName,
                                  value: member.id,
                                })),
                              ]}
                              value={
                                selectionAvailable
                                  ? selectedAssignee!.id
                                  : selectedAssignee
                                    ? null
                                    : 'unassigned'
                              }
                              onValueChange={(value) => {
                                setRoleAssignees((current) => {
                                  const next = { ...current };
                                  if (!value || value === 'unassigned') {
                                    delete next[projectRole];
                                    return next;
                                  }
                                  const selected = membersForRole(projectRole).find(
                                    (candidate) => candidate.id === value,
                                  );
                                  if (selected) {
                                    next[projectRole] = {
                                      id: selected.id,
                                      name: selected.user.displayName,
                                    };
                                  }
                                  return next;
                                });
                              }}
                            >
                              <SelectTrigger
                                className="min-h-11 sm:min-h-10"
                                aria-label={t('actionsDialog.assigneeForRole', {
                                  role: roleName(projectRole),
                                })}
                              >
                                <SelectValue placeholder={t('actionsDialog.selectAssignee')} />
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectGroup>
                                  <SelectItem value="unassigned">
                                    {t('actionsDialog.unassigned')}
                                  </SelectItem>
                                  {membersForRole(projectRole).map((member) => (
                                    <SelectItem key={member.id} value={member.id}>
                                      {member.user.displayName}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          ) : null}
                          {checked && selectedAssignee && !selectionAvailable ? (
                            <FieldError>
                              {t('actionsDialog.assign.candidateUnavailable', {
                                name: selectedAssignee.name,
                              })}
                            </FieldError>
                          ) : null}
                        </Field>
                      );
                    })}
                  </FieldGroup>
                  <FieldError>{localError}</FieldError>
                </FieldSet>
              ) : null}

              {action === 'START_FROM_MY_TEAM' ? (
                <FieldSet data-invalid={Boolean(localError)}>
                  <FieldLegend>{t('actionsDialog.roles')}</FieldLegend>
                  <FieldDescription>
                    {t('actionsDialog.teamStart.roleDescription')}
                  </FieldDescription>
                  <FieldGroup>
                    {availableMyTeamRoles.map((role) => {
                      const team = teamByRole.get(role);
                      return (
                        <Field
                          key={role}
                          orientation="horizontal"
                          className="rounded-lg border p-3"
                        >
                          <Checkbox
                            id={`team-start-role-${role}`}
                            checked={selectedRoles.includes(role)}
                            onCheckedChange={(value) =>
                              setSelectedRoles((current) =>
                                value
                                  ? [...new Set([...current, role])]
                                  : current.filter((candidate) => candidate !== role),
                              )
                            }
                          />
                          <FieldLabel htmlFor={`team-start-role-${role}`}>
                            {roleName(role)}
                            {team ? ` · ${team.name}` : ''}
                          </FieldLabel>
                        </Field>
                      );
                    })}
                  </FieldGroup>
                  <FieldError>{localError}</FieldError>
                </FieldSet>
              ) : null}

              {action === 'CLAIM' ? (
                <FieldGroup>
                  <Field data-invalid={Boolean(localError && !claimRole)}>
                    <FieldLabel htmlFor="claim-role">{t('actionsDialog.roles')}</FieldLabel>
                    <Select
                      items={issue.workflowSummary.currentUserTeamRoles.map((role) => ({
                        label: roleName(role),
                        value: role,
                      }))}
                      value={claimRole || null}
                      onValueChange={(value) => {
                        setClaimRole((value ?? '') as FeatureProjectRole | '');
                        setClaimTargetId('');
                      }}
                    >
                      <SelectTrigger id="claim-role" className="min-h-11 sm:min-h-10">
                        <SelectValue placeholder={t('actionsDialog.selectRole')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {issue.workflowSummary.currentUserTeamRoles.map((role) => (
                            <SelectItem key={role} value={role}>
                              {roleName(role)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  {claimCandidates.length > 1 ? (
                    <Field data-invalid={Boolean(localError && !claimTargetId)}>
                      <FieldLabel htmlFor="claim-target">
                        {t('actionsDialog.claim.target')}
                      </FieldLabel>
                      <Select
                        items={claimCandidates.map((task) => ({
                          label: `${task.identifier} · ${task.title}`,
                          value: task.id,
                        }))}
                        value={claimTargetId || null}
                        onValueChange={(value) => setClaimTargetId(value ?? '')}
                      >
                        <SelectTrigger id="claim-target" className="min-h-11 sm:min-h-10">
                          <SelectValue placeholder={t('actionsDialog.claim.targetPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {claimCandidates.map((task) => (
                              <SelectItem key={task.id} value={task.id}>
                                {task.identifier} · {task.title}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : claimRole ? (
                    <p className="text-muted-foreground text-sm">
                      {claimCandidates.length === 1
                        ? t('actionsDialog.claim.reuse', {
                            identifier: claimCandidates[0]!.identifier,
                          })
                        : t('actionsDialog.claim.create')}
                    </p>
                  ) : null}
                  <FieldError>{localError}</FieldError>
                </FieldGroup>
              ) : null}

              {action === 'ASSIGN_TEAM_TASKS' ? (
                <FieldSet data-invalid={Boolean(localError)}>
                  <FieldLegend>{t('actionsDialog.assign.tasks')}</FieldLegend>
                  <FieldDescription>{t('actionsDialog.assign.taskDescription')}</FieldDescription>
                  <FieldGroup>
                    {assignmentTasks.map((task) => {
                      const role = task.projectRole as FeatureProjectRole;
                      const selectedAssignment = assignments[task.id];
                      const selectionAvailable = membersForRole(role).some(
                        (candidate) => candidate.id === selectedAssignment?.id,
                      );
                      return (
                        <Field key={task.id} className="rounded-lg border p-3">
                          <FieldLabel htmlFor={`assignment-${task.id}`}>
                            {task.identifier} · {roleName(role)}
                          </FieldLabel>
                          {task.assignee ? (
                            <FieldDescription>
                              {t('actionsDialog.assign.currentAssignee', {
                                name: task.assignee.user.displayName,
                              })}
                            </FieldDescription>
                          ) : null}
                          <Select
                            disabled={Boolean(task.assignee)}
                            items={membersForRole(role).map((member) => ({
                              label: member.user.displayName,
                              value: member.id,
                            }))}
                            value={selectionAvailable ? selectedAssignment!.id : null}
                            onValueChange={(value) => {
                              const selected = membersForRole(role).find(
                                (candidate) => candidate.id === value,
                              );
                              if (!selected) return;
                              setAssignments((current) => ({
                                ...current,
                                [task.id]: { id: selected.id, name: selected.user.displayName },
                              }));
                            }}
                          >
                            <SelectTrigger
                              id={`assignment-${task.id}`}
                              className="min-h-11 sm:min-h-10"
                              aria-label={t('actionsDialog.assign.assignee', {
                                identifier: task.identifier,
                              })}
                            >
                              <SelectValue placeholder={t('actionsDialog.selectAssignee')} />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {membersForRole(role).map((member) => (
                                  <SelectItem key={member.id} value={member.id}>
                                    {member.user.displayName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {task.assignee && selectedAssignment ? (
                            <FieldDescription>
                              {t('actionsDialog.assign.previousSelection', {
                                name: selectedAssignment.name,
                              })}
                            </FieldDescription>
                          ) : null}
                          {!task.assignee && selectedAssignment && !selectionAvailable ? (
                            <FieldError>
                              {t('actionsDialog.assign.candidateUnavailable', {
                                name: selectedAssignment.name,
                              })}
                            </FieldError>
                          ) : null}
                          <FieldDescription>
                            {t('actionsDialog.assign.candidateCount', {
                              count: membersForRole(role).length,
                            })}
                          </FieldDescription>
                        </Field>
                      );
                    })}
                  </FieldGroup>
                  <FieldError>{localError}</FieldError>
                </FieldSet>
              ) : null}

              {action === 'COMPLETE_ISSUE' ? (
                <div className="flex flex-col gap-4">
                  {!completionReady ? (
                    <Alert variant="destructive">
                      <AlertTitle>{t('actionsDialog.complete.notReadyTitle')}</AlertTitle>
                      <AlertDescription>
                        {t('actionsDialog.errors.completionNotReady')}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <section aria-labelledby="complete-roles-title">
                    <h3 id="complete-roles-title" className="text-sm font-medium">
                      {t('actionsDialog.complete.roles')}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {[
                        ...new Set(completedTasks.map((task) => task.projectRole).filter(Boolean)),
                      ].map((role) => (
                        <Badge key={role} variant="outline">
                          {roleName(role as FeatureProjectRole)}
                        </Badge>
                      ))}
                    </div>
                  </section>
                  <section aria-labelledby="complete-tasks-title">
                    <h3 id="complete-tasks-title" className="text-sm font-medium">
                      {t('actionsDialog.complete.tasks')}
                    </h3>
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {completedTasks.map((task) => (
                        <li key={task.id}>
                          {task.identifier} · {task.title}
                        </li>
                      ))}
                    </ul>
                  </section>
                  {canceledTasks.length > 0 ? (
                    <section aria-labelledby="canceled-tasks-title">
                      <h3 id="canceled-tasks-title" className="text-sm font-medium">
                        {t('actionsDialog.complete.canceled')}
                      </h3>
                      <ul className="text-muted-foreground mt-2 flex flex-col gap-1 text-sm">
                        {canceledTasks.map((task) => (
                          <li key={task.id}>
                            {task.identifier} · {task.title}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-10"
            disabled={pending}
            onClick={onClose}
          >
            {t('actionsDialog.cancel')}
          </Button>
          <Button
            type="button"
            className="h-11 sm:h-10"
            disabled={
              pending ||
              loading ||
              optionsError ||
              (action === 'COMPLETE_ISSUE' && !completionReady)
            }
            onClick={
              action === 'START_WORK'
                ? startWork
                : action === 'START_FROM_MY_TEAM'
                  ? startFromMyTeam
                  : action === 'CLAIM'
                    ? claimWork
                    : action === 'ASSIGN_TEAM_TASKS'
                      ? assignTeamTasks
                      : completeIssue
            }
          >
            {pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
            {t(`actionsDialog.submit.${action}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
