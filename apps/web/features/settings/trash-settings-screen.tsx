'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CheckCircle2,
  FolderKanban,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import {
  getTrashControllerListQueryKey,
  trashControllerList,
  type TrashItemResponseDto,
  type TrashRestoreResponseDto,
  useTrashControllerRestoreIssue,
  useTrashControllerRestoreProject,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserAvatar } from '@/components/user-avatar';

function ConnectionSummary({ item }: { item: TrashItemResponseDto }) {
  const t = useTranslations('Settings.trash');

  if (item.resourceType === 'PROJECT') {
    if (item.projectTeams.length === 0) return <>{t('noRoleTeams')}</>;

    return (
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        {item.projectTeams.map((projectTeam) => (
          <span key={projectTeam.id}>
            {projectTeam.teamName}
            {!projectTeam.active ? ` (${t('inactive')})` : ''}
            {projectTeam.teamArchived ? ` (${t('archived')})` : ''}
          </span>
        ))}
      </span>
    );
  }

  return (
    <>{item.project ? t('projectConnection', { name: item.project.name }) : t('noConnections')}</>
  );
}

function TrashRows({
  items,
  onRestore,
}: {
  items: TrashItemResponseDto[];
  onRestore: (item: TrashItemResponseDto) => void;
}) {
  const t = useTranslations('Settings.trash');
  const format = useFormatter();

  return (
    <ul className="border-t">
      {items.map((item) => {
        const Icon = item.resourceType === 'ISSUE' ? Archive : FolderKanban;

        return (
          <li key={`${item.resourceType}-${item.id}`} className="border-b py-4">
            <div className="flex items-start gap-3">
              <span className="bg-surface-2 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                <Icon aria-hidden="true" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {t(item.resourceType === 'ISSUE' ? 'issueType' : 'projectType')}
                  </Badge>
                  {item.identifier ? (
                    <span className="text-muted-foreground font-mono text-xs">
                      {item.identifier}
                    </span>
                  ) : null}
                  <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
                </div>

                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <dt className="text-muted-foreground">{t('deletedBy')}</dt>
                    <dd className="flex min-w-0 items-center gap-2">
                      <UserAvatar
                        avatarFileId={item.deletedBy.avatarFileId ?? null}
                        displayName={item.deletedBy.displayName}
                        size="sm"
                      />
                      <span className="truncate">{item.deletedBy.displayName}</span>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="text-muted-foreground">{t('deletedAt')}</dt>
                    <dd>
                      <time dateTime={item.deletedAt} className="tabular-nums">
                        {format.dateTime(new Date(item.deletedAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="text-muted-foreground">{t('purgeAt')}</dt>
                    <dd>
                      <time dateTime={item.purgeAt} className="tabular-nums">
                        {format.dateTime(new Date(item.purgeAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </dd>
                  </div>
                </dl>

                <div className="bg-surface-1 mt-3 rounded-md px-3 py-2 text-xs">
                  <span className="text-muted-foreground mr-2">{t('originalConnections')}</span>
                  <ConnectionSummary item={item} />
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('restoreNamed', { name: item.name })}
                onClick={() => onRestore(item)}
              >
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                {t('restore')}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RestoreDialog({
  item,
  onClose,
  onReloadLatest,
  onRestored,
}: {
  item: TrashItemResponseDto;
  onClose: () => void;
  onReloadLatest: () => Promise<void>;
  onRestored: (item: TrashItemResponseDto, result: TrashRestoreResponseDto) => Promise<void>;
}) {
  const t = useTranslations('Settings.trash');
  const restoreIssue = useTrashControllerRestoreIssue();
  const restoreProject = useTrashControllerRestoreProject();
  const mutation = item.resourceType === 'ISSUE' ? restoreIssue : restoreProject;
  const isConflict = mutation.error?.body.code === 'VERSION_CONFLICT';
  const archivedTeams = item.projectTeams.filter((projectTeam) => projectTeam.teamArchived);

  function restore(): void {
    const callbacks = {
      onSuccess: (result: TrashRestoreResponseDto) => onRestored(item, result),
    };

    if (item.resourceType === 'ISSUE') {
      restoreIssue.mutate({ data: { version: item.version }, issueId: item.id }, callbacks);
    } else {
      restoreProject.mutate({ data: { version: item.version }, projectId: item.id }, callbacks);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('restoreTitle', { name: item.name })}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2 text-left">
            <span>{t('restoreDescription')}</span>
            <span className="text-foreground font-medium">
              {t('originalConnections')} <ConnectionSummary item={item} />
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Alert>
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{t('restoreImpactTitle')}</AlertTitle>
          <AlertDescription>{t('restoreImpactDescription')}</AlertDescription>
        </Alert>

        {archivedTeams.length > 0 ? (
          <Alert>
            <Archive aria-hidden="true" />
            <AlertTitle>{t('archivedTeamsTitle')}</AlertTitle>
            <AlertDescription>
              {t('archivedTeamsDescription', {
                teams: archivedTeams.map(({ teamName }) => teamName).join(', '),
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        {isConflict ? (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>{t('conflictTitle')}</AlertTitle>
            <AlertDescription>{t('conflictDescription')}</AlertDescription>
            <AlertAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onReloadLatest()}
              >
                {t('reloadLatest')}
              </Button>
            </AlertAction>
          </Alert>
        ) : mutation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t('restoreErrorTitle')}</AlertTitle>
            <AlertDescription>{t('restoreErrorDescription')}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            disabled={mutation.isPending || isConflict}
            onClick={restore}
          >
            {mutation.isPending ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : (
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
            )}
            {t('restoreAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
        {mutation.isPending ? (
          <span role="status" className="sr-only">
            {t('restoring')}
          </span>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestoreNotice({ notice }: { notice: { name: string; warnings: string[] } }) {
  const t = useTranslations('Settings.trash');
  const warnings = [...new Set(notice.warnings)].map((warning) => {
    switch (warning) {
      case 'PROJECT_ARCHIVED':
        return t('warnings.projectArchived');
      case 'PROJECT_IN_TRASH':
        return t('warnings.projectInTrash');
      case 'TEAM_ARCHIVED':
        return t('warnings.teamArchived');
      default:
        return t('warnings.unknown');
    }
  });

  return (
    <Alert>
      {warnings.length > 0 ? (
        <TriangleAlert aria-hidden="true" />
      ) : (
        <CheckCircle2 aria-hidden="true" />
      )}
      <AlertTitle>{t('restoreSuccessTitle', { name: notice.name })}</AlertTitle>
      <AlertDescription>
        {warnings.length > 0 ? (
          <ul className="list-disc pl-4">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          t('restoreSuccessDescription')
        )}
      </AlertDescription>
    </Alert>
  );
}

export function TrashSettingsScreen() {
  const t = useTranslations('Settings.trash');
  const queryClient = useQueryClient();
  const [resourceType, setResourceType] = useState<'ISSUE' | 'PROJECT'>('ISSUE');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<TrashItemResponseDto | null>(null);
  const [notice, setNotice] = useState<{ name: string; warnings: string[] } | null>(null);
  const params = {
    limit: 20,
    resourceType,
    ...(query ? { query } : {}),
  };
  const trash = useInfiniteQuery({
    queryKey: getTrashControllerListQueryKey(params),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      trashControllerList({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const items = trash.data?.pages.flatMap((page) => page.items) ?? [];

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setQuery(draftQuery.trim());
  }

  function clearSearch(): void {
    setDraftQuery('');
    setQuery('');
  }

  async function invalidateTrash(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: getTrashControllerListQueryKey() });
  }

  const results = trash.isPending ? (
    <ContentLoading label={t('loading')} />
  ) : trash.isError && items.length === 0 ? (
    <ContentError
      title={t('errorTitle')}
      description={t('errorDescription')}
      retryLabel={t('retry')}
      onRetry={() => void trash.refetch()}
    />
  ) : items.length === 0 ? (
    <ContentEmpty
      icon={Trash2}
      title={query ? t('emptySearchTitle') : t('emptyTitle')}
      description={
        query
          ? t('emptySearchDescription')
          : t(resourceType === 'ISSUE' ? 'emptyIssueDescription' : 'emptyProjectDescription')
      }
    >
      {query ? (
        <Button type="button" variant="outline" onClick={clearSearch}>
          <X data-icon="inline-start" aria-hidden="true" />
          {t('clearSearch')}
        </Button>
      ) : null}
    </ContentEmpty>
  ) : (
    <div className="flex flex-col gap-4">
      <TrashRows items={items} onRestore={setRestoreTarget} />
      {trash.isFetchNextPageError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('loadMoreErrorTitle')}</AlertTitle>
          <AlertDescription>{t('loadMoreErrorDescription')}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={trash.isFetchingNextPage}
              onClick={() => void trash.fetchNextPage()}
            >
              {t('retry')}
            </Button>
          </AlertAction>
        </Alert>
      ) : trash.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={trash.isFetchingNextPage}
          onClick={() => void trash.fetchNextPage()}
        >
          {trash.isFetchingNextPage ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : null}
          {t('loadMore')}
        </Button>
      ) : null}
      {trash.isFetchingNextPage ? (
        <span role="status" className="sr-only">
          {t('loadingMore')}
        </span>
      ) : null}
    </div>
  );

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeading title={t('title')} description={t('description')} />

      <Alert>
        <Trash2 aria-hidden="true" />
        <AlertTitle>{t('retentionTitle')}</AlertTitle>
        <AlertDescription>{t('retentionDescription')}</AlertDescription>
      </Alert>

      {notice ? <RestoreNotice notice={notice} /> : null}

      <form role="search" className="flex max-w-xl items-end gap-2" onSubmit={submitSearch}>
        <FieldGroup className="flex-1">
          <Field>
            <FieldLabel htmlFor="trash-search" className="sr-only">
              {t('searchLabel')}
            </FieldLabel>
            <Input
              id="trash-search"
              type="search"
              value={draftQuery}
              maxLength={500}
              placeholder={t('searchPlaceholder')}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <Button type="submit" variant="outline">
          <Search data-icon="inline-start" aria-hidden="true" />
          {t('search')}
        </Button>
        {draftQuery || query ? (
          <Button type="button" variant="ghost" onClick={clearSearch}>
            <X data-icon="inline-start" aria-hidden="true" />
            {t('clearSearch')}
          </Button>
        ) : null}
      </form>

      <Tabs
        value={resourceType}
        onValueChange={(value) => {
          if (value === 'ISSUE' || value === 'PROJECT') setResourceType(value);
        }}
      >
        <TabsList variant="line" aria-label={t('tabsLabel')}>
          <TabsTrigger value="ISSUE">{t('issueTab')}</TabsTrigger>
          <TabsTrigger value="PROJECT">{t('projectTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="ISSUE" className="pt-3">
          {resourceType === 'ISSUE' ? results : null}
        </TabsContent>
        <TabsContent value="PROJECT" className="pt-3">
          {resourceType === 'PROJECT' ? results : null}
        </TabsContent>
      </Tabs>

      {restoreTarget ? (
        <RestoreDialog
          item={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onReloadLatest={async () => {
            await invalidateTrash();
            setRestoreTarget(null);
          }}
          onRestored={async (item, result) => {
            await invalidateTrash();
            setRestoreTarget(null);
            setNotice({ name: item.name, warnings: result.warnings });
          }}
        />
      ) : null}
    </section>
  );
}
