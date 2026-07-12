'use client';

import { FolderKanban, Plus, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import { useProjectsControllerList } from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  buildProjectListParams,
  clearProjectListFilters,
  PROJECT_SORT_DIRECTIONS,
  PROJECT_SORT_FIELDS,
  PROJECT_STATUSES,
  readProjectListState,
  replaceProjectListParam,
} from './project-list-state';
import {
  type ProjectLabels,
  ProjectProgress,
  ProjectRoleBadges,
  ProjectStatusBadge,
} from './project-shared';

export function ProjectListScreen() {
  const t = useTranslations('Projects');
  const format = useFormatter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const state = readProjectListState(searchParams);
  const projects = useProjectsControllerList(buildProjectListParams(state), {
    query: { retry: false },
  });
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

  function replaceUrl(key: Parameters<typeof replaceProjectListParam>[1], value: string | null) {
    const query = replaceProjectListParam(searchParams, key, value);
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (projects.isPending) return <ContentLoading label={t('loading')} />;

  if (projects.isError) {
    return (
      <ContentError
        headingLevel={1}
        title={t('error.title')}
        description={t('error.description')}
        retryLabel={t('retry')}
        onRetry={() => void projects.refetch()}
      />
    );
  }

  const items = projects.data.items;
  const hasFilters = Boolean(state.status || state.includeArchived);
  const clearFilters = () => {
    const query = clearProjectListFilters(searchParams);
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <section className="min-w-0">
      <PageHeading title={t('list.title')} description={t('list.description')} />

      <div className="mt-4 hidden justify-end lg:flex">
        <Link href="/projects/new" className={buttonVariants({ size: 'sm' })}>
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('create.action')}
        </Link>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-y py-3">
        <Select
          items={[
            { label: t('filter.allStatuses'), value: 'ALL' },
            ...PROJECT_STATUSES.map((status) => ({
              label: labels.statuses[status],
              value: status,
            })),
          ]}
          value={state.status ?? 'ALL'}
          onValueChange={(value) => replaceUrl('status', value === 'ALL' ? null : value)}
        >
          <SelectTrigger size="sm" aria-label={t('filter.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ALL">{t('filter.allStatuses')}</SelectItem>
              {PROJECT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {labels.statuses[status]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Field orientation="horizontal" className="w-fit">
          <Checkbox
            id="project-include-archived"
            checked={state.includeArchived}
            onCheckedChange={(checked) => replaceUrl('archived', checked ? 'true' : null)}
          />
          <FieldLabel htmlFor="project-include-archived">{t('filter.includeArchived')}</FieldLabel>
        </Field>

        {hasFilters ? (
          <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {t('filter.reset')}
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Select
            items={PROJECT_SORT_FIELDS.map((sort) => ({
              label: t(`sort.${sort}`),
              value: sort,
            }))}
            value={state.sort}
            onValueChange={(value) => replaceUrl('sort', value)}
          >
            <SelectTrigger size="sm" aria-label={t('sort.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PROJECT_SORT_FIELDS.map((sort) => (
                  <SelectItem key={sort} value={sort}>
                    {t(`sort.${sort}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={PROJECT_SORT_DIRECTIONS.map((direction) => ({
              label: t(`sort.${direction}`),
              value: direction,
            }))}
            value={state.sortDirection}
            onValueChange={(value) => replaceUrl('direction', value)}
          >
            <SelectTrigger size="sm" aria-label={t('sort.directionLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PROJECT_SORT_DIRECTIONS.map((direction) => (
                  <SelectItem key={direction} value={direction}>
                    {t(`sort.${direction}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {items.length === 0 ? (
        <ContentEmpty
          icon={FolderKanban}
          title={hasFilters ? t('empty.filteredTitle') : t('empty.title')}
          description={hasFilters ? t('empty.filteredDescription') : t('empty.description')}
        >
          {hasFilters ? (
            <Button type="button" size="sm" variant="outline" onClick={clearFilters}>
              {t('filter.reset')}
            </Button>
          ) : (
            <Link
              href="/projects/new"
              className={cn(buttonVariants({ size: 'sm' }), 'hidden lg:inline-flex')}
            >
              {t('create.action')}
            </Link>
          )}
        </ContentEmpty>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {items.map((project) => (
            <Card key={project.id} size="sm">
              <CardHeader>
                <CardTitle className="min-w-0">
                  <Link
                    href={`/projects/${project.id}`}
                    className="focus-visible:ring-ring block truncate rounded-sm outline-none focus-visible:ring-2"
                  >
                    {project.name}
                  </Link>
                </CardTitle>
                <CardDescription className="line-clamp-2 min-h-10">
                  {project.description ?? t('list.noDescription')}
                </CardDescription>
                <CardAction>
                  <div className="flex items-center gap-2">
                    {project.archived ? (
                      <span className="text-muted-foreground text-xs">{t('archived')}</span>
                    ) : null}
                    <ProjectStatusBadge labels={labels.statuses} status={project.status} />
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">{t('field.lead')}</dt>
                    <dd className="mt-1 truncate">
                      {project.lead?.user.displayName ?? t('field.noLead')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">{t('field.schedule')}</dt>
                    <dd className="mt-1 text-xs tabular-nums">
                      {formatDateRange(
                        project.startDate,
                        project.targetDate,
                        format,
                        t('field.noDate'),
                      )}
                    </dd>
                  </div>
                </dl>
                <ProjectRoleBadges labels={labels.roles} roleTeams={project.roleTeams} />
                <ProjectProgress labels={labels} progress={project.progress} />
              </CardContent>
              <CardFooter className="justify-end">
                <Link
                  href={`/projects/${project.id}`}
                  className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                >
                  {t('detail.open')}
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {state.cursor ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => replaceUrl('cursor', null)}
          >
            {t('pagination.first')}
          </Button>
        ) : null}
        {projects.data.nextCursor ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => replaceUrl('cursor', projects.data.nextCursor)}
          >
            {t('pagination.next')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function formatDateRange(
  startDate: string | null,
  targetDate: string | null,
  format: ReturnType<typeof useFormatter>,
  empty: string,
) {
  const date = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00`), {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });

  if (startDate && targetDate) return `${date(startDate)} – ${date(targetDate)}`;
  if (startDate) return `${date(startDate)} –`;
  if (targetDate) return `– ${date(targetDate)}`;
  return empty;
}
