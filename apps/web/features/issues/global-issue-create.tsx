'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  type CreateFeatureIssueDto,
  type CreateTeamTaskIssueDto,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  useIssuesControllerCreate,
  useIssuesControllerList,
  useLabelsControllerList,
  useMembersControllerList,
  useProjectsControllerList,
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
} from '@rivet/api-client';

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
import { MarkdownEditor } from '@/features/collaboration/markdown-editor';
import { FileUploadQueue } from '@/features/files/file-upload-queue';
import { useRouter } from '@/i18n/navigation';

import { readLastTeamKey, rememberTeamKey } from '../teams/team-selector-storage';
import { fileUploadQueueLabels, markdownEditorLabels } from './issue-collaboration-labels';

const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const FEATURE_STATUSES = [
  'UNSORTED',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'PAUSED',
  'CANCELED',
] as const;
const PROJECT_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;

export type IssueCreateSeed = {
  parentIssueId?: string;
  projectId?: string;
  projectRole?: (typeof PROJECT_ROLES)[number];
  type?: 'FEATURE' | 'TEAM_TASK';
};

export type IssueCreateLabels = {
  assigneeLabel: string;
  assigneePlaceholder: string;
  cancel: string;
  close: string;
  description: string;
  discardChanges: string;
  discardDescription: string;
  discardTitle: string;
  errorDescription: string;
  errorTitle: string;
  featureStatuses: Record<(typeof FEATURE_STATUSES)[number], string>;
  featureType: string;
  keepEditing: string;
  labelsLabel: string;
  labelsUnavailable: string;
  mobileDescription: string;
  mobileTitle: string;
  noLabels: string;
  noParent: string;
  noProject: string;
  optionsErrorDescription: string;
  optionsErrorTitle: string;
  optionsLoading: string;
  parentLabel: string;
  parentPlaceholder: string;
  priorities: Record<(typeof PRIORITIES)[number], string>;
  priorityLabel: string;
  projectLabel: string;
  projectPlaceholder: string;
  projectRequired: string;
  projectRoleLabel: string;
  projectRolePlaceholder: string;
  projectRoleRequired: string;
  projectRoles: Record<(typeof PROJECT_ROLES)[number], string>;
  retry: string;
  shortcutHint: string;
  stateLabel: string;
  statePlaceholder: string;
  stateRequired: string;
  submit: string;
  submitting: string;
  teamLabel: string;
  teamLockedByRole: string;
  teamPlaceholder: string;
  teamRequired: string;
  teamTaskType: string;
  title: string;
  titleLabel: string;
  titlePlaceholder: string;
  titleRequired: string;
  titleTooLong: string;
  typeLabel: string;
  unassigned: string;
};

function chooseTeamId(
  teams: Array<{ id: string; key: string }>,
  currentTeamKey: string | null,
): string {
  const currentTeam = teams.find((team) => team.key === currentTeamKey);
  if (currentTeam) return currentTeam.id;

  const lastTeam = teams.find((team) => team.key === readLastTeamKey());
  return lastTeam?.id ?? teams[0]?.id ?? '';
}

export function GlobalIssueCreate({
  currentTeamKey,
  labels,
  onOpenChange,
  open,
  seed,
}: {
  currentTeamKey: string | null;
  labels: IssueCreateLabels;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  seed: IssueCreateSeed | null;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const createT = useTranslations('IssueCreate');
  const markdownT = useTranslations('Markdown');
  const filesT = useTranslations('Files');
  const schema = useMemo(
    () =>
      z
        .object({
          assigneeMembershipId: z.string().nullable(),
          attachmentFileIds: z.array(z.string()),
          descriptionMarkdown: z.string().max(100_000),
          featureStatus: z.enum(FEATURE_STATUSES),
          labelIds: z.array(z.string()),
          parentIssueId: z.string().nullable(),
          priority: z.enum(PRIORITIES),
          projectId: z.string().nullable(),
          projectRole: z.enum(PROJECT_ROLES).nullable(),
          teamId: z.string(),
          title: z.string().trim().min(1, labels.titleRequired).max(500, labels.titleTooLong),
          type: z.enum(['TEAM_TASK', 'FEATURE']),
          workflowStateId: z.string(),
        })
        .superRefine((values, context) => {
          if (values.type === 'FEATURE') {
            if (!values.projectId) {
              context.addIssue({
                code: 'custom',
                message: labels.projectRequired,
                path: ['projectId'],
              });
            }
            return;
          }

          if (!values.teamId) {
            context.addIssue({ code: 'custom', message: labels.teamRequired, path: ['teamId'] });
          }
          if (!values.workflowStateId) {
            context.addIssue({
              code: 'custom',
              message: labels.stateRequired,
              path: ['workflowStateId'],
            });
          }
          if (values.projectId && !values.projectRole) {
            context.addIssue({
              code: 'custom',
              message: labels.projectRoleRequired,
              path: ['projectRole'],
            });
          }
        }),
    [labels],
  );
  type FormValues = z.infer<typeof schema>;
  const form = useForm<FormValues>({
    defaultValues: {
      assigneeMembershipId: null,
      attachmentFileIds: [],
      descriptionMarkdown: '',
      featureStatus: 'UNSORTED',
      labelIds: [],
      parentIssueId: null,
      priority: 'NONE',
      projectId: null,
      projectRole: null,
      teamId: '',
      title: '',
      type: 'TEAM_TASK',
      workflowStateId: '',
    },
    resolver: zodResolver(schema),
  });
  const {
    formState: { isDirty },
    getValues,
    reset: resetForm,
    setFocus,
    setValue,
  } = form;
  const issueType = useWatch({ control: form.control, name: 'type' });
  const selectedProjectId = useWatch({ control: form.control, name: 'projectId' });
  const selectedProjectRole = useWatch({ control: form.control, name: 'projectRole' });
  const selectedTeamId = useWatch({ control: form.control, name: 'teamId' });
  const mutation = useIssuesControllerCreate();
  const { reset: resetMutation } = mutation;
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const [descriptionCanSubmit, setDescriptionCanSubmit] = useState(true);
  const [attachmentsReady, setAttachmentsReady] = useState(true);
  const teams = useTeamsControllerList(
    { includeArchived: false },
    { query: { enabled: open, retry: false } },
  );
  const projects = useProjectsControllerList(
    { includeArchived: false, limit: 100 },
    { query: { enabled: open, retry: false } },
  );
  const parentFeatures = useIssuesControllerList(
    { limit: 100, ...(selectedProjectId ? { projectId: selectedProjectId } : {}), type: 'FEATURE' },
    { query: { enabled: open && Boolean(selectedProjectId), retry: false } },
  );
  const workflowStates = useTeamsControllerListWorkflowStates(selectedTeamId, {
    query: { enabled: open && issueType === 'TEAM_TASK' && Boolean(selectedTeamId), retry: false },
  });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE', teamId: selectedTeamId },
    {
      query: {
        enabled: open && issueType === 'TEAM_TASK' && Boolean(selectedTeamId),
        retry: false,
      },
    },
  );
  const workspaceMembers = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { enabled: open, retry: false } },
  );
  const availableLabels = useLabelsControllerList(
    { includeArchived: false, limit: 100 },
    { query: { enabled: open, retry: false } },
  );
  const teamItems = (teams.data?.items ?? []).filter((team) => !team.archived);
  const projectItems = (projects.data?.items ?? []).filter(
    (project) =>
      !project.archived && project.status !== 'COMPLETED' && project.status !== 'CANCELED',
  );
  const selectedProject = projectItems.find((project) => project.id === selectedProjectId);
  const roleItems = useMemo(() => selectedProject?.roleTeams ?? [], [selectedProject]);
  const parentItems = parentFeatures.data?.items ?? [];
  const labelItems = (availableLabels.data?.items ?? []).filter((label) => !label.archived);
  const mentionOptions = (workspaceMembers.data?.items ?? []).map((member) => ({
    displayName: member.user.displayName,
    membershipId: member.id,
  }));
  const hasOptionsError =
    teams.isError ||
    projects.isError ||
    availableLabels.isError ||
    workspaceMembers.isError ||
    (issueType === 'TEAM_TASK' && (workflowStates.isError || members.isError)) ||
    (Boolean(selectedProjectId) && parentFeatures.isError);

  useEffect(() => {
    if (!open) return;

    resetForm({
      assigneeMembershipId: null,
      attachmentFileIds: [],
      descriptionMarkdown: '',
      featureStatus: 'UNSORTED',
      labelIds: [],
      parentIssueId: seed?.parentIssueId ?? null,
      priority: 'NONE',
      projectId: seed?.projectId ?? null,
      projectRole: seed?.projectRole ?? null,
      teamId: '',
      title: '',
      type: seed?.type ?? 'TEAM_TASK',
      workflowStateId: '',
    });
    resetMutation();
    requestAnimationFrame(() => setFocus('title'));
  }, [open, resetForm, resetMutation, seed, setFocus]);

  useEffect(() => {
    if (!open || issueType !== 'TEAM_TASK') return;

    if (selectedProjectId) {
      const roleTeam = roleItems.find(({ role }) => role === selectedProjectRole);
      const nextTeamId = roleTeam?.team.id ?? '';
      if (getValues('teamId') !== nextTeamId) {
        setValue('teamId', nextTeamId, { shouldDirty: false, shouldValidate: false });
        setValue('workflowStateId', '', { shouldDirty: false, shouldValidate: false });
        setValue('assigneeMembershipId', null, { shouldDirty: false, shouldValidate: false });
      }
      return;
    }

    if (!getValues('teamId') && teamItems.length > 0) {
      setValue('teamId', chooseTeamId(teamItems, currentTeamKey), {
        shouldDirty: false,
        shouldValidate: false,
      });
    }
  }, [
    currentTeamKey,
    getValues,
    issueType,
    open,
    roleItems,
    selectedProjectId,
    selectedProjectRole,
    setValue,
    teamItems,
  ]);

  useEffect(() => {
    if (!open || issueType !== 'TEAM_TASK' || !selectedTeamId || getValues('workflowStateId')) {
      return;
    }

    const defaultState = workflowStates.data?.items.find((state) => state.isDefault);
    if (defaultState) {
      setValue('workflowStateId', defaultState.id, {
        shouldDirty: false,
        shouldValidate: false,
      });
    }
  }, [getValues, issueType, open, selectedTeamId, setValue, workflowStates.data]);

  function requestClose() {
    if (mutation.isPending) return;
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onOpenChange(false);
  }

  function retryOptions() {
    if (teams.isError) void teams.refetch();
    if (projects.isError) void projects.refetch();
    if (parentFeatures.isError) void parentFeatures.refetch();
    if (workflowStates.isError) void workflowStates.refetch();
    if (members.isError) void members.refetch();
    if (workspaceMembers.isError) void workspaceMembers.refetch();
    if (availableLabels.isError) void availableLabels.refetch();
  }

  const submit = form.handleSubmit((values) => {
    if (mutation.isPending || !descriptionCanSubmit || !attachmentsReady) return;

    const common = {
      attachmentFileIds: values.attachmentFileIds,
      descriptionMarkdown: values.descriptionMarkdown.trim().length
        ? values.descriptionMarkdown
        : null,
      labelIds: values.labelIds,
      priority: values.priority,
      title: values.title.trim(),
    };
    const data: CreateFeatureIssueDto | CreateTeamTaskIssueDto =
      values.type === 'FEATURE'
        ? {
            ...common,
            featureStatus: values.featureStatus,
            projectId: values.projectId!,
            type: 'FEATURE',
          }
        : {
            ...common,
            assigneeMembershipId: values.assigneeMembershipId,
            ...(values.parentIssueId ? { parentIssueId: values.parentIssueId } : {}),
            ...(values.projectId && values.projectRole
              ? { projectId: values.projectId, projectRole: values.projectRole }
              : {}),
            teamId: values.teamId,
            type: 'TEAM_TASK',
            workflowStateId: values.workflowStateId,
          };

    form.clearErrors();
    mutation.reset();
    mutation.mutate(
      { data },
      {
        onError: (error) => {
          if (error.body.code === 'PARENT_ISSUE_PROJECT_MISMATCH') {
            void parentFeatures.refetch();
          }
          const fieldOrder: Array<keyof FormValues> = [
            'title',
            'descriptionMarkdown',
            'attachmentFileIds',
            'type',
            'projectId',
            'projectRole',
            'parentIssueId',
            'teamId',
            'workflowStateId',
            'featureStatus',
            'assigneeMembershipId',
            'priority',
            'labelIds',
          ];
          let shouldFocus = true;

          for (const field of fieldOrder) {
            const serverMessage = error.body.fieldErrors[field]?.[0];
            const message =
              field === 'parentIssueId' && error.body.code === 'PARENT_ISSUE_PROJECT_MISMATCH'
                ? createT('parentProjectMismatch')
                : field === 'descriptionMarkdown' && error.body.code === 'MARKDOWN_INVALID'
                  ? createT('descriptionInvalid')
                  : field === 'descriptionMarkdown' && error.body.code === 'MENTION_INVALID'
                    ? createT('mentionInvalid')
                    : (field === 'descriptionMarkdown' || field === 'attachmentFileIds') &&
                        error.body.code.startsWith('FILE_')
                      ? createT('fileInvalid')
                      : serverMessage;
            if (!message) continue;
            form.setError(field, { message, type: 'server' }, { shouldFocus });
            shouldFocus = false;
          }
        },
        onSuccess: (issue) => {
          queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.id), issue);
          queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.identifier), issue);
          const issueListRoot = getIssuesControllerListQueryKey()[0];
          onOpenChange(false);
          router.push(`/issues/${encodeURIComponent(issue.identifier)}`);
          void queryClient
            .invalidateQueries({
              predicate: ({ queryKey }) => {
                const key = queryKey[0];
                return (
                  key === issueListRoot ||
                  (typeof key === 'string' && key.startsWith(`${issueListRoot}?`))
                );
              },
            })
            .catch(() => undefined);
        },
      },
    );
  });

  const setAttachmentFileIds = useCallback(
    (fileIds: string[]) =>
      setValue('attachmentFileIds', fileIds, {
        shouldDirty: fileIds.length > 0,
        shouldValidate: true,
      }),
    [setValue],
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose();
        }}
      >
        <DialogContent closeLabel={labels.close} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>

          <div className="lg:hidden">
            <div className="flex min-h-64 flex-col items-start justify-center gap-3 py-8">
              <span className="bg-surface-2 text-muted-foreground flex size-10 items-center justify-center rounded-lg">
                <Monitor aria-hidden="true" className="size-6" strokeWidth={1.75} />
              </span>
              <div className="space-y-1">
                <h2 className="font-medium">{labels.mobileTitle}</h2>
                <p className="text-muted-foreground max-w-md text-sm">{labels.mobileDescription}</p>
              </div>
            </div>
          </div>

          <form
            noValidate
            aria-busy={mutation.isPending}
            className="hidden lg:block"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            onSubmit={submit}
          >
            <div className="flex max-h-[calc(100dvh-13rem)] flex-col gap-4 overflow-y-auto pr-1">
              {hasOptionsError ? (
                <Alert variant="destructive">
                  <AlertTitle>{labels.optionsErrorTitle}</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-3">
                    <span>{labels.optionsErrorDescription}</span>
                    <Button type="button" size="sm" variant="outline" onClick={retryOptions}>
                      {labels.retry}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {mutation.isError &&
              mutation.error.body.code !== 'PARENT_ISSUE_PROJECT_MISMATCH' &&
              Object.keys(mutation.error.body.fieldErrors).length === 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>{labels.errorTitle}</AlertTitle>
                  <AlertDescription>{labels.errorDescription}</AlertDescription>
                </Alert>
              ) : null}

              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="issue-type">{labels.typeLabel}</FieldLabel>
                    <Select
                      items={[
                        { label: labels.teamTaskType, value: 'TEAM_TASK' },
                        { label: labels.featureType, value: 'FEATURE' },
                      ]}
                      value={field.value}
                      onValueChange={(value) => {
                        if (value !== 'TEAM_TASK' && value !== 'FEATURE') return;
                        field.onChange(value);
                        form.setValue('teamId', '', { shouldDirty: true });
                        form.setValue('workflowStateId', '', { shouldDirty: true });
                        form.setValue('assigneeMembershipId', null, { shouldDirty: true });
                        if (value === 'FEATURE') {
                          form.setValue('projectRole', null, { shouldDirty: true });
                          form.setValue('parentIssueId', null, { shouldDirty: true });
                        }
                      }}
                    >
                      <SelectTrigger id="issue-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          <SelectItem value="TEAM_TASK">{labels.teamTaskType}</SelectItem>
                          <SelectItem value="FEATURE">{labels.featureType}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              <Field data-invalid={Boolean(form.formState.errors.title)}>
                <FieldLabel htmlFor="issue-title">{labels.titleLabel}</FieldLabel>
                <Input
                  id="issue-title"
                  autoComplete="off"
                  aria-invalid={Boolean(form.formState.errors.title)}
                  aria-errormessage={form.formState.errors.title ? 'issue-title-error' : undefined}
                  maxLength={500}
                  placeholder={labels.titlePlaceholder}
                  {...form.register('title')}
                />
                <FieldError id="issue-title-error" errors={[form.formState.errors.title]} />
              </Field>

              <FieldGroup className="grid grid-cols-2 gap-4">
                <Controller
                  control={form.control}
                  name="projectId"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="issue-project">{labels.projectLabel}</FieldLabel>
                      <Select
                        items={[
                          ...(issueType === 'TEAM_TASK'
                            ? [{ label: labels.noProject, value: 'none' }]
                            : []),
                          ...projectItems.map((project) => ({
                            label: project.name,
                            value: project.id,
                          })),
                        ]}
                        value={field.value ?? (issueType === 'TEAM_TASK' ? 'none' : null)}
                        onValueChange={(value) => {
                          const projectId = value === 'none' || value === null ? null : value;
                          field.onChange(projectId);
                          form.setValue('projectRole', null, { shouldDirty: true });
                          form.setValue('parentIssueId', null, { shouldDirty: true });
                          form.setValue('teamId', '', { shouldDirty: true });
                          form.setValue('workflowStateId', '', { shouldDirty: true });
                          form.setValue('assigneeMembershipId', null, { shouldDirty: true });
                        }}
                      >
                        <SelectTrigger
                          ref={field.ref}
                          id="issue-project"
                          className="w-full"
                          aria-invalid={fieldState.invalid}
                          aria-errormessage={fieldState.invalid ? 'issue-project-error' : undefined}
                        >
                          <SelectValue
                            placeholder={
                              projects.isPending ? labels.optionsLoading : labels.projectPlaceholder
                            }
                          />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {issueType === 'TEAM_TASK' ? (
                              <SelectItem value="none">{labels.noProject}</SelectItem>
                            ) : null}
                            {projectItems.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldError id="issue-project-error" errors={[fieldState.error]} />
                    </Field>
                  )}
                />

                {issueType === 'FEATURE' ? (
                  <Controller
                    control={form.control}
                    name="featureStatus"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor="issue-feature-status">{labels.stateLabel}</FieldLabel>
                        <Select
                          items={FEATURE_STATUSES.map((status) => ({
                            label: labels.featureStatuses[status],
                            value: status,
                          }))}
                          value={field.value}
                          onValueChange={(value) => value && field.onChange(value)}
                        >
                          <SelectTrigger id="issue-feature-status" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {FEATURE_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {labels.featureStatuses[status]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  />
                ) : selectedProjectId ? (
                  <Controller
                    control={form.control}
                    name="projectRole"
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="issue-project-role">
                          {labels.projectRoleLabel}
                        </FieldLabel>
                        <Select
                          items={roleItems.map(({ role, team }) => ({
                            label: `${labels.projectRoles[role]} · ${team.name}`,
                            value: role,
                          }))}
                          value={field.value}
                          onValueChange={(value) => field.onChange(value)}
                        >
                          <SelectTrigger
                            ref={field.ref}
                            id="issue-project-role"
                            className="w-full"
                            aria-invalid={fieldState.invalid}
                            aria-errormessage={
                              fieldState.invalid ? 'issue-project-role-error' : undefined
                            }
                          >
                            <SelectValue placeholder={labels.projectRolePlaceholder} />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {roleItems.map(({ role, team }) => (
                                <SelectItem key={role} value={role}>
                                  {labels.projectRoles[role]} · {team.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldError id="issue-project-role-error" errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                ) : null}
              </FieldGroup>

              {issueType === 'TEAM_TASK' ? (
                <>
                  <FieldGroup className="grid grid-cols-2 gap-4">
                    <Controller
                      control={form.control}
                      name="teamId"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="issue-team">{labels.teamLabel}</FieldLabel>
                          <Select
                            items={teamItems.map((team) => ({ label: team.name, value: team.id }))}
                            value={field.value || null}
                            onValueChange={(value) => {
                              field.onChange(value ?? '');
                              form.setValue('workflowStateId', '', { shouldDirty: true });
                              form.setValue('assigneeMembershipId', null, { shouldDirty: true });
                              const team = teamItems.find((candidate) => candidate.id === value);
                              if (team) rememberTeamKey(team.key);
                            }}
                          >
                            <SelectTrigger
                              ref={field.ref}
                              id="issue-team"
                              className="w-full"
                              disabled={Boolean(selectedProjectId)}
                              aria-invalid={fieldState.invalid}
                              aria-errormessage={
                                fieldState.invalid ? 'issue-team-error' : undefined
                              }
                            >
                              <SelectValue
                                placeholder={
                                  selectedProjectId
                                    ? labels.teamLockedByRole
                                    : teams.isPending
                                      ? labels.optionsLoading
                                      : labels.teamPlaceholder
                                }
                              />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {teamItems.map((team) => (
                                  <SelectItem key={team.id} value={team.id}>
                                    {team.name} ({team.key})
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FieldError id="issue-team-error" errors={[fieldState.error]} />
                        </Field>
                      )}
                    />

                    <Controller
                      control={form.control}
                      name="workflowStateId"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="issue-state">{labels.stateLabel}</FieldLabel>
                          <Select
                            items={(workflowStates.data?.items ?? []).map((state) => ({
                              label: state.name,
                              value: state.id,
                            }))}
                            value={field.value || null}
                            onValueChange={(value) => field.onChange(value ?? '')}
                          >
                            <SelectTrigger
                              ref={field.ref}
                              id="issue-state"
                              className="w-full"
                              disabled={!selectedTeamId || workflowStates.isPending}
                              aria-invalid={fieldState.invalid}
                              aria-errormessage={
                                fieldState.invalid ? 'issue-state-error' : undefined
                              }
                            >
                              <SelectValue
                                placeholder={
                                  workflowStates.isPending
                                    ? labels.optionsLoading
                                    : labels.statePlaceholder
                                }
                              />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {(workflowStates.data?.items ?? []).map((state) => (
                                  <SelectItem key={state.id} value={state.id}>
                                    {state.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FieldError id="issue-state-error" errors={[fieldState.error]} />
                        </Field>
                      )}
                    />

                    <Controller
                      control={form.control}
                      name="assigneeMembershipId"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor="issue-assignee">{labels.assigneeLabel}</FieldLabel>
                          <Select
                            items={[
                              { label: labels.unassigned, value: 'unassigned' },
                              ...(members.data?.items ?? []).map((member) => ({
                                label: member.user.displayName,
                                value: member.id,
                              })),
                            ]}
                            value={field.value ?? 'unassigned'}
                            onValueChange={(value) =>
                              field.onChange(
                                value === 'unassigned' || value === null ? null : value,
                              )
                            }
                          >
                            <SelectTrigger
                              ref={field.ref}
                              id="issue-assignee"
                              className="w-full"
                              disabled={!selectedTeamId || members.isPending}
                              aria-invalid={fieldState.invalid}
                              aria-errormessage={
                                fieldState.invalid ? 'issue-assignee-error' : undefined
                              }
                            >
                              <SelectValue placeholder={labels.assigneePlaceholder} />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                <SelectItem value="unassigned">{labels.unassigned}</SelectItem>
                                {(members.data?.items ?? []).map((member) => (
                                  <SelectItem key={member.id} value={member.id}>
                                    {member.user.displayName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FieldError id="issue-assignee-error" errors={[fieldState.error]} />
                        </Field>
                      )}
                    />

                    {selectedProjectId ? (
                      <Controller
                        control={form.control}
                        name="parentIssueId"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor="issue-parent">{labels.parentLabel}</FieldLabel>
                            <Select
                              items={[
                                { label: labels.noParent, value: 'none' },
                                ...parentItems.map((parent) => ({
                                  label: `${parent.identifier} · ${parent.title}`,
                                  value: parent.id,
                                })),
                              ]}
                              value={field.value ?? 'none'}
                              onValueChange={(value) =>
                                field.onChange(value === 'none' || value === null ? null : value)
                              }
                            >
                              <SelectTrigger
                                ref={field.ref}
                                id="issue-parent"
                                className="w-full"
                                disabled={parentFeatures.isPending}
                                aria-invalid={fieldState.invalid}
                                aria-errormessage={
                                  fieldState.invalid ? 'issue-parent-error' : undefined
                                }
                              >
                                <SelectValue placeholder={labels.parentPlaceholder} />
                              </SelectTrigger>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectGroup>
                                  <SelectItem value="none">{labels.noParent}</SelectItem>
                                  {parentItems.map((parent) => (
                                    <SelectItem key={parent.id} value={parent.id}>
                                      {parent.identifier} · {parent.title}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <FieldError id="issue-parent-error" errors={[fieldState.error]} />
                          </Field>
                        )}
                      />
                    ) : null}
                  </FieldGroup>
                </>
              ) : null}

              <Controller
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="issue-priority">{labels.priorityLabel}</FieldLabel>
                    <Select
                      items={PRIORITIES.map((priority) => ({
                        label: labels.priorities[priority],
                        value: priority,
                      }))}
                      value={field.value}
                      onValueChange={(value) => value && field.onChange(value)}
                    >
                      <SelectTrigger id="issue-priority" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {PRIORITIES.map((priority) => (
                            <SelectItem key={priority} value={priority}>
                              {labels.priorities[priority]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="labelIds"
                render={({ field }) => (
                  <FieldSet>
                    <FieldLegend>{labels.labelsLabel}</FieldLegend>
                    {availableLabels.isError ? (
                      <p className="text-destructive text-sm">{labels.labelsUnavailable}</p>
                    ) : labelItems.length === 0 ? (
                      <p className="text-muted-foreground text-sm">{labels.noLabels}</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {labelItems.map((label) => {
                          const checked = field.value.includes(label.id);
                          return (
                            <label
                              key={label.id}
                              className="hover:bg-muted flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(nextChecked) =>
                                  field.onChange(
                                    nextChecked
                                      ? [...field.value, label.id]
                                      : field.value.filter((id) => id !== label.id),
                                  )
                                }
                              />
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full"
                                style={{ backgroundColor: label.color }}
                              />
                              <span className="truncate">{label.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </FieldSet>
                )}
              />

              <Controller
                control={form.control}
                name="descriptionMarkdown"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>{createT('descriptionLabel')}</FieldLabel>
                    <MarkdownEditor
                      charLimit={100_000}
                      disabled={mutation.isPending}
                      error={fieldState.error?.message ?? null}
                      labels={markdownEditorLabels(
                        (key) => markdownT(key as never),
                        (key) => String(markdownT.raw(key as never)),
                      )}
                      mentionOptions={mentionOptions}
                      value={field.value}
                      onCanSubmitChange={setDescriptionCanSubmit}
                      onChange={field.onChange}
                    />
                  </Field>
                )}
              />

              <Field data-invalid={Boolean(form.formState.errors.attachmentFileIds)}>
                <FieldLabel>{createT('attachmentsLabel')}</FieldLabel>
                <FileUploadQueue
                  disabled={mutation.isPending}
                  labels={fileUploadQueueLabels((key) => filesT(key as never))}
                  onFileIdsChange={setAttachmentFileIds}
                  onReadyChange={setAttachmentsReady}
                />
                <FieldError errors={[form.formState.errors.attachmentFileIds]} />
              </Field>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={requestClose}>
                {labels.cancel}
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !descriptionCanSubmit || !attachmentsReady}
              >
                {mutation.isPending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {labels.submit}
              </Button>
              <span className="text-muted-foreground mr-auto hidden self-center text-xs xl:block">
                {labels.shortcutHint}
              </span>
              {mutation.isPending ? (
                <span role="status" className="sr-only">
                  {labels.submitting}
                </span>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDiscardConfirmation} onOpenChange={setShowDiscardConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.keepEditing}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={() => {
                setShowDiscardConfirmation(false);
                onOpenChange(false);
              }}
            >
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
