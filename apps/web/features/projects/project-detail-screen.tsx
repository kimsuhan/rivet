'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Archive,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  ApiError,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  useIssuesControllerList,
  useProjectsControllerArchive,
  useProjectsControllerGet,
  useProjectsControllerTrash,
  useTeamWorksControllerList,
} from '@rivet/api-client';

import { ProjectLogo } from '@/components/project-logo';
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
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { IssueListRow } from '@/features/issues/issue-list-row';
import { projectIssueWorkHref } from '@/features/issues/issue-work-routing';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') return null;
  if (!('code' in error.body) || typeof error.body.code !== 'string') return null;
  return error.body.code;
}

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const t = useTranslations('Projects');
  const router = useRouter();
  const queryClient = useQueryClient();
  const project = useProjectsControllerGet(projectId, { query: { retry: false } });
  const issues = useIssuesControllerList(
    { projectId, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );
  const works = useTeamWorksControllerList(
    { projectId, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { retry: false } },
  );
  const archive = useProjectsControllerArchive();
  const trash = useProjectsControllerTrash();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<'CONFLICT' | 'ERROR' | null>(null);
  const [trashNotice, setTrashNotice] = useState<'CONFLICT' | 'NOT_EMPTY' | 'ERROR' | null>(null);

  if (project.isPending) return <ContentLoading label={t('loading')} />;
  if (project.isError || !project.data) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <ContentError
        title={notFound ? t('notFound.title') : t('error.title')}
        description={notFound ? t('notFound.description') : t('error.description')}
        retryLabel={t('retry')}
        onRetry={() => void project.refetch()}
      />
    );
  }

  const item = project.data;
  const canTrash = issues.data?.totalCount === 0;
  const hasMoreActions = !item.archived || canTrash;

  function scrollToIssues() {
    setTrashOpen(false);
    requestAnimationFrame(() => {
      document.getElementById('project-issues')?.scrollIntoView({ block: 'start' });
    });
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6" aria-labelledby="project-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectLogo logoFileId={item.logoFileId} name={item.name} size="lg" />
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">프로젝트</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 id="project-title" className="truncate text-2xl font-semibold">
                {item.name}
              </h1>
              {item.archived ? <Badge variant="secondary">{t('archived')}</Badge> : null}
            </div>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
              {item.description ?? '설명이 없습니다.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasMoreActions ? (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger
                type="button"
                aria-label={t('detail.moreActions')}
                title={t('detail.moreActions')}
                className={cn(
                  buttonVariants({ size: 'icon', variant: 'ghost' }),
                  'size-11 lg:size-9',
                )}
              >
                <MoreHorizontal aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 gap-1 p-1">
                <PopoverTitle className="bg-muted/50 flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 [&_svg]:size-4">
                  <ProjectLogo logoFileId={item.logoFileId} name={item.name} size="sm" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs font-normal">
                      {t('detail.menuLabel')}
                    </span>
                    <span className="truncate text-sm font-medium" title={item.name}>
                      {item.name}
                    </span>
                  </span>
                </PopoverTitle>
                <Separator className="my-1" />
                {!item.archived ? (
                  <Link
                    href={`/projects/${item.id}/edit`}
                    className={cn(
                      buttonVariants({ size: 'sm', variant: 'ghost' }),
                      'w-full justify-start',
                    )}
                    onClick={() => setMoreOpen(false)}
                  >
                    <Pencil data-icon="inline-start" />
                    {t('edit.action')}
                  </Link>
                ) : null}
                {!item.archived ? (
                  <Button
                    type="button"
                    className="w-full justify-start"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMoreOpen(false);
                      setArchiveOpen(true);
                    }}
                  >
                    <Archive data-icon="inline-start" />
                    {t('archive.action')}
                  </Button>
                ) : null}
                {canTrash ? (
                  <Button
                    type="button"
                    className="w-full justify-start"
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setMoreOpen(false);
                      setTrashOpen(true);
                    }}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t('trash.action')}
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
          ) : null}

          {!item.archived ? (
            <Link
              href={`/projects/${item.id}?create=1&projectId=${encodeURIComponent(item.id)}`}
              className={cn(buttonVariants(), 'gap-2')}
            >
              <Plus data-icon="inline-start" />
              이슈 만들기
            </Link>
          ) : null}
        </div>
      </header>

      {item.archived ? (
        <Alert>
          <Archive aria-hidden="true" />
          <AlertTitle>{t('detail.readOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('detail.readOnlyDescription')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="bg-surface-1 rounded-xl border p-4">
          <span className="text-muted-foreground text-xs">이슈 진행률</span>
          <strong className="mt-1 block text-2xl tabular-nums">{item.progress.percentage}%</strong>
          <Progress className="mt-3" value={item.progress.percentage} />
        </div>
        <div className="bg-surface-1 rounded-xl border p-4">
          <span className="text-muted-foreground text-xs">이슈</span>
          <strong className="mt-1 block text-2xl tabular-nums">
            {issues.data?.totalCount ?? item.progress.total}
          </strong>
        </div>
        <div className="bg-surface-1 rounded-xl border p-4">
          <span className="text-muted-foreground text-xs">팀 작업</span>
          <strong className="mt-1 block text-2xl tabular-nums">
            {works.data?.totalCount ?? 0}
          </strong>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {item.projectTeams
          .filter(({ active }) => active)
          .map(({ id, team }) => (
            <Badge key={id} variant="secondary">
              <span className="font-mono">{team.key}</span> · {team.name}
            </Badge>
          ))}
      </div>

      <div id="project-issues" className="flex scroll-mt-6 flex-col gap-6">
        {issues.isPending ? <ContentLoading label="프로젝트 이슈를 불러오는 중입니다" /> : null}
        {issues.isError ? (
          <ContentError
            title="프로젝트 이슈를 불러오지 못했습니다"
            description="프로젝트 정보는 유지했습니다."
            retryLabel={t('retry')}
            onRetry={() => void issues.refetch()}
          />
        ) : null}
        {issues.data && issues.data.items.length === 0 ? (
          <ContentEmpty
            icon={FolderKanban}
            title="프로젝트 이슈가 없습니다"
            description={
              item.archived
                ? t('detail.readOnlyDescription')
                : '이 프로젝트에서 첫 이슈를 만들어 보세요.'
            }
          >
            {!item.archived ? (
              <Link href={`/projects/${item.id}?create=1&projectId=${encodeURIComponent(item.id)}`}>
                <Button>
                  <Plus data-icon="inline-start" />
                  이슈 만들기
                </Button>
              </Link>
            ) : null}
          </ContentEmpty>
        ) : null}
        {issues.data && issues.data.items.length ? (
          <ul className="border-y">
            {issues.data.items.map((issue) => (
              <IssueListRow
                key={issue.id}
                detailHref={projectIssueWorkHref(item.id, issue.identifier)}
                issue={issue}
                queryKey={issues.queryKey}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <AlertDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) {
            setArchiveOpen(false);
            setArchiveNotice(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Archive aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('archive.title', { name: item.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('archive.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          {archiveNotice ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{t('archive.errorTitle')}</AlertTitle>
              <AlertDescription>
                {archiveNotice === 'CONFLICT'
                  ? t('archive.conflictDescription')
                  : t('archive.errorDescription')}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={archive.isPending}
              onClick={(event) => {
                event.preventDefault();
                setArchiveNotice(null);
                archive.mutate(
                  { projectId: item.id, data: { version: item.version } },
                  {
                    onError: (error) => {
                      const code = apiErrorCode(error);
                      setArchiveNotice(code === 'VERSION_CONFLICT' ? 'CONFLICT' : 'ERROR');
                      if (code === 'VERSION_CONFLICT') void project.refetch();
                    },
                    onSuccess: async (saved) => {
                      queryClient.setQueryData(getProjectsControllerGetQueryKey(saved.id), saved);
                      await queryClient.invalidateQueries({
                        queryKey: getProjectsControllerListQueryKey(),
                      });
                      setArchiveOpen(false);
                    },
                  },
                );
              }}
            >
              {archive.isPending ? (
                <Spinner data-icon="inline-start" aria-label={t('archive.archiving')} />
              ) : null}
              {t('archive.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={trashOpen}
        onOpenChange={(open) => {
          if (!open && !trash.isPending) {
            setTrashOpen(false);
            setTrashNotice(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('trash.title', { name: item.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('trash.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          {trashNotice ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>
                {trashNotice === 'NOT_EMPTY'
                  ? t('trash.notEmptyTitle')
                  : trashNotice === 'CONFLICT'
                    ? t('trash.conflictTitle')
                    : t('trash.errorTitle')}
              </AlertTitle>
              <AlertDescription>
                {trashNotice === 'NOT_EMPTY'
                  ? t('trash.notEmptyDescription')
                  : trashNotice === 'CONFLICT'
                    ? t('trash.conflictDescription')
                    : t('trash.errorDescription')}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trash.isPending}>{t('cancel')}</AlertDialogCancel>
            {trashNotice === 'NOT_EMPTY' ? (
              <Button type="button" onClick={scrollToIssues}>
                {t('trash.openIssues')}
              </Button>
            ) : (
              <AlertDialogAction
                type="button"
                variant="destructive"
                disabled={trash.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  setTrashNotice(null);
                  trash.mutate(
                    { projectId: item.id, data: { version: item.version } },
                    {
                      onError: (error) => {
                        const code = apiErrorCode(error);
                        setTrashNotice(
                          code === 'VERSION_CONFLICT'
                            ? 'CONFLICT'
                            : code === 'PROJECT_NOT_EMPTY'
                              ? 'NOT_EMPTY'
                              : 'ERROR',
                        );
                        if (code === 'VERSION_CONFLICT') void project.refetch();
                      },
                      onSuccess: async () => {
                        queryClient.removeQueries({
                          queryKey: getProjectsControllerGetQueryKey(item.id),
                        });
                        await queryClient.invalidateQueries({
                          queryKey: getProjectsControllerListQueryKey(),
                        });
                        setTrashOpen(false);
                        router.replace('/projects');
                      },
                    },
                  );
                }}
              >
                {trash.isPending ? (
                  <Spinner data-icon="inline-start" aria-label={t('trash.moving')} />
                ) : null}
                {t('trash.confirm')}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
