'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Monitor, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import {
  ApiError,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  type ProjectResponseDto,
  useMembersControllerList,
  useProjectsControllerCreate,
  useProjectsControllerGet,
  useProjectsControllerUpdate,
  useTeamsControllerList,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { ContentEmpty } from '@/components/states/content-empty';
import { ContentError } from '@/components/states/content-error';
import { ContentLoading } from '@/components/states/content-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';

import {
  createProjectPayload,
  PROJECT_FORM_STATUSES,
  PROJECT_ROLES,
  projectFormDefaults,
  projectFormSchema,
  type ProjectFormValues,
  updateProjectPayload,
} from './project-form';

type BlockingIssue = { identifier: string; title: string };

function readBlockingIssues(details: unknown): BlockingIssue[] {
  if (!details || typeof details !== 'object' || !('issues' in details)) return [];
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue) => {
    if (
      issue &&
      typeof issue === 'object' &&
      'identifier' in issue &&
      'title' in issue &&
      typeof issue.identifier === 'string' &&
      typeof issue.title === 'string'
    ) {
      return [{ identifier: issue.identifier, title: issue.title }];
    }
    return [];
  });
}

export function ProjectFormScreen({ projectId }: { projectId?: string }) {
  const t = useTranslations('Projects');

  return (
    <>
      <div className="lg:hidden">
        <ContentEmpty
          icon={Monitor}
          headingLevel={1}
          title={projectId ? t('edit.mobileTitle') : t('create.mobileTitle')}
          description={t('mobileDescription')}
        >
          <Link
            href={projectId ? `/projects/${projectId}` : '/projects'}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {projectId ? t('backToProject') : t('backToList')}
          </Link>
        </ContentEmpty>
      </div>
      <div className="hidden lg:block">
        {projectId ? <EditProjectForm projectId={projectId} /> : <ProjectForm />}
      </div>
    </>
  );
}

function EditProjectForm({ projectId }: { projectId: string }) {
  const t = useTranslations('Projects');
  const project = useProjectsControllerGet(projectId, { query: { retry: false } });

  if (project.isPending) return <ContentLoading label={t('loading')} />;
  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) {
      return (
        <ContentEmpty
          icon={Monitor}
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

  if (project.data.archived) {
    return (
      <ContentEmpty
        icon={Monitor}
        headingLevel={1}
        title={t('form.archivedTitle')}
        description={t('form.archivedDescription')}
      >
        <Link
          href={`/projects/${projectId}`}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          {t('backToProject')}
        </Link>
      </ContentEmpty>
    );
  }

  return (
    <ProjectForm
      project={project.data}
      reload={async () => (await project.refetch()).data ?? null}
    />
  );
}

function ProjectForm({
  project,
  reload,
}: {
  project?: ProjectResponseDto;
  reload?: () => Promise<ProjectResponseDto | null>;
}) {
  const t = useTranslations('Projects');
  const router = useRouter();
  const queryClient = useQueryClient();
  const create = useProjectsControllerCreate();
  const update = useProjectsControllerUpdate();
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { retry: false } },
  );
  const schema = projectFormSchema({
    dateOrder: t('validation.dateOrder'),
    descriptionTooLong: t('validation.descriptionTooLong'),
    nameRequired: t('validation.nameRequired'),
    nameTooLong: t('validation.nameTooLong'),
    roleRequired: t('validation.roleRequired'),
  });
  const form = useForm<ProjectFormValues>({
    defaultValues: projectFormDefaults(project),
    resolver: zodResolver(schema),
  });
  const values = useWatch({ control: form.control });
  const [notice, setNotice] = useState<'ERROR' | 'ROLE_IN_USE' | 'VERSION_CONFLICT' | null>(null);
  const [blockingIssues, setBlockingIssues] = useState<BlockingIssue[]>([]);
  const [latestProject, setLatestProject] = useState<ProjectResponseDto | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<ProjectFormValues | null>(null);
  const mutation = project ? update : create;
  const isPending = mutation.isPending;
  const currentTeams = project?.roleTeams.map(({ team }) => team) ?? [];
  const teamOptions = uniqueById([...currentTeams, ...(teams.data?.items ?? [])]);
  const memberOptions = uniqueById([
    ...(project?.lead ? [project.lead] : []),
    ...(members.data?.items ?? []),
  ]);

  async function refreshLatest() {
    if (!reload) return null;
    const latest = await reload();
    setLatestProject(latest);
    return latest;
  }

  function handleError(error: unknown, submitted: ProjectFormValues) {
    setLastSubmitted(submitted);
    if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') {
      setNotice('ERROR');
      return;
    }

    const body = error.body as {
      code?: string;
      details?: unknown;
      fieldErrors?: Record<string, string[]>;
    };
    const fieldErrors = body.fieldErrors ?? {};
    const fieldMap: Partial<Record<keyof ProjectFormValues, string | undefined>> = {
      description: fieldErrors.description?.[0],
      name: fieldErrors.name?.[0],
      startDate: fieldErrors.startDate?.[0],
      targetDate: fieldErrors.targetDate?.[0],
    };
    for (const [field, message] of Object.entries(fieldMap)) {
      if (message) form.setError(field as keyof ProjectFormValues, { message, type: 'server' });
    }

    if (body.code === 'VERSION_CONFLICT') {
      setNotice('VERSION_CONFLICT');
      void refreshLatest();
      return;
    }
    if (body.code === 'PROJECT_ROLE_IN_USE') {
      setBlockingIssues(readBlockingIssues(body.details));
      setNotice('ROLE_IN_USE');
      void refreshLatest();
      return;
    }
    if (body.code === 'PROJECT_ROLE_REQUIRED') {
      form.setError(
        'BACKEND',
        { message: t('validation.roleRequired'), type: 'server' },
        { shouldFocus: true },
      );
      return;
    }
    if (body.code === 'PROJECT_DATE_INVALID') {
      form.setError('startDate', { message: t('validation.dateOrder'), type: 'server' });
      form.setError(
        'targetDate',
        { message: t('validation.dateOrder'), type: 'server' },
        { shouldFocus: true },
      );
      return;
    }
    if (Object.values(fieldMap).every((message) => !message)) setNotice('ERROR');
  }

  function save(submitted: ProjectFormValues, version = project?.version) {
    if (isPending) return;
    setNotice(null);
    setLatestProject(null);
    form.clearErrors();

    const options = {
      onError: (error: unknown) => handleError(error, submitted),
      onSuccess: async (saved: ProjectResponseDto) => {
        await queryClient.invalidateQueries({ queryKey: getProjectsControllerListQueryKey() });
        await queryClient.invalidateQueries({
          queryKey: getProjectsControllerGetQueryKey(saved.id),
        });
        router.push(`/projects/${saved.id}`);
      },
    };

    if (project && version) {
      update.mutate(
        { data: updateProjectPayload(submitted, version), projectId: project.id },
        options,
      );
    } else {
      create.mutate({ data: createProjectPayload(submitted) }, options);
    }
  }

  const submit = form.handleSubmit((submitted) => save(submitted));

  function restoreLatest() {
    if (!latestProject) return;
    form.reset(projectFormDefaults(latestProject));
    setNotice(null);
  }

  if (teams.isPending || members.isPending) return <ContentLoading label={t('loading')} />;
  if (teams.isError || members.isError) {
    return (
      <ContentError
        headingLevel={1}
        title={t('options.errorTitle')}
        description={t('options.errorDescription')}
        retryLabel={t('retry')}
        onRetry={() => {
          if (teams.isError) void teams.refetch();
          if (members.isError) void members.refetch();
        }}
      />
    );
  }

  return (
    <section className="mx-auto max-w-3xl pb-20">
      <PageHeading
        title={project ? t('edit.title', { name: project.name }) : t('create.title')}
        description={project ? t('edit.description') : t('create.description')}
      />

      <form className="mt-6 flex flex-col gap-8" noValidate onSubmit={submit}>
        {notice === 'ERROR' ? (
          <Alert variant="destructive">
            <AlertTitle>{t('saveError.title')}</AlertTitle>
            <AlertDescription>{t('saveError.description')}</AlertDescription>
          </Alert>
        ) : null}
        {notice === 'VERSION_CONFLICT' ? (
          <Alert>
            <RotateCcw aria-hidden="true" />
            <AlertTitle>{t('conflict.title')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p>{t('conflict.description')}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!latestProject || !lastSubmitted || isPending}
                  onClick={() => {
                    if (latestProject && lastSubmitted) save(lastSubmitted, latestProject.version);
                  }}
                >
                  {t('conflict.reapply')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!latestProject}
                  onClick={restoreLatest}
                >
                  {t('conflict.restore')}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {notice === 'ROLE_IN_USE' ? (
          <Alert variant="destructive">
            <AlertTitle>{t('roleInUse.title')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p>{t('roleInUse.description')}</p>
              {blockingIssues.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {blockingIssues.map((issue) => (
                    <li key={issue.identifier}>
                      {issue.identifier} · {issue.title}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!latestProject}
                onClick={restoreLatest}
              >
                {t('conflict.restore')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.name)}>
            <FieldLabel htmlFor="project-name">{t('field.name')}</FieldLabel>
            <Input
              id="project-name"
              autoComplete="off"
              maxLength={200}
              aria-invalid={Boolean(form.formState.errors.name)}
              {...form.register('name')}
            />
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.description)}>
            <FieldLabel htmlFor="project-description">{t('field.description')}</FieldLabel>
            <Textarea
              id="project-description"
              rows={5}
              maxLength={5000}
              aria-invalid={Boolean(form.formState.errors.description)}
              {...form.register('description')}
            />
            <FieldDescription>{t('field.descriptionHint')}</FieldDescription>
            <FieldError errors={[form.formState.errors.description]} />
          </Field>
          {project ? (
            <ProjectSelectField
              id="project-status"
              label={t('field.status')}
              value={values.status ?? 'PLANNED'}
              items={PROJECT_FORM_STATUSES.map((status) => ({
                label: t(`status.${status}`),
                value: status,
              }))}
              onChange={(value) =>
                form.setValue('status', value as ProjectFormValues['status'], { shouldDirty: true })
              }
            />
          ) : null}
          <ProjectSelectField
            id="project-lead"
            label={t('field.lead')}
            value={values.leadMembershipId || 'NONE'}
            items={[
              { label: t('field.noLead'), value: 'NONE' },
              ...memberOptions.map((member) => ({
                label: member.user.displayName,
                value: member.id,
              })),
            ]}
            onChange={(value) =>
              form.setValue('leadMembershipId', value === 'NONE' ? '' : value, {
                shouldDirty: true,
              })
            }
          />
        </FieldGroup>

        <FieldSet>
          <FieldLegend>{t('field.schedule')}</FieldLegend>
          <FieldDescription>{t('field.scheduleHint')}</FieldDescription>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(form.formState.errors.startDate)}>
              <FieldLabel htmlFor="project-start-date">{t('field.startDate')}</FieldLabel>
              <Input
                id="project-start-date"
                type="date"
                aria-invalid={Boolean(form.formState.errors.startDate)}
                {...form.register('startDate')}
              />
              <FieldError errors={[form.formState.errors.startDate]} />
            </Field>
            <Field data-invalid={Boolean(form.formState.errors.targetDate)}>
              <FieldLabel htmlFor="project-target-date">{t('field.targetDate')}</FieldLabel>
              <Input
                id="project-target-date"
                type="date"
                aria-invalid={Boolean(form.formState.errors.targetDate)}
                {...form.register('targetDate')}
              />
              <FieldError errors={[form.formState.errors.targetDate]} />
            </Field>
          </div>
        </FieldSet>

        <FieldSet data-invalid={Boolean(form.formState.errors.BACKEND)}>
          <FieldLegend>{t('field.roleTeams')}</FieldLegend>
          <FieldDescription>{t('field.roleTeamsHint')}</FieldDescription>
          <div className="flex flex-col gap-3">
            {PROJECT_ROLES.map((role) => (
              <ProjectSelectField
                key={role}
                id={`project-role-${role.toLowerCase()}`}
                label={t(`role.${role}`)}
                description={t(`roleDescription.${role}`)}
                value={values[role] || 'NONE'}
                items={[
                  { label: t('field.noTeam'), value: 'NONE' },
                  ...teamOptions.map((team) => ({
                    label: `${team.name} (${team.key})`,
                    value: team.id,
                  })),
                ]}
                onChange={(value) =>
                  form.setValue(role, value === 'NONE' ? '' : value, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            ))}
          </div>
          <FieldError errors={[form.formState.errors.BACKEND]} />
        </FieldSet>

        <div className="bg-background fixed inset-x-0 bottom-0 flex justify-end gap-2 border-t px-6 py-3 lg:left-14 xl:left-60">
          <Link
            href={project ? `/projects/${project.id}` : '/projects'}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('cancel')}
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
            {isPending ? t('saving') : project ? t('edit.save') : t('create.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function ProjectSelectField({
  description,
  id,
  items,
  label,
  onChange,
  value,
}: {
  description?: string;
  id: string;
  items: Array<{ label: string; value: string }>;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Field orientation={description ? 'horizontal' : 'vertical'}>
      <div className="min-w-0 flex-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </div>
      <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
