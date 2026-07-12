'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore } from 'react';

import {
  ApiError,
  getIssuesControllerListQueryKey,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  getTrashControllerListQueryKey,
  type IssueSummaryResponseDto,
  type ProjectResponseDto,
  useProjectsControllerArchive,
  useProjectsControllerGet,
  useProjectsControllerTrash,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Link, usePathname, useRouter } from '@/i18n/navigation';

import { useIssuePages } from '../issues/issue-list-queries';
import { PROJECT_ROLES } from './project-form';
import {
  type ProjectLabels,
  ProjectProgress,
  ProjectRoleBadges,
  ProjectStatusBadge,
} from './project-shared';

const STATE_CATEGORIES = ['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED'] as const;
const PROJECT_COLLAPSED_EVENT = 'rivet:project-collapsed-change';

function subscribeCollapsedFeatures(listener: () => void) {
  window.addEventListener(PROJECT_COLLAPSED_EVENT, listener);
  return () => window.removeEventListener(PROJECT_COLLAPSED_EVENT, listener);
}

function readCollapsedFeatures(projectId: string): string {
  return window.sessionStorage.getItem(`rivet.project.${projectId}.collapsed`) ?? '[]';
}

function parseCollapsedFeatures(value: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? new Set(parsed)
      : new Set();
  } catch {
    return new Set();
  }
}

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const t = useTranslations('Projects');
  const project = useProjectsControllerGet(projectId, { query: { retry: false } });
  const issues = useIssuePages({ limit: 100, projectId, sort: 'updatedAt', sortDirection: 'desc' });

  if (project.isPending || issues.isPending) return <ContentLoading label={t('loading')} />;
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) {
      return (
        <ContentEmpty
          icon={FileQuestion}
          headingLevel={1}
          title={t('notFound.title')}
          description={t('notFound.description')}
        >
          <Link href="/projects" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            {t('backToList')}
          </Link>
        </ContentEmpty>
      );
    }
    return (
      <ContentError
        headingLevel={1}
        title={t('error.title')}
        description={t('error.description')}
        retryLabel={t('retry')}
        onRetry={() => void project.refetch()}
      />
    );
  }
  if (issues.isError) {
    return (
      <ContentError
        headingLevel={1}
        title={t('issues.errorTitle')}
        description={t('issues.errorDescription')}
        retryLabel={t('retry')}
        onRetry={() => void issues.refetch()}
      />
    );
  }

  return (
    <ProjectDetailContent
      project={project.data}
      issues={[
        ...new Map(
          (issues.data?.pages.flatMap((page) => page.items) ?? []).map((issue) => [
            issue.id,
            issue,
          ]),
        ).values(),
      ]}
      isFetchingMore={issues.isFetchingNextPage}
      hasMore={Boolean(issues.hasNextPage)}
      hasMoreError={issues.isFetchNextPageError}
      onLoadMore={() => void issues.fetchNextPage()}
      onReload={() => void project.refetch()}
    />
  );
}

function ProjectDetailContent({
  issues,
  hasMore,
  hasMoreError,
  isFetchingMore,
  onLoadMore,
  onReload,
  project,
}: {
  hasMore: boolean;
  hasMoreError: boolean;
  isFetchingMore: boolean;
  issues: IssueSummaryResponseDto[];
  onLoadMore: () => void;
  onReload: () => void;
  project: ProjectResponseDto;
}) {
  const t = useTranslations('Projects');
  const format = useFormatter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const archive = useProjectsControllerArchive();
  const trash = useProjectsControllerTrash();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<'CONFLICT' | 'ERROR' | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashError, setTrashError] = useState<'CONFLICT' | 'ERROR' | 'NOT_EMPTY' | null>(null);
  const collapsed = parseCollapsedFeatures(
    useSyncExternalStore(
      subscribeCollapsedFeatures,
      () => readCollapsedFeatures(project.id),
      () => '[]',
    ),
  );
  const roleParam = searchParams.get('role');
  const categoryParam = searchParams.get('category');
  const role = PROJECT_ROLES.includes(roleParam as (typeof PROJECT_ROLES)[number])
    ? (roleParam as (typeof PROJECT_ROLES)[number])
    : null;
  const category = STATE_CATEGORIES.includes(categoryParam as (typeof STATE_CATEGORIES)[number])
    ? (categoryParam as (typeof STATE_CATEGORIES)[number])
    : null;
  const labels: ProjectLabels = {
    noWork: t('progress.none'),
    progress: t.raw('progress.summary') as string,
    roles: {
      APP_FRONTEND: t('role.APP_FRONTEND'),
      BACKEND: t('role.BACKEND'),
      WEB_FRONTEND: t('role.WEB_FRONTEND'),
    },
    statuses: {
      CANCELED: t('status.CANCELED'),
      COMPLETED: t('status.COMPLETED'),
      IN_PROGRESS: t('status.IN_PROGRESS'),
      PLANNED: t('status.PLANNED'),
    },
  };

  function setFilter(key: 'category' | 'role', value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  async function finishTrash(): Promise<void> {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getProjectsControllerListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getTrashControllerListQueryKey() }),
    ]);
    queryClient.removeQueries({ queryKey: getProjectsControllerGetQueryKey(project.id) });
    router.push('/projects');
  }

  function moveToTrash(): void {
    trash.mutate(
      { data: { version: project.version }, projectId: project.id },
      {
        onError: (error) => {
          const code = error.body.code;
          setTrashOpen(false);
          setTrashError(
            code === 'VERSION_CONFLICT'
              ? 'CONFLICT'
              : code === 'PROJECT_NOT_EMPTY'
                ? 'NOT_EMPTY'
                : 'ERROR',
          );
          if (code === 'VERSION_CONFLICT') onReload();
        },
        onSuccess: finishTrash,
      },
    );
  }

  function toggleFeature(issueId: string) {
    const next = new Set(collapsed);
    if (next.has(issueId)) next.delete(issueId);
    else next.add(issueId);
    window.sessionStorage.setItem(
      `rivet.project.${project.id}.collapsed`,
      JSON.stringify([...next]),
    );
    window.dispatchEvent(new Event(PROJECT_COLLAPSED_EVENT));
  }

  function matches(task: IssueSummaryResponseDto) {
    return (!role || task.projectRole === role) && (!category || task.status.category === category);
  }

  const featureIssues = issues.filter((issue) => issue.type === 'FEATURE');
  const teamTasks = issues.filter((issue) => issue.type === 'TEAM_TASK');
  const tasksByParent = new Map<string, IssueSummaryResponseDto[]>();
  for (const task of teamTasks) {
    const parentId = task.parentIssue?.id;
    if (!parentId) continue;
    const tasks = tasksByParent.get(parentId) ?? [];
    tasks.push(task);
    tasksByParent.set(parentId, tasks);
  }
  const visibleFeatures = featureIssues.filter((feature) => {
    const children = tasksByParent.get(feature.id) ?? [];
    return (!role && (!category || feature.status.category === category)) || children.some(matches);
  });
  const standaloneTasks = teamTasks.filter((task) => !task.parentIssue && matches(task));

  return (
    <article className="mx-auto w-full max-w-6xl">
      <header className="border-b pb-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl leading-8 font-semibold sm:text-2xl">
                {project.name}
              </h1>
              <ProjectStatusBadge labels={labels.statuses} status={project.status} />
              {project.archived ? <Badge variant="outline">{t('archived')}</Badge> : null}
            </div>
            {project.description ? (
              <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-6 whitespace-pre-wrap">
                {project.description}
              </p>
            ) : null}
          </div>
          <div className="hidden flex-wrap gap-2 lg:flex">
            {!project.archived ? (
              <>
                <Link
                  href={`/projects/${project.id}/edit`}
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                >
                  <Pencil aria-hidden="true" data-icon="inline-start" />
                  {t('edit.action')}
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={trash.isPending}
                  onClick={() => setArchiveOpen(true)}
                >
                  <Archive aria-hidden="true" data-icon="inline-start" />
                  {t('archive.action')}
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={archive.isPending || trash.isPending}
              onClick={() => {
                trash.reset();
                setTrashError(null);
                setTrashOpen(true);
              }}
            >
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              {t('trash.action')}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">{t('field.lead')}</dt>
              <dd className="mt-1">{project.lead?.user.displayName ?? t('field.noLead')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('field.startDate')}</dt>
              <dd className="mt-1 tabular-nums">
                {project.startDate ? formatDate(project.startDate, format) : t('field.noDate')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('field.targetDate')}</dt>
              <dd className="mt-1 tabular-nums">
                {project.targetDate ? formatDate(project.targetDate, format) : t('field.noDate')}
              </dd>
            </div>
          </dl>
          <ProjectProgress labels={labels} progress={project.progress} />
        </div>
        <div className="mt-4">
          <ProjectRoleBadges labels={labels.roles} roleTeams={project.roleTeams} />
        </div>
      </header>

      {project.archived ? (
        <Alert className="mt-5">
          <Archive aria-hidden="true" />
          <AlertTitle>{t('detail.readOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('detail.readOnlyDescription')}</AlertDescription>
        </Alert>
      ) : null}
      {archiveError ? (
        <Alert className="mt-5" variant="destructive">
          <AlertTitle>
            {archiveError === 'CONFLICT' ? t('conflict.title') : t('archive.errorTitle')}
          </AlertTitle>
          <AlertDescription>
            {archiveError === 'CONFLICT'
              ? t('archive.conflictDescription')
              : t('archive.errorDescription')}
          </AlertDescription>
        </Alert>
      ) : null}
      {trashError ? (
        <Alert className="mt-5" variant="destructive">
          <AlertTitle>
            {trashError === 'CONFLICT'
              ? t('trash.conflictTitle')
              : trashError === 'NOT_EMPTY'
                ? t('trash.notEmptyTitle')
                : t('trash.errorTitle')}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {trashError === 'CONFLICT'
                ? t('trash.conflictDescription')
                : trashError === 'NOT_EMPTY'
                  ? t('trash.notEmptyDescription')
                  : t('trash.errorDescription')}
            </span>
            {trashError === 'NOT_EMPTY' ? (
              <a
                href="#project-issues"
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
              >
                {t('trash.openIssues')}
              </a>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 hidden flex-wrap gap-2 lg:flex">
        {!project.archived ? (
          <>
            <Link
              href={`${pathname}?create=1&projectId=${project.id}`}
              className={buttonVariants({ size: 'sm' })}
            >
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('issues.createIssue')}
            </Link>
            <Select
              items={[{ label: t('issues.createStandalone'), value: 'STANDALONE' }]}
              value={null}
              onValueChange={(value) => {
                if (value === 'STANDALONE') {
                  router.push(`${pathname}?create=1&type=TEAM_TASK&projectId=${project.id}`);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={t('issues.moreActions')}>
                <MoreHorizontal aria-hidden="true" />
                <SelectValue placeholder={t('issues.moreActions')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value="STANDALONE">{t('issues.createStandalone')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>

      <div
        id="project-issues"
        className="mt-5 flex min-w-0 scroll-mt-4 flex-wrap items-center gap-2 border-y py-3"
      >
        <Select
          items={[
            { label: t('filter.allRoles'), value: 'ALL' },
            ...PROJECT_ROLES.map((value) => ({ label: labels.roles[value], value })),
          ]}
          value={role ?? 'ALL'}
          onValueChange={(value) => setFilter('role', value === 'ALL' ? null : value)}
        >
          <SelectTrigger size="sm" aria-label={t('filter.role')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ALL">{t('filter.allRoles')}</SelectItem>
              {PROJECT_ROLES.map((value) => (
                <SelectItem key={value} value={value}>
                  {labels.roles[value]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={[
            { label: t('filter.allCategories'), value: 'ALL' },
            ...STATE_CATEGORIES.map((value) => ({ label: t(`stateCategory.${value}`), value })),
          ]}
          value={category ?? 'ALL'}
          onValueChange={(value) => setFilter('category', value === 'ALL' ? null : value)}
        >
          <SelectTrigger size="sm" aria-label={t('filter.category')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ALL">{t('filter.allCategories')}</SelectItem>
              {STATE_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`stateCategory.${value}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {visibleFeatures.length === 0 && standaloneTasks.length === 0 ? (
        <ContentEmpty
          icon={FileQuestion}
          title={role || category ? t('issues.filteredEmptyTitle') : t('issues.emptyTitle')}
          description={
            role || category ? t('issues.filteredEmptyDescription') : t('issues.emptyDescription')
          }
        />
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {visibleFeatures.length > 0 ? (
            <section aria-labelledby="project-features-heading">
              <h2 id="project-features-heading" className="mb-3 text-base font-semibold">
                {t('issues.features')}
              </h2>
              <div className="flex flex-col gap-3">
                {visibleFeatures.map((feature) => {
                  const allChildren = tasksByParent.get(feature.id) ?? [];
                  const children = allChildren.filter(matches);
                  const currentTasks = allChildren.filter(
                    (task) =>
                      task.status.category !== 'COMPLETED' && task.status.category !== 'CANCELED',
                  );
                  const backendInProgress = currentTasks.some(
                    (task) => task.projectRole === 'BACKEND',
                  );
                  const hasFrontendTask = allChildren.some(
                    (task) =>
                      task.projectRole === 'WEB_FRONTEND' || task.projectRole === 'APP_FRONTEND',
                  );
                  const expectedRoles =
                    backendInProgress && !hasFrontendTask
                      ? project.roleTeams
                          .map(({ role }) => role)
                          .filter((projectRole) => projectRole !== 'BACKEND')
                      : [];
                  const visibleExpectedRoles = expectedRoles.filter(
                    (projectRole) => !role || projectRole === role,
                  );
                  const isCollapsed = collapsed.has(feature.id);
                  return (
                    <Card key={feature.id} size="sm">
                      <CardHeader>
                        <CardTitle className="flex min-w-0 items-center gap-2">
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={
                              isCollapsed
                                ? t('issues.expand', { title: feature.title })
                                : t('issues.collapse', { title: feature.title })
                            }
                            aria-expanded={!isCollapsed}
                            onClick={() => toggleFeature(feature.id)}
                          >
                            {isCollapsed ? (
                              <ChevronRight aria-hidden="true" />
                            ) : (
                              <ChevronDown aria-hidden="true" />
                            )}
                          </Button>
                          <Link
                            href={`/issues/${feature.identifier}`}
                            className="min-w-0 truncate focus-visible:underline"
                          >
                            <span className="text-muted-foreground mr-2 font-mono text-xs">
                              {feature.identifier}
                            </span>
                            {feature.title}
                          </Link>
                        </CardTitle>
                        <CardDescription className="flex flex-col gap-1">
                          <span>
                            {feature.status.featureStatus
                              ? t(`featureStatus.${feature.status.featureStatus}`)
                              : t(`stateCategory.${feature.status.category}`)}
                          </span>
                          {currentTasks.length > 0 ? (
                            <span>
                              {t('issues.currentStage', {
                                roles: [
                                  ...new Set(
                                    currentTasks
                                      .map((task) => task.projectRole)
                                      .filter((value) => value !== null),
                                  ),
                                ]
                                  .map((value) => labels.roles[value])
                                  .join(' · '),
                              })}
                            </span>
                          ) : null}
                        </CardDescription>
                        <CardAction>
                          {feature.progress && feature.progress.total > 0 ? (
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {t('progress.compact', {
                                completed: feature.progress.completed,
                                percentage: feature.progress.percentage,
                                total: feature.progress.total,
                              })}
                            </span>
                          ) : null}
                        </CardAction>
                      </CardHeader>
                      {!isCollapsed ? (
                        <CardContent className="flex flex-col gap-3">
                          {children.length > 0 ? (
                            <div className="flex flex-col gap-2">
                              {children.map((task) => (
                                <ProjectTaskRow key={task.id} task={task} labels={labels} />
                              ))}
                            </div>
                          ) : visibleExpectedRoles.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                              {t('issues.noChildren')}
                            </p>
                          ) : null}
                          {visibleExpectedRoles.length > 0 ? (
                            <div className="border-border ml-3 flex flex-col gap-2 border-l border-dashed pl-5">
                              {visibleExpectedRoles.map((projectRole) => (
                                <div
                                  key={projectRole}
                                  className="text-muted-foreground flex min-h-10 items-center justify-between gap-3 py-1 text-sm"
                                >
                                  <span>{labels.roles[projectRole]}</span>
                                  <Badge variant="outline">{t('issues.expectedStage')}</Badge>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </CardContent>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          {standaloneTasks.length > 0 ? (
            <section aria-labelledby="project-standalone-heading">
              <h2 id="project-standalone-heading" className="mb-3 text-base font-semibold">
                {t('issues.standalone')}
              </h2>
              <Card size="sm">
                <CardContent className="flex flex-col gap-2">
                  {standaloneTasks.map((task) => (
                    <ProjectTaskRow key={task.id} task={task} labels={labels} />
                  ))}
                </CardContent>
              </Card>
            </section>
          ) : null}
        </div>
      )}

      {hasMoreError ? (
        <Alert className="mt-4" variant="destructive">
          <AlertTitle>{t('pagination.errorTitle')}</AlertTitle>
          <AlertDescription>{t('pagination.errorDescription')}</AlertDescription>
        </Alert>
      ) : null}
      {hasMore ? (
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="outline" disabled={isFetchingMore} onClick={onLoadMore}>
            {isFetchingMore ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
            {isFetchingMore ? t('pagination.loading') : t('pagination.moreIssues')}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('archive.title', { name: project.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('archive.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={archive.isPending || trash.isPending}
              onClick={(event) => {
                event.preventDefault();
                archive.mutate(
                  { data: { version: project.version }, projectId: project.id },
                  {
                    onError: (error) => {
                      setArchiveOpen(false);
                      setArchiveError(
                        error.body.code === 'VERSION_CONFLICT' ? 'CONFLICT' : 'ERROR',
                      );
                      onReload();
                    },
                    onSuccess: () => {
                      setArchiveOpen(false);
                      setArchiveError(null);
                      onReload();
                    },
                  },
                );
              }}
            >
              {archive.isPending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {t('archive.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={trashOpen}
        onOpenChange={(open) => {
          if (!trash.isPending) setTrashOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trash.title', { name: project.name })}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2 text-left">
              <strong className="text-foreground font-medium">{project.name}</strong>
              <span>{t('trash.description')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trash.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={trash.isPending}
              onClick={moveToTrash}
            >
              {trash.isPending ? (
                <Spinner aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Trash2 aria-hidden="true" data-icon="inline-start" />
              )}
              {t('trash.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
          {trash.isPending ? (
            <span role="status" className="sr-only">
              {t('trash.moving')}
            </span>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function ProjectTaskRow({
  task,
  labels,
}: {
  task: IssueSummaryResponseDto;
  labels: ProjectLabels;
}) {
  const t = useTranslations('Projects');
  return (
    <article className="bg-surface-1 flex min-w-0 flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {task.projectRole ? (
            <Badge variant="outline">
              {labels.roles[task.projectRole]} · {task.team?.name}
            </Badge>
          ) : null}
          <Link
            href={`/issues/${task.identifier}`}
            className="min-w-0 truncate font-medium focus-visible:underline"
          >
            <span className="text-muted-foreground mr-2 font-mono text-xs">{task.identifier}</span>
            {task.title}
          </Link>
        </div>
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span>
            {task.status.workflowState?.name ?? t(`stateCategory.${task.status.category}`)}
          </span>
          {task.blocked ? <Badge variant="secondary">{t('issues.blocked')}</Badge> : null}
          <span>{task.assignee?.user.displayName ?? t('issues.unassigned')}</span>
          <span>{t(`priority.${task.priority}`)}</span>
        </div>
      </div>
    </article>
  );
}

function formatDate(value: string, format: ReturnType<typeof useFormatter>) {
  return format.dateTime(new Date(`${value}T00:00:00`), {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}
