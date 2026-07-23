'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  GitBranch,
  RefreshCw,
  Rocket,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  ApiError,
  getDeploymentsControllerListQueryKey,
  getIssuesControllerGetQueryKey,
  type TeamWorkSummaryResponseDto,
  useAuthControllerGetSession,
  useDeploymentsControllerCompleteProjectDeployments,
  useDeploymentsControllerList,
  useDeploymentsControllerUpdateTeamWork,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { ProjectLogo } from '@/components/project-logo';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  type DeploymentProjectGroup,
  deploymentProjectGroups,
  type DeploymentScope,
  type DeploymentView,
  projectCompletableWorks,
} from './deployment-groups';
import {
  deploymentCondition,
  deploymentProgress,
  deploymentReadiness,
} from './deployment-presentation';

function formatDeploymentDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function TeamWorkDeploymentRow({
  allWorks,
  busy,
  onMarkDeployed,
  work,
}: {
  allWorks: TeamWorkSummaryResponseDto[];
  busy: boolean;
  onMarkDeployed: (work: TeamWorkSummaryResponseDto) => void;
  work: TeamWorkSummaryResponseDto;
}) {
  const t = useTranslations('Deployments');
  const condition = deploymentCondition(work, allWorks);
  const readiness = deploymentReadiness(work, allWorks);
  const isReady = readiness.kind === 'READY';
  const conditionText =
    condition.kind === 'INDEPENDENT'
      ? t('condition.independent')
      : condition.kind === 'TOGETHER'
        ? t('condition.together')
        : t('condition.afterTeam', {
            team: condition.predecessorTeamNames.join(', '),
          });
  const readinessText =
    readiness.kind === 'DEPLOYED'
      ? work.deployedAt
        ? t('deployedAt', { date: formatDeploymentDate(work.deployedAt) })
        : t('view.DEPLOYED')
      : readiness.kind === 'WAITING_FOR_WORK'
        ? t('readiness.waitingForWork', { state: readiness.workflowStateName })
        : readiness.kind === 'WAITING_FOR_PREDECESSOR'
          ? t('readiness.waitingForPredecessor', {
              teams: readiness.predecessorTeamNames.join(', '),
            })
          : readiness.kind === 'WAITING_FOR_TOGETHER'
            ? t('readiness.waitingForTogether', readiness)
            : t(
                work.deploymentStatus === 'REDEPLOY_REQUIRED'
                  ? 'readiness.redeployReady'
                  : 'readiness.ready',
              );
  const ReadinessIcon =
    readiness.kind === 'DEPLOYED'
      ? CircleCheck
      : work.deploymentStatus === 'REDEPLOY_REQUIRED'
        ? RefreshCw
        : isReady
          ? Rocket
          : Clock3;

  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(9rem,0.75fr)_minmax(15rem,1.25fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{work.projectTeam.team.key}</Badge>
          <span className="truncate text-sm font-medium">{work.projectTeam.team.name}</span>
        </div>
        <span className="text-muted-foreground mt-1 block font-mono text-xs">
          {work.identifier}
        </span>
      </div>

      <div className="min-w-0 space-y-1.5 text-xs">
        <p className="flex items-center gap-2">
          {condition.kind === 'TOGETHER' ? (
            <Users aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <GitBranch aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
          )}
          <span className="text-muted-foreground">{t('field.condition')}</span>
          <span>{conditionText}</span>
        </p>
        <p className="flex items-center gap-2">
          <ReadinessIcon
            aria-hidden="true"
            className={cn('size-3.5 shrink-0', isReady ? 'text-primary' : 'text-muted-foreground')}
          />
          <span className="text-muted-foreground">{t('field.status')}</span>
          <span>{readinessText}</span>
        </p>
        {work.deployedBy ? (
          <p className="text-muted-foreground pl-[5.5rem]">
            {t('deployedBy', { member: work.deployedBy.user.displayName })}
          </p>
        ) : null}
      </div>

      {readiness.kind !== 'DEPLOYED' ? (
        <Button
          type="button"
          size="sm"
          variant={work.deploymentStatus === 'REDEPLOY_REQUIRED' ? 'outline' : 'default'}
          disabled={!isReady || busy}
          onClick={() => onMarkDeployed(work)}
        >
          {work.deploymentStatus === 'REDEPLOY_REQUIRED' ? (
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
          ) : (
            <Rocket aria-hidden="true" data-icon="inline-start" />
          )}
          {t(work.deploymentStatus === 'REDEPLOY_REQUIRED' ? 'markRedeployed' : 'markDeployed')}
        </Button>
      ) : null}
    </li>
  );
}

function ProjectDeploymentGroup({
  bulkBusy,
  group,
  itemBusy,
  onCompleteProject,
  onMarkDeployed,
  view,
}: {
  bulkBusy: boolean;
  group: DeploymentProjectGroup;
  itemBusy: boolean;
  onCompleteProject: (project: DeploymentProjectGroup, works: TeamWorkSummaryResponseDto[]) => void;
  onMarkDeployed: (work: TeamWorkSummaryResponseDto) => void;
  view: DeploymentView;
}) {
  const t = useTranslations('Deployments');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const progress = deploymentProgress(group.scopeWorks);
  const readyWorks = projectCompletableWorks(group);

  return (
    <li className="bg-card overflow-hidden rounded-xl border">
      <header className="bg-muted/30 flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ProjectLogo logoFileId={group.project.logoFileId} name={group.project.name} size="sm" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{group.project.name}</h2>
            <p className="text-muted-foreground text-xs tabular-nums">
              {t('project.issueCount', { count: group.issues.length })} ·{' '}
              {t('summary.progress', progress)}
            </p>
          </div>
        </div>
        {view === 'PENDING' && readyWorks.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
            <Rocket aria-hidden="true" data-icon="inline-start" />
            {t('project.completeReady', { count: readyWorks.length })}
          </Button>
        ) : progress.completed === progress.total ? (
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <CircleCheck aria-hidden="true" className="size-3.5" />
            {t('project.complete')}
          </span>
        ) : null}
      </header>

      <ul>
        {group.issues.map((issueGroup) => (
          <li key={issueGroup.issue.id} className="border-t first:border-t-0">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
              <Link
                href={`/issues/${issueGroup.issue.id}`}
                className="min-w-0 truncate text-sm font-medium hover:underline"
              >
                <span className="text-muted-foreground font-mono text-xs">
                  {issueGroup.issue.identifier}
                </span>{' '}
                · {issueGroup.issue.title}
              </Link>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {t('summary.progress', deploymentProgress(issueGroup.allWorks))}
              </span>
            </div>
            <ul className="divide-y">
              {issueGroup.visibleWorks.map((work) => (
                <TeamWorkDeploymentRow
                  key={work.id}
                  allWorks={issueGroup.allWorks}
                  busy={itemBusy || bulkBusy}
                  onMarkDeployed={onMarkDeployed}
                  work={work}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('project.confirmTitle', { project: group.project.name })}</DialogTitle>
            <DialogDescription>
              {t('project.confirmDescription', { count: readyWorks.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('project.cancel')}
            </Button>
            <Button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                onCompleteProject(group, readyWorks);
                setConfirmOpen(false);
              }}
            >
              <Rocket aria-hidden="true" data-icon="inline-start" />
              {t('project.confirmAction', { count: readyWorks.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function DeploymentScreen() {
  const t = useTranslations('Deployments');
  const queryClient = useQueryClient();
  const [view, setView] = useState<DeploymentView>('PENDING');
  const [scope, setScope] = useState<DeploymentScope>('MY_TEAMS');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const session = useAuthControllerGetSession({ query: { retry: false } });
  const query = useDeploymentsControllerList(
    {
      limit: 200,
      scope: 'ALL',
      status: ['PENDING', 'REDEPLOY_REQUIRED', 'DEPLOYED'],
    },
    { query: { retry: false } },
  );
  const update = useDeploymentsControllerUpdateTeamWork();
  const completeProject = useDeploymentsControllerCompleteProjectDeployments();
  const memberTeamIds = session.data?.authenticated ? (session.data.membership?.teamIds ?? []) : [];
  const groups = deploymentProjectGroups(query.data?.items ?? [], memberTeamIds, scope, view);
  const visibleCount = groups.reduce(
    (count, group) =>
      count + group.issues.reduce((issueCount, issue) => issueCount + issue.visibleWorks.length, 0),
    0,
  );
  const issueCount = groups.reduce((count, group) => count + group.issues.length, 0);

  function mutationError(error: unknown): string {
    if (error instanceof ApiError && error.body && typeof error.body === 'object') {
      const message = (error.body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return t('actionErrorDescription');
  }

  async function refreshDeployments(issueIds: string[]) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getDeploymentsControllerListQueryKey() }),
      ...issueIds.map((issueId) =>
        queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issueId) }),
      ),
    ]);
  }

  function markDeployed(work: TeamWorkSummaryResponseDto) {
    setErrorMessage(null);
    update.mutate(
      { data: { action: 'MARK_DEPLOYED', version: work.version }, teamWorkId: work.id },
      {
        onError: (error) => setErrorMessage(mutationError(error)),
        onSuccess: () => void refreshDeployments([work.issue.id]),
      },
    );
  }

  function completeReadyProjectDeployments(
    group: DeploymentProjectGroup,
    works: TeamWorkSummaryResponseDto[],
  ) {
    setErrorMessage(null);
    completeProject.mutate(
      {
        data: { teamWorks: works.map(({ id, version }) => ({ id, version })) },
        projectId: group.project.id,
      },
      {
        onError: (error) => setErrorMessage(mutationError(error)),
        onSuccess: () => void refreshDeployments(group.issues.map(({ issue }) => issue.id)),
      },
    );
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeading title={t('title')} description={t('description')} />

      <div className="mt-5 flex flex-col gap-3 border-b sm:flex-row sm:items-end sm:justify-between">
        <div className="flex" role="tablist" aria-label={t('viewLabel')}>
          {(['PENDING', 'DEPLOYED'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              className={cn(
                'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                view === item
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
              onClick={() => {
                setErrorMessage(null);
                setView(item);
              }}
            >
              {t(`view.${item}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pb-2">
          <div
            className="bg-muted flex rounded-md p-0.5"
            role="group"
            aria-label={t('scope.label')}
          >
            {(['MY_TEAMS', 'ALL'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={scope === item}
                className={cn(
                  'focus-visible:ring-ring h-8 rounded-sm px-3 text-xs font-medium outline-none focus-visible:ring-2',
                  scope === item
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => {
                  setErrorMessage(null);
                  setScope(item);
                }}
              >
                {t(`scope.${item}`)}
              </button>
            ))}
          </div>
          {query.data ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t('projectSummaryCount', {
                deployments: visibleCount,
                issues: issueCount,
                projects: groups.length,
              })}
            </span>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <Alert variant="destructive" className="mt-4">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t('actionErrorTitle')}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {query.isPending || session.isPending ? <ContentLoading label={t('loading')} /> : null}
      {query.isError || session.isError ? (
        <div className="py-6">
          <ContentError
            title={t('errorTitle')}
            description={t('errorDescription')}
            retryLabel={t('retry')}
            onRetry={() => {
              void query.refetch();
              void session.refetch();
            }}
          />
        </div>
      ) : null}
      {query.data && session.data && groups.length === 0 ? (
        <ContentEmpty
          icon={view === 'PENDING' ? Rocket : Check}
          title={t(`empty.${scope}.${view}.title`)}
          description={t(`empty.${scope}.${view}.description`)}
        />
      ) : null}
      {query.data && session.data && groups.length > 0 ? (
        <ul className="mt-4 space-y-4">
          {groups.map((group) => (
            <ProjectDeploymentGroup
              key={group.project.id}
              bulkBusy={completeProject.isPending}
              group={group}
              itemBusy={update.isPending}
              onCompleteProject={completeReadyProjectDeployments}
              onMarkDeployed={markDeployed}
              view={view}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
