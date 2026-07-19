'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, LayoutTemplate, Pencil, Plus, RotateCcw, ShieldX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  getIssueTemplatesControllerListQueryKey,
  useIssueTemplatesControllerArchive,
  useIssueTemplatesControllerCreate,
  useIssueTemplatesControllerList,
  useIssueTemplatesControllerRestore,
  useIssueTemplatesControllerUpdate,
  useMembersControllerList,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TemplateDescriptionEditor } from '@/features/collaboration/markdown-editor';
import { PRIORITY_PRESENTATION } from '@/features/issues/issue-attribute-presentation';
import { markdownEditorLabels } from '@/features/issues/issue-collaboration-labels';
import { useIssueTemplateTargetOptions } from '@/features/issues/issue-template-target-queries';
import { cn } from '@/lib/utils';

const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const NO_PROJECT = 'NO_PROJECT';
const NO_PROJECT_TEAM = 'NO_PROJECT_TEAM';

type TemplateTab = 'active' | 'archived';
type TemplateProjectOption = {
  id: string;
  name: string;
  projectTeams: Array<{
    active: boolean;
    id: string;
    team: { archived: boolean; key: string; name: string };
  }>;
};
type IssueTemplateSnapshot = {
  archived: boolean;
  available: boolean;
  descriptionMarkdown: string;
  id: string;
  initialProjectTeamId: string | null;
  labelIds: string[];
  name: string;
  priority: (typeof PRIORITIES)[number];
  projectId: string | null;
  unavailableReason: string | null;
  version: number;
};
type TemplateFormValues = {
  descriptionMarkdown: string;
  initialProjectTeamId: string;
  labelIds: string[];
  name: string;
  priority: (typeof PRIORITIES)[number];
  projectId: string;
};

export type IssueTemplateSettingsLabels = {
  activeTab: string;
  archive: string;
  archiveAction: string;
  archiveDescription: string;
  archiveErrorDescription: string;
  archiveErrorTitle: string;
  archiveTitle: string;
  archivedTab: string;
  archiving: string;
  cancel: string;
  conflictDescription: string;
  conflictTitle: string;
  createDescription: string;
  createTemplate: string;
  createTitle: string;
  description: string;
  descriptionHelp: string;
  descriptionLabel: string;
  descriptionRequired: string;
  discardChanges: string;
  discardDescription: string;
  discardTitle: string;
  edit: string;
  editDescription: string;
  editTitle: string;
  emptyActiveDescription: string;
  emptyActiveTitle: string;
  emptyArchivedDescription: string;
  emptyArchivedTitle: string;
  errorDescription: string;
  errorTitle: string;
  initialTeamLabel: string;
  initialTeamNone: string;
  labelsLabel: string;
  loading: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  nameTooLong: string;
  noLabels: string;
  noProject: string;
  optionsErrorDescription: string;
  optionsErrorTitle: string;
  permissionDescription: string;
  permissionTitle: string;
  priorities: Record<(typeof PRIORITIES)[number], string>;
  priorityLabel: string;
  projectLabel: string;
  repairDescription: string;
  reloadLatest: string;
  restore: string;
  restoreAction: string;
  restoreConflictDescription: string;
  restoreDescription: string;
  restoreErrorDescription: string;
  restoreErrorTitle: string;
  restoreTitle: string;
  restoring: string;
  retry: string;
  save: string;
  saveErrorDescription: string;
  saveErrorTitle: string;
  saving: string;
  tabsLabel: string;
  title: string;
  unavailable: string;
};

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('body' in error)) return null;
  const body = error.body;
  if (!body || typeof body !== 'object' || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}

function isForbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
  return status === 403 || ['FORBIDDEN', 'MEMBERSHIP_INACTIVE'].includes(getErrorCode(error) ?? '');
}

function formValues(
  template: IssueTemplateSnapshot | null,
  activeLabels: Array<{ id: string }>,
  projects: TemplateProjectOption[],
): TemplateFormValues {
  const project = template?.projectId
    ? projects.find((option) => option.id === template.projectId)
    : null;
  const activeLabelIds = new Set(activeLabels.map(({ id }) => id));
  return {
    descriptionMarkdown: template?.descriptionMarkdown ?? '',
    initialProjectTeamId: template?.initialProjectTeamId ?? NO_PROJECT_TEAM,
    labelIds: template ? template.labelIds.filter((id) => activeLabelIds.has(id)) : [],
    name: template?.name ?? '',
    priority: template?.priority ?? 'NONE',
    projectId: project?.id ?? NO_PROJECT,
  };
}

function TemplateRows({
  items,
  labels,
  onArchive,
  onEdit,
  onRestore,
  projectNames,
  projectTeamNames,
}: {
  items: IssueTemplateSnapshot[];
  labels: IssueTemplateSettingsLabels;
  onArchive: (template: IssueTemplateSnapshot) => void;
  onEdit: (template: IssueTemplateSnapshot) => void;
  onRestore: (template: IssueTemplateSnapshot) => void;
  projectNames: Map<string, string>;
  projectTeamNames: Map<string, string>;
}) {
  return (
    <ul className="border-t">
      {items.map((template) => (
        <li key={template.id} className="flex min-h-16 items-center gap-4 border-b py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{template.name}</span>
              {!template.archived && !template.available ? (
                <span className="bg-warning/10 text-warning rounded-full px-2 py-0.5 text-xs">
                  {labels.unavailable}
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {labels.priorities[template.priority]}
              {template.projectId
                ? ` · ${projectNames.get(template.projectId) ?? labels.unavailable}`
                : ''}
              {template.initialProjectTeamId
                ? ` · ${projectTeamNames.get(template.initialProjectTeamId) ?? labels.unavailable}`
                : ''}
              {template.labelIds.length > 0
                ? ` · ${labels.labelsLabel} ${template.labelIds.length}`
                : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!template.archived ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${template.name} ${labels.edit}`}
                  onClick={() => onEdit(template)}
                >
                  <Pencil data-icon="inline-start" aria-hidden="true" />
                  {labels.edit}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${template.name} ${labels.archive}`}
                  onClick={() => onArchive(template)}
                >
                  <Archive data-icon="inline-start" aria-hidden="true" />
                  {labels.archive}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${template.name} ${labels.restore}`}
                onClick={() => onRestore(template)}
              >
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                {labels.restore}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TemplateFormDialog({
  activeLabels,
  labels,
  mentionOptions,
  onClose,
  onSaved,
  projects,
  reloadLatest,
  template,
}: {
  activeLabels: Array<{ color: string; id: string; name: string }>;
  labels: IssueTemplateSettingsLabels;
  mentionOptions: Array<{ displayName: string; membershipId: string }>;
  onClose: () => void;
  onSaved: () => Promise<void>;
  projects: TemplateProjectOption[];
  reloadLatest: (id: string) => Promise<IssueTemplateSnapshot | null>;
  template: IssueTemplateSnapshot | null;
}) {
  const markdownT = useTranslations('Markdown');
  const editorLabels = markdownEditorLabels(
    (key) => markdownT(key as never),
    (key) => String(markdownT.raw(key as never)),
  );
  const schema = z.object({
    descriptionMarkdown: z.string().trim().min(1, labels.descriptionRequired),
    initialProjectTeamId: z.string(),
    labelIds: z.array(z.string()),
    name: z
      .string()
      .refine((value) => value.normalize('NFC').trim().length > 0, labels.nameRequired)
      .refine((value) => [...value.normalize('NFC').trim()].length <= 100, labels.nameTooLong),
    priority: z.enum(PRIORITIES),
    projectId: z.string(),
  });
  const form = useForm<TemplateFormValues>({
    defaultValues: formValues(template, activeLabels, projects),
    resolver: zodResolver(schema),
  });
  const createTemplate = useIssueTemplatesControllerCreate();
  const updateTemplate = useIssueTemplatesControllerUpdate();
  const [showDiscard, setShowDiscard] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latestTemplate, setLatestTemplate] = useState<IssueTemplateSnapshot | null>(null);
  const [version, setVersion] = useState(template?.version ?? 1);
  const projectId = useWatch({ control: form.control, name: 'projectId' });
  const labelIds = useWatch({ control: form.control, name: 'labelIds' });
  const descriptionMarkdown = useWatch({ control: form.control, name: 'descriptionMarkdown' });
  const priority = useWatch({ control: form.control, name: 'priority' });
  const initialProjectTeamId = useWatch({
    control: form.control,
    name: 'initialProjectTeamId',
  });
  const priorityOptions = PRIORITIES.map((value) => ({
    icon: PRIORITY_PRESENTATION[value].icon,
    iconClassName: PRIORITY_PRESENTATION[value].iconClassName,
    label: labels.priorities[value],
    value,
  }));
  const selectedProject = projects.find((project) => project.id === projectId);
  const availableProjectTeams =
    selectedProject?.projectTeams.filter(({ active, team }) => active && !team.archived) ?? [];
  const selectedUnavailableProjectTeam = selectedProject?.projectTeams.find(
    ({ id }) => id === initialProjectTeamId && !availableProjectTeams.some((item) => item.id === id),
  );
  const mutation = template ? updateTemplate : createTemplate;
  const isDirty = form.formState.isDirty;

  function requestClose() {
    if (isDirty) {
      setShowDiscard(true);
    } else {
      onClose();
    }
  }

  const submit = form.handleSubmit((values) => {
    setSaveError(false);
    setConflict(false);
    const normalizedProjectId = values.projectId === NO_PROJECT ? null : values.projectId;
    const data = {
      descriptionMarkdown: values.descriptionMarkdown.trim(),
      initialProjectTeamId:
        normalizedProjectId && values.initialProjectTeamId !== NO_PROJECT_TEAM
          ? values.initialProjectTeamId
          : null,
      labelIds: values.labelIds,
      name: values.name.normalize('NFC').trim(),
      priority: values.priority,
      projectId: normalizedProjectId,
    };
    const options = {
      onError: (error: unknown) => {
        if (getErrorCode(error) === 'VERSION_CONFLICT' && template) {
          setConflict(true);
          void reloadLatest(template.id).then(setLatestTemplate);
          return;
        }
        setSaveError(true);
      },
      onSuccess: async () => {
        await onSaved();
        onClose();
      },
    };

    if (template) {
      updateTemplate.mutate({ issueTemplateId: template.id, data: { ...data, version } }, options);
    } else {
      createTemplate.mutate({ data }, options);
    }
  });

  return (
    <>
      <Dialog open onOpenChange={(next) => !next && requestClose()}>
        <DialogContent
          closeLabel={labels.cancel}
          className="flex flex-col overflow-hidden sm:max-w-3xl"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{template ? labels.editTitle : labels.createTitle}</DialogTitle>
            <DialogDescription>
              {template ? labels.editDescription : labels.createDescription}
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={submit}>
            <div
              data-slot="dialog-scroll-body"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-5"
            >
              <div className="flex flex-col gap-5">
                {conflict ? (
                  <Alert>
                    <AlertTitle>{labels.conflictTitle}</AlertTitle>
                    <AlertDescription className="flex flex-col items-start gap-3">
                      <p>{labels.conflictDescription}</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!latestTemplate}
                        onClick={() => {
                          if (!latestTemplate) return;
                          form.reset(formValues(latestTemplate, activeLabels, projects));
                          setVersion(latestTemplate.version);
                          setConflict(false);
                          setLatestTemplate(null);
                        }}
                      >
                        {labels.reloadLatest}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {saveError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.saveErrorTitle}</AlertTitle>
                    <AlertDescription>{labels.saveErrorDescription}</AlertDescription>
                  </Alert>
                ) : null}
                {template && !template.available ? (
                  <Alert>
                    <AlertTitle>{labels.unavailable}</AlertTitle>
                    <AlertDescription>{labels.repairDescription}</AlertDescription>
                  </Alert>
                ) : null}
                <FieldGroup>
                  <Field data-invalid={Boolean(form.formState.errors.name)}>
                    <FieldLabel htmlFor="issue-template-name">{labels.nameLabel}</FieldLabel>
                    <Input
                      id="issue-template-name"
                      autoFocus
                      maxLength={100}
                      placeholder={labels.namePlaceholder}
                      aria-invalid={Boolean(form.formState.errors.name)}
                      {...form.register('name')}
                    />
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                  <Field data-invalid={Boolean(form.formState.errors.descriptionMarkdown)}>
                    <FieldLabel id="issue-template-description-label">
                      {labels.descriptionLabel}
                    </FieldLabel>
                    <FieldDescription>{labels.descriptionHelp}</FieldDescription>
                    <div aria-labelledby="issue-template-description-label">
                      <TemplateDescriptionEditor
                        boundedHeight
                        charLimit={100_000}
                        labels={editorLabels}
                        mentionOptions={mentionOptions}
                        value={descriptionMarkdown}
                        onChange={(next) =>
                          form.setValue('descriptionMarkdown', next, {
                            shouldDirty: true,
                            shouldValidate: form.formState.isSubmitted,
                          })
                        }
                      />
                    </div>
                    <FieldError errors={[form.formState.errors.descriptionMarkdown]} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel id="issue-template-priority-label">
                        {labels.priorityLabel}
                      </FieldLabel>
                      <Select
                        items={priorityOptions}
                        value={priority}
                        onValueChange={(next) =>
                          next &&
                          form.setValue('priority', next as TemplateFormValues['priority'], {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger
                          id="issue-template-priority"
                          aria-labelledby="issue-template-priority-label"
                          className="w-full"
                        >
                          <SelectValue>
                            {() => {
                              const selected = priorityOptions.find(
                                (option) => option.value === priority,
                              );
                              if (!selected) return null;
                              const Icon = selected.icon;
                              return (
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <Icon
                                    aria-hidden="true"
                                    className={cn('size-4 shrink-0', selected.iconClassName)}
                                  />
                                  <span className="truncate">{selected.label}</span>
                                </span>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {priorityOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                <option.icon
                                  aria-hidden="true"
                                  className={cn('size-4 shrink-0', option.iconClassName)}
                                />
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <FieldSet>
                    <FieldLegend variant="label">{labels.labelsLabel}</FieldLegend>
                    <div className="flex flex-wrap gap-3">
                      {activeLabels.length === 0 ? (
                        <span className="text-muted-foreground text-sm">{labels.noLabels}</span>
                      ) : (
                        activeLabels.map((label) => (
                          <Field key={label.id} orientation="horizontal" className="w-auto">
                            <Checkbox
                              id={`issue-template-label-${label.id}`}
                              checked={labelIds.includes(label.id)}
                              onCheckedChange={(checked) =>
                                form.setValue(
                                  'labelIds',
                                  checked
                                    ? [...labelIds, label.id]
                                    : labelIds.filter((id) => id !== label.id),
                                  { shouldDirty: true },
                                )
                              }
                            />
                            <FieldLabel htmlFor={`issue-template-label-${label.id}`}>
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: label.color }}
                              />
                              {label.name}
                            </FieldLabel>
                          </Field>
                        ))
                      )}
                    </div>
                  </FieldSet>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel id="issue-template-project-label">
                        {labels.projectLabel}
                      </FieldLabel>
                      <Select
                        items={[
                          { label: labels.noProject, value: NO_PROJECT },
                          ...projects.map((project) => ({
                            label: project.name,
                            value: project.id,
                          })),
                        ]}
                        value={projectId}
                        onValueChange={(next) => {
                          if (!next) return;
                          form.setValue('projectId', next, { shouldDirty: true });
                          form.setValue('initialProjectTeamId', NO_PROJECT_TEAM, {
                            shouldDirty: true,
                          });
                        }}
                      >
                        <SelectTrigger
                          id="issue-template-project"
                          aria-labelledby="issue-template-project-label"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={NO_PROJECT}>{labels.noProject}</SelectItem>
                            {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel id="issue-template-team-label">
                        {labels.initialTeamLabel}
                      </FieldLabel>
                      <Select
                        items={[
                          { label: labels.initialTeamNone, value: NO_PROJECT_TEAM },
                          ...availableProjectTeams.map((projectTeam) => ({
                            label: `${projectTeam.team.name} (${projectTeam.team.key})`,
                            value: projectTeam.id,
                          })),
                          ...(selectedUnavailableProjectTeam
                            ? [
                                {
                                  label: `${selectedUnavailableProjectTeam.team.name} · ${labels.unavailable}`,
                                  value: selectedUnavailableProjectTeam.id,
                                },
                              ]
                            : []),
                        ]}
                        value={initialProjectTeamId}
                        disabled={projectId === NO_PROJECT}
                        onValueChange={(next) =>
                          next &&
                          form.setValue('initialProjectTeamId', next, { shouldDirty: true })
                        }
                      >
                        <SelectTrigger
                          id="issue-template-team"
                          aria-labelledby="issue-template-team-label"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={NO_PROJECT_TEAM}>{labels.initialTeamNone}</SelectItem>
                            {availableProjectTeams.map((projectTeam) => (
                              <SelectItem key={projectTeam.id} value={projectTeam.id}>
                                {projectTeam.team.name} ({projectTeam.team.key})
                              </SelectItem>
                            ))}
                            {selectedUnavailableProjectTeam ? (
                              <SelectItem value={selectedUnavailableProjectTeam.id}>
                                {selectedUnavailableProjectTeam.team.name} · {labels.unavailable}
                              </SelectItem>
                            ) : null}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FieldGroup>
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button type="button" variant="outline" onClick={requestClose}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <>
                    <Spinner />
                    {labels.saving}
                  </>
                ) : (
                  labels.save
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={showDiscard} onOpenChange={setShowDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>{labels.discardChanges}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ArchiveTemplateDialog({
  labels,
  onClose,
  onReload,
  onSaved,
  template,
}: {
  labels: IssueTemplateSettingsLabels;
  onClose: () => void;
  onReload: (id: string) => Promise<IssueTemplateSnapshot | null>;
  onSaved: () => Promise<void>;
  template: IssueTemplateSnapshot;
}) {
  const archive = useIssueTemplatesControllerArchive();
  const [conflict, setConflict] = useState(false);
  const [latestTemplate, setLatestTemplate] = useState<IssueTemplateSnapshot | null>(null);

  function submit() {
    archive.mutate(
      { issueTemplateId: template.id, data: { version: template.version } },
      {
        onError: (error: unknown) => {
          if (getErrorCode(error) === 'VERSION_CONFLICT') {
            setConflict(true);
            void onReload(template.id).then(setLatestTemplate);
          }
        },
        onSuccess: async () => {
          await onSaved();
          onClose();
        },
      },
    );
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.archiveTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {labels.archiveDescription.replace('{name}', template.name)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict ? (
          <Alert>
            <AlertTitle>{labels.conflictTitle}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p>{labels.conflictDescription}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!latestTemplate}
                onClick={onClose}
              >
                {labels.reloadLatest}
              </Button>
            </AlertDescription>
          </Alert>
        ) : archive.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.archiveErrorTitle}</AlertTitle>
            <AlertDescription>{labels.archiveErrorDescription}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={archive.isPending || conflict} onClick={submit}>
            {archive.isPending ? <Spinner /> : null}
            {labels.archiveAction}
          </AlertDialogAction>
        </AlertDialogFooter>
        {archive.isPending ? (
          <span role="status" className="sr-only">
            {labels.archiving}
          </span>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RestoreTemplateDialog({
  labels,
  onClose,
  onReload,
  onSaved,
  template,
}: {
  labels: IssueTemplateSettingsLabels;
  onClose: () => void;
  onReload: (id: string) => Promise<IssueTemplateSnapshot | null>;
  onSaved: () => Promise<void>;
  template: IssueTemplateSnapshot;
}) {
  const restore = useIssueTemplatesControllerRestore();
  const [conflict, setConflict] = useState(false);
  const [latestTemplate, setLatestTemplate] = useState<IssueTemplateSnapshot | null>(null);

  function submit() {
    restore.mutate(
      { issueTemplateId: template.id, data: { version: template.version } },
      {
        onError: (error: unknown) => {
          if (getErrorCode(error) === 'VERSION_CONFLICT') {
            setConflict(true);
            void onReload(template.id).then(setLatestTemplate);
          }
        },
        onSuccess: async () => {
          await onSaved();
          onClose();
        },
      },
    );
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.restoreTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {labels.restoreDescription.replace('{name}', template.name)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict ? (
          <Alert>
            <AlertTitle>{labels.conflictTitle}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p>{labels.restoreConflictDescription}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!latestTemplate}
                onClick={onClose}
              >
                {labels.reloadLatest}
              </Button>
            </AlertDescription>
          </Alert>
        ) : restore.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.restoreErrorTitle}</AlertTitle>
            <AlertDescription>{labels.restoreErrorDescription}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={restore.isPending || conflict} onClick={submit}>
            {restore.isPending ? <Spinner /> : null}
            {labels.restoreAction}
          </AlertDialogAction>
        </AlertDialogFooter>
        {restore.isPending ? (
          <span role="status" className="sr-only">
            {labels.restoring}
          </span>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function IssueTemplateSettingsScreen({ labels }: { labels: IssueTemplateSettingsLabels }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TemplateTab>('active');
  const [formTemplate, setFormTemplate] = useState<IssueTemplateSnapshot | null | undefined>();
  const [archiveTemplate, setArchiveTemplate] = useState<IssueTemplateSnapshot | null>(null);
  const [restoreTemplate, setRestoreTemplate] = useState<IssueTemplateSnapshot | null>(null);
  const templates = useIssueTemplatesControllerList(
    { includeArchived: true },
    { query: { retry: false } },
  );
  const { labels: labelsQuery, projects: projectsQuery } = useIssueTemplateTargetOptions();
  const membersQuery = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { retry: false } },
  );
  const items = (templates.data?.items ?? []) as IssueTemplateSnapshot[];
  const visibleItems = items.filter((template) =>
    tab === 'archived' ? template.archived : !template.archived,
  );
  const projects = useMemo(
    () =>
      (projectsQuery.data?.items ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        projectTeams: project.projectTeams,
      })),
    [projectsQuery.data?.items],
  );
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectTeamNames = useMemo(
    () =>
      new Map(
        projects.flatMap((project) =>
          project.projectTeams.map((projectTeam) => [projectTeam.id, projectTeam.team.name] as const),
        ),
      ),
    [projects],
  );
  const activeLabels = useMemo(
    () =>
      (labelsQuery.data?.items ?? [])
        .filter((label) => !label.archived)
        .map((label) => ({ color: label.color, id: label.id, name: label.name })),
    [labelsQuery.data?.items],
  );
  const mentionOptions = useMemo(
    () =>
      (membersQuery.data?.items ?? []).map((member) => ({
        displayName: member.user.displayName,
        membershipId: member.id,
      })),
    [membersQuery.data?.items],
  );

  async function reloadTemplates() {
    await queryClient.invalidateQueries({ queryKey: getIssueTemplatesControllerListQueryKey() });
  }

  async function reloadLatest(id: string) {
    const result = await templates.refetch();
    if (result.isError || !result.data) return null;
    return (
      ((result.data?.items ?? []) as IssueTemplateSnapshot[]).find(
        (template) => template.id === id,
      ) ?? null
    );
  }

  const optionsPending =
    (labelsQuery.isPending && !labelsQuery.data) ||
    (projectsQuery.isPending && !projectsQuery.data) ||
    (membersQuery.isPending && !membersQuery.data);
  const optionsError = labelsQuery.isError || projectsQuery.isError || membersQuery.isError;
  const optionsUnavailable =
    (labelsQuery.isError && !labelsQuery.data) ||
    (projectsQuery.isError && !projectsQuery.data) ||
    (membersQuery.isError && !membersQuery.data);

  if ((templates.isPending && !templates.data) || optionsPending) {
    return <ContentLoading label={labels.loading} />;
  }
  if (isForbidden(templates.error)) {
    return (
      <ContentEmpty
        icon={ShieldX}
        title={labels.permissionTitle}
        description={labels.permissionDescription}
        headingLevel={1}
      />
    );
  }
  if (templates.isError && !templates.data) {
    return (
      <ContentError
        headingLevel={1}
        title={labels.errorTitle}
        description={labels.errorDescription}
        retryLabel={labels.retry}
        onRetry={() => void templates.refetch()}
      />
    );
  }
  if (optionsUnavailable) {
    return (
      <ContentError
        headingLevel={1}
        title={labels.optionsErrorTitle}
        description={labels.optionsErrorDescription}
        retryLabel={labels.retry}
        onRetry={() => {
          if (labelsQuery.isError) void labelsQuery.refetch();
          if (projectsQuery.isError) void projectsQuery.refetch();
          if (membersQuery.isError) void membersQuery.refetch();
        }}
      />
    );
  }
  const empty = visibleItems.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading title={labels.title} description={labels.description} />
      {templates.isError ? (
        <ContentError
          title={labels.errorTitle}
          description={labels.errorDescription}
          retryLabel={labels.retry}
          onRetry={() => void templates.refetch()}
        />
      ) : null}
      {optionsError ? (
        <ContentError
          title={labels.optionsErrorTitle}
          description={labels.optionsErrorDescription}
          retryLabel={labels.retry}
          onRetry={() => {
            if (labelsQuery.isError) void labelsQuery.refetch();
            if (projectsQuery.isError) void projectsQuery.refetch();
            if (membersQuery.isError) void membersQuery.refetch();
          }}
        />
      ) : null}
      <div className="flex justify-end">
        <Button type="button" onClick={() => setFormTemplate(null)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {labels.createTemplate}
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TemplateTab)}
        aria-label={labels.tabsLabel}
      >
        <TabsList>
          <TabsTrigger value="active">{labels.activeTab}</TabsTrigger>
          <TabsTrigger value="archived">{labels.archivedTab}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {empty ? (
            <ContentEmpty
              icon={tab === 'active' ? LayoutTemplate : Archive}
              title={tab === 'active' ? labels.emptyActiveTitle : labels.emptyArchivedTitle}
              description={
                tab === 'active' ? labels.emptyActiveDescription : labels.emptyArchivedDescription
              }
            >
              {tab === 'active' ? (
                <Button type="button" onClick={() => setFormTemplate(null)}>
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  {labels.createTemplate}
                </Button>
              ) : null}
            </ContentEmpty>
          ) : (
            <TemplateRows
              items={visibleItems}
              labels={labels}
              onArchive={setArchiveTemplate}
              onEdit={setFormTemplate}
              onRestore={setRestoreTemplate}
              projectNames={projectNames}
              projectTeamNames={projectTeamNames}
            />
          )}
        </TabsContent>
      </Tabs>
      {formTemplate !== undefined ? (
        <TemplateFormDialog
          key={formTemplate?.id ?? 'create'}
          activeLabels={activeLabels}
          labels={labels}
          mentionOptions={mentionOptions}
          onClose={() => setFormTemplate(undefined)}
          onSaved={reloadTemplates}
          projects={projects}
          reloadLatest={reloadLatest}
          template={formTemplate}
        />
      ) : null}
      {archiveTemplate ? (
        <ArchiveTemplateDialog
          labels={labels}
          onClose={() => setArchiveTemplate(null)}
          onReload={reloadLatest}
          onSaved={reloadTemplates}
          template={archiveTemplate}
        />
      ) : null}
      {restoreTemplate ? (
        <RestoreTemplateDialog
          labels={labels}
          onClose={() => setRestoreTemplate(null)}
          onReload={reloadLatest}
          onSaved={reloadTemplates}
          template={restoreTemplate}
        />
      ) : null}
    </div>
  );
}
