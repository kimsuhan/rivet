'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, FolderKanbanIcon, LayoutTemplateIcon, TagIcon, UsersIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  getIssueTemplatesControllerListQueryKey,
  getLabelsControllerListQueryKey,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  useIssuesControllerCreate,
  useIssueTemplatesControllerApply,
  useIssueTemplatesControllerList,
  useMembersControllerList,
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
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { IssueDescriptionEditor } from '@/features/collaboration/markdown-editor';
import { FileUploadQueue } from '@/features/files/file-upload-queue';
import { captureProductEvent } from '@/features/product-events/capture-product-event';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { PRIORITY_PRESENTATION } from './issue-attribute-presentation';
import { fileUploadQueueLabels, markdownEditorLabels } from './issue-collaboration-labels';
import { useIssueTemplateTargetOptions } from './issue-template-target-queries';
import { issueWorkHref } from './issue-work-routing';

const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const NO_TEMPLATE = 'NO_TEMPLATE';

type TemplateTargetField = 'description' | 'initialTeams' | 'labels' | 'priority' | 'project';
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

export type IssueCreateSeed = { projectId?: string };

export type IssueCreateLabels = {
  cancel: string;
  close: string;
  description: string;
  descriptionLabel: string;
  discardChanges: string;
  discardDescription: string;
  discardTitle: string;
  errorDescription: string;
  errorTitle: string;
  initialTeamsDescription: string;
  initialTeamsEmpty: string;
  initialTeamsLabel: string;
  initialTeamsNoProject: string;
  initialTeamsToolbarLabel: string;
  labelsLabel: string;
  noLabels: string;
  optionsErrorDescription: string;
  optionsErrorTitle: string;
  optionsLoading: string;
  overwriteCancel: string;
  overwriteConfirm: string;
  overwriteDescription: string;
  overwriteFields: Record<TemplateTargetField, string>;
  overwriteTitle: string;
  priorities: Record<(typeof PRIORITIES)[number], string>;
  priorityLabel: string;
  projectLabel: string;
  projectPlaceholder: string;
  projectRequired: string;
  submit: string;
  submitting: string;
  templateApplying: string;
  templateEmpty: string;
  templateLabel: string;
  templateNone: string;
  templateNoticeDescription: string;
  templateNoticeTitle: string;
  templateUnavailableNoticeDescription: string;
  templateUnavailableNoticeTitle: string;
  templatePlaceholder: string;
  templateTrigger: string;
  templateUnavailable: string;
  title: string;
  titleLabel: string;
  titlePlaceholder: string;
  titleRequired: string;
};

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('body' in error)) return null;
  const body = error.body;
  if (!body || typeof body !== 'object' || !('code' in body)) return null;
  return typeof body.code === 'string' ? body.code : null;
}

function isTemplateStaleError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === 'VERSION_CONFLICT' ||
    code === 'ISSUE_TEMPLATE_UNAVAILABLE' ||
    code === 'ISSUE_TEMPLATE_TARGET_UNAVAILABLE'
  );
}

function handlePopoverOptionsKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

  const current = (event.target as HTMLElement).closest<HTMLElement>('[data-issue-create-option]');
  if (!current) return;

  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[data-issue-create-option]'),
  ).filter(
    (option) => !option.hasAttribute('disabled') && option.getAttribute('aria-disabled') !== 'true',
  );
  if (options.length === 0) return;

  event.preventDefault();
  const currentIndex = options.indexOf(current);
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length;
  options[nextIndex]?.focus();
}

export function GlobalIssueCreate({
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
  const filesT = useTranslations('Files');
  const markdownT = useTranslations('Markdown');
  const editorLabels = markdownEditorLabels(
    (key) => markdownT(key as never),
    (key) => String(markdownT.raw(key as never)),
  );
  const queryClient = useQueryClient();
  const router = useRouter();
  const { labels: labelsQuery, projects } = useIssueTemplateTargetOptions({ enabled: open });
  const members = useMembersControllerList(
    { limit: 100, status: 'ACTIVE' },
    { query: { enabled: open, retry: false } },
  );
  const templates = useIssueTemplatesControllerList(undefined, {
    query: { enabled: open, retry: false },
  });
  const applyTemplate = useIssueTemplatesControllerApply();
  const create = useIssuesControllerCreate();
  const [title, setTitle] = useState('');
  const [descriptionMarkdown, setDescriptionMarkdown] = useState('');
  const [projectId, setProjectId] = useState(seed?.projectId ?? '');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('MEDIUM');
  const [initialTeamIds, setInitialTeamIds] = useState<string[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);
  const [filesReady, setFilesReady] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [appliedTemplate, setAppliedTemplate] = useState<{ id: string; version: number } | null>(
    null,
  );
  const [pendingTemplate, setPendingTemplate] = useState<IssueTemplateSnapshot | null>(null);
  const [overwriteFields, setOverwriteFields] = useState<TemplateTargetField[]>([]);
  const [templateNotice, setTemplateNotice] = useState(false);
  const [templateSelectionRequired, setTemplateSelectionRequired] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateApplyError, setTemplateApplyError] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const [openPopover, setOpenPopover] = useState<
    'initialTeams' | 'labels' | 'priority' | 'project' | 'template' | null
  >(null);
  const dirtyTemplateFields = useRef(
    new Set<TemplateTargetField>(seed?.projectId ? ['project'] : []),
  );
  const copiedTemplateFields = useRef(new Set<TemplateTargetField>());
  const applyInFlight = useRef(false);
  const suppressCreateClose = useRef(false);
  const templateTriggerRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const projectOptions = useMemo(
    () =>
      (projects.data?.items ?? []).map((project) => ({ label: project.name, value: project.id })),
    [projects.data?.items],
  );
  const priorityOptions = useMemo(
    () =>
      PRIORITIES.map((value) => ({
        icon: PRIORITY_PRESENTATION[value].icon,
        iconClassName: PRIORITY_PRESENTATION[value].iconClassName,
        label: labels.priorities[value],
        value,
      })),
    [labels.priorities],
  );
  const mentionOptions = useMemo(
    () =>
      (members.data?.items ?? []).map((member) => ({
        displayName: member.user.displayName,
        membershipId: member.id,
      })),
    [members.data?.items],
  );
  const templateItems = (templates.data?.items ?? []) as IssueTemplateSnapshot[];
  const hasTemplates = templateItems.length > 0;
  const selectedProject = projects.data?.items.find((project) => project.id === projectId);
  const projectTeamsById = useMemo(
    () => new Map((selectedProject?.projectTeams ?? []).map((item) => [item.id, item])),
    [selectedProject],
  );
  const availableProjectTeams = useMemo(
    () =>
      new Map(
        (selectedProject?.projectTeams ?? [])
          .filter(({ active, team }) => active && !team.archived)
          .map((projectTeam) => [projectTeam.id, projectTeam]),
      ),
    [selectedProject],
  );
  const unavailableSelectedTeamIds = initialTeamIds.filter(
    (projectTeamId) => !availableProjectTeams.has(projectTeamId),
  );
  const setFileIds = useCallback((ids: string[]) => setAttachmentFileIds(ids), []);

  useEffect(() => {
    if (!templateNotice || templates.isPending || hasTemplates) return;
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [hasTemplates, templateNotice, templates.isPending]);

  function markTemplateFieldDirty(field: TemplateTargetField) {
    dirtyTemplateFields.current.add(field);
    copiedTemplateFields.current.delete(field);
  }

  function clearTemplateMetadata() {
    setOpenPopover(null);
    setSelectedTemplateId('');
    setAppliedTemplate(null);
    setPendingTemplate(null);
    setOverwriteFields([]);
    requestAnimationFrame(() => (templateTriggerRef.current ?? titleInputRef.current)?.focus());
  }

  const cancelTemplateOverwrite = useCallback(() => {
    if (applyInFlight.current) return;
    suppressCreateClose.current = true;
    queueMicrotask(() => {
      suppressCreateClose.current = false;
    });
    setPendingTemplate(null);
    setOverwriteFields([]);
  }, []);

  useEffect(() => {
    if (!pendingTemplate) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelTemplateOverwrite();
    };
    document.addEventListener('keydown', cancelOnEscape, true);
    return () => document.removeEventListener('keydown', cancelOnEscape, true);
  }, [cancelTemplateOverwrite, pendingTemplate]);

  async function preserveInputsAndRequestReselection() {
    clearTemplateMetadata();
    setTemplateNotice(true);
    setTemplateSelectionRequired(true);
    setTemplateApplyError(false);
    setOpenPopover(null);
    setApplyingTemplate(true);
    applyTemplate.reset();
    create.reset();
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getIssueTemplatesControllerListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getLabelsControllerListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getProjectsControllerListQueryKey() }),
      ]);
    } finally {
      if (!applyInFlight.current) setApplyingTemplate(false);
    }
  }

  function reset() {
    setTitle('');
    setDescriptionMarkdown('');
    setProjectId(seed?.projectId ?? '');
    setPriority('MEDIUM');
    setInitialTeamIds([]);
    setLabelIds([]);
    setAttachmentFileIds([]);
    setFilesReady(true);
    setShowErrors(false);
    setSelectedTemplateId('');
    setAppliedTemplate(null);
    setPendingTemplate(null);
    setOverwriteFields([]);
    setTemplateNotice(false);
    setTemplateSelectionRequired(false);
    setTemplateApplyError(false);
    setShowDiscardConfirmation(false);
    dirtyTemplateFields.current.clear();
    if (seed?.projectId) dirtyTemplateFields.current.add('project');
    copiedTemplateFields.current.clear();
    suppressCreateClose.current = false;
    applyTemplate.reset();
    create.reset();
  }

  const hasUnsavedChanges =
    title.length > 0 ||
    descriptionMarkdown.length > 0 ||
    projectId !== (seed?.projectId ?? '') ||
    priority !== 'MEDIUM' ||
    initialTeamIds.length > 0 ||
    labelIds.length > 0 ||
    attachmentFileIds.length > 0 ||
    !filesReady ||
    selectedTemplateId.length > 0 ||
    appliedTemplate !== null;

  function discardAndClose() {
    if (applyInFlight.current) return;
    reset();
    onOpenChange(false);
  }

  function requestClose() {
    if (applyInFlight.current) return;
    if (hasUnsavedChanges) {
      setShowDiscardConfirmation(true);
      return;
    }
    discardAndClose();
  }

  async function apply(snapshot: IssueTemplateSnapshot) {
    if (applyInFlight.current) return;
    if (!snapshot.available || snapshot.archived) {
      void preserveInputsAndRequestReselection();
      return;
    }

    applyInFlight.current = true;
    setApplyingTemplate(true);
    setTemplateApplyError(false);
    applyTemplate.reset();
    try {
      const result = (await applyTemplate.mutateAsync({
        issueTemplateId: snapshot.id,
        data: { version: snapshot.version },
      })) as IssueTemplateSnapshot;
      setDescriptionMarkdown(result.descriptionMarkdown);
      setPriority(result.priority);
      setLabelIds([...result.labelIds]);
      dirtyTemplateFields.current.delete('description');
      dirtyTemplateFields.current.delete('priority');
      dirtyTemplateFields.current.delete('labels');
      copiedTemplateFields.current.add('description');
      copiedTemplateFields.current.add('priority');
      if (result.labelIds.length > 0) copiedTemplateFields.current.add('labels');
      else copiedTemplateFields.current.delete('labels');
      if (result.projectId) {
        setProjectId(result.projectId);
        setInitialTeamIds(result.initialProjectTeamId ? [result.initialProjectTeamId] : []);
        dirtyTemplateFields.current.delete('project');
        dirtyTemplateFields.current.delete('initialTeams');
        copiedTemplateFields.current.add('project');
        if (result.initialProjectTeamId) copiedTemplateFields.current.add('initialTeams');
        else copiedTemplateFields.current.delete('initialTeams');
      }
      setSelectedTemplateId(result.id);
      setAppliedTemplate({ id: result.id, version: result.version });
      captureProductEvent('issue_template_applied', { templateId: result.id });
      setTemplateNotice(false);
      setTemplateSelectionRequired(false);
      setPendingTemplate(null);
      setOverwriteFields([]);
    } catch (error) {
      if (isTemplateStaleError(error)) {
        await preserveInputsAndRequestReselection();
      } else {
        setPendingTemplate(null);
        setOverwriteFields([]);
        setTemplateApplyError(true);
        requestAnimationFrame(() => templateTriggerRef.current?.focus());
      }
    } finally {
      applyInFlight.current = false;
      setApplyingTemplate(false);
    }
  }

  function selectTemplate(next: string | null) {
    if (!next || next === NO_TEMPLATE) {
      clearTemplateMetadata();
      setTemplateNotice(false);
      setTemplateSelectionRequired(false);
      return;
    }

    const snapshot = templateItems.find((template) => template.id === next);
    if (!snapshot || !snapshot.available || snapshot.archived) {
      void preserveInputsAndRequestReselection();
      return;
    }
    if (appliedTemplate?.id === snapshot.id && appliedTemplate.version === snapshot.version) return;

    const targets: TemplateTargetField[] = ['description', 'priority', 'labels'];
    if (snapshot.projectId) targets.push('project', 'initialTeams');
    const changesCurrentValue: Record<TemplateTargetField, boolean> = {
      description: snapshot.descriptionMarkdown !== descriptionMarkdown,
      initialTeams:
        snapshot.projectId !== null &&
        (initialTeamIds.length !== (snapshot.initialProjectTeamId ? 1 : 0) ||
          (snapshot.initialProjectTeamId
            ? initialTeamIds[0] !== snapshot.initialProjectTeamId
            : false)),
      labels:
        labelIds.length !== snapshot.labelIds.length ||
        labelIds.some((id) => !snapshot.labelIds.includes(id)),
      priority: priority !== snapshot.priority,
      project: snapshot.projectId !== null && projectId !== snapshot.projectId,
    };
    const dirtyTargets = targets.filter(
      (field) =>
        (copiedTemplateFields.current.has(field) || dirtyTemplateFields.current.has(field)) &&
        changesCurrentValue[field],
    );
    if (dirtyTargets.length > 0) {
      setPendingTemplate(snapshot);
      setOverwriteFields(dirtyTargets);
      return;
    }

    void apply(snapshot);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (templateSelectionRequired) return;
    if (!title.trim() || !projectId || !filesReady) {
      setShowErrors(true);
      return;
    }

    try {
      const result = await create.mutateAsync({
        data: {
          ...(appliedTemplate ? { appliedTemplate } : {}),
          attachmentFileIds,
          descriptionMarkdown: descriptionMarkdown.trim() || null,
          initialTeams: initialTeamIds.map((projectTeamId) => ({ projectTeamId })),
          labelIds,
          priority,
          projectId,
          title: title.trim(),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getProjectsControllerListQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getProjectsControllerGetQueryKey(projectId) }),
      ]);
      queryClient.setQueryData(getIssuesControllerGetQueryKey(result.issue.id), result.issue);
      queryClient.setQueryData(
        getIssuesControllerGetQueryKey(result.issue.identifier),
        result.issue,
      );
      reset();
      onOpenChange(false);
      const selected = result.createdTeamWorks[0];
      router.push(issueWorkHref(result.issue.identifier, selected?.identifier));
    } catch (error) {
      if (isTemplateStaleError(error)) await preserveInputsAndRequestReselection();
    }
  }

  const optionError = projects.isError || labelsQuery.isError || templates.isError;
  const templateApplyPending = applyingTemplate || applyTemplate.isPending;
  const templateSelectionUnavailable = templateNotice && !templates.isPending && !hasTemplates;
  const activeLabels = (labelsQuery.data?.items ?? []).filter((label) => !label.archived);
  const activeLabelIds = new Set(activeLabels.map((label) => label.id));
  const unavailableSelectedLabelIds = labelIds.filter((id) => !activeLabelIds.has(id));
  const selectedTemplate = templateItems.find((template) => template.id === selectedTemplateId);
  const selectedPriority = {
    icon: PRIORITY_PRESENTATION[priority].icon,
    iconClassName: PRIORITY_PRESENTATION[priority].iconClassName,
    label: labels.priorities[priority],
  };
  const selectedTeamLabels = initialTeamIds.map(
    (projectTeamId) => projectTeamsById.get(projectTeamId)?.team.name ?? projectTeamId,
  );
  const templateTriggerText = selectedTemplate
    ? `${labels.templateTrigger}: ${selectedTemplate.name}`
    : labels.templateTrigger;
  const priorityTriggerText = `${labels.priorityLabel}: ${selectedPriority.label}`;
  const projectTriggerText = selectedProject
    ? `${labels.projectLabel}: ${selectedProject.name}`
    : labels.projectLabel;
  const labelsTriggerText = labelIds.length
    ? `${labels.labelsLabel}: ${labelIds.length}`
    : labels.labelsLabel;
  const initialTeamsTriggerText =
    selectedTeamLabels.length === 1
      ? `${labels.initialTeamsToolbarLabel}: ${selectedTeamLabels[0]}`
      : selectedTeamLabels.length > 1
        ? `${labels.initialTeamsToolbarLabel}: ${selectedTeamLabels.length}`
        : labels.initialTeamsToolbarLabel;
  const toolbarTriggerClassName = buttonVariants({ size: 'sm', variant: 'outline' });
  const overwriteDescription = labels.overwriteDescription.replace(
    '{fields}',
    overwriteFields.map((field) => labels.overwriteFields[field]).join(', '),
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && (pendingTemplate || suppressCreateClose.current || applyInFlight.current)) {
            return;
          }
          if (!next) {
            requestClose();
            return;
          }
          onOpenChange(true);
        }}
      >
        <DialogContent
          closeLabel={labels.close}
          className="flex flex-col overflow-hidden sm:max-w-2xl"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <form
            aria-busy={create.isPending || templateApplyPending}
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => void submit(event)}
          >
            <div
              data-slot="dialog-scroll-body"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 pb-5"
            >
              <div className="flex flex-col gap-5">
                {optionError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.optionsErrorTitle}</AlertTitle>
                    <AlertDescription>{labels.optionsErrorDescription}</AlertDescription>
                  </Alert>
                ) : null}
                {create.isError && !isTemplateStaleError(create.error) ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.errorTitle}</AlertTitle>
                    <AlertDescription>{labels.errorDescription}</AlertDescription>
                  </Alert>
                ) : null}
                {templateApplyError ||
                (applyTemplate.isError && !isTemplateStaleError(applyTemplate.error)) ? (
                  <Alert variant="destructive">
                    <AlertTitle>{labels.errorTitle}</AlertTitle>
                    <AlertDescription>{labels.errorDescription}</AlertDescription>
                  </Alert>
                ) : null}
                {templateNotice ? (
                  <Alert role="alert">
                    <AlertTitle>
                      {templateSelectionUnavailable
                        ? labels.templateUnavailableNoticeTitle
                        : labels.templateNoticeTitle}
                    </AlertTitle>
                    <AlertDescription className="flex flex-col items-start gap-2">
                      <span>
                        {templateSelectionUnavailable
                          ? labels.templateUnavailableNoticeDescription
                          : labels.templateNoticeDescription}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={templateApplyPending}
                        onClick={() => selectTemplate(NO_TEMPLATE)}
                      >
                        {labels.templateNone}
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex flex-col gap-2">
                  {hasTemplates ? (
                    <>
                      <span id="issue-create-template-label" className="sr-only">
                        {templateTriggerText}
                      </span>
                      <Popover
                        open={openPopover === 'template'}
                        onOpenChange={(next) => setOpenPopover(next ? 'template' : null)}
                      >
                        <PopoverTrigger
                          ref={templateTriggerRef}
                          type="button"
                          id="issue-create-template"
                          aria-labelledby="issue-create-template-label"
                          aria-busy={templateApplyPending || undefined}
                          className={cn(toolbarTriggerClassName, 'w-fit max-w-full')}
                          disabled={templateApplyPending}
                        >
                          {templateApplyPending ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <LayoutTemplateIcon data-icon="inline-start" />
                          )}
                          <span className="truncate">{templateTriggerText}</span>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-64 gap-0 p-1"
                          aria-labelledby="issue-create-template-popover-title"
                        >
                          <PopoverTitle
                            id="issue-create-template-popover-title"
                            className="sr-only"
                          >
                            {labels.templateLabel}
                          </PopoverTitle>
                          <div
                            role="listbox"
                            aria-labelledby="issue-create-template-popover-title"
                            className="max-h-64 overflow-y-auto"
                            onKeyDown={handlePopoverOptionsKeyDown}
                          >
                            <Button
                              type="button"
                              role="option"
                              aria-selected={!selectedTemplateId}
                              data-issue-create-option
                              variant="ghost"
                              className="w-full justify-start"
                              onClick={() => {
                                setOpenPopover(null);
                                selectTemplate(NO_TEMPLATE);
                              }}
                            >
                              <LayoutTemplateIcon data-icon="inline-start" />
                              {labels.templateNone}
                              {!selectedTemplateId ? (
                                <CheckIcon data-icon="inline-end" className="ml-auto" />
                              ) : null}
                            </Button>
                            {templateItems.map((template) => {
                              const unavailable = !template.available || template.archived;
                              return (
                                <Button
                                  key={template.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selectedTemplateId === template.id}
                                  data-issue-create-option
                                  variant="ghost"
                                  className="h-auto min-h-9 w-full justify-start whitespace-normal"
                                  disabled={unavailable}
                                  onClick={() => {
                                    setOpenPopover(null);
                                    selectTemplate(template.id);
                                  }}
                                >
                                  <LayoutTemplateIcon data-icon="inline-start" />
                                  <span className="flex min-w-0 flex-1 flex-col items-start">
                                    <span className="truncate">{template.name}</span>
                                    {unavailable ? (
                                      <span className="text-muted-foreground text-xs font-normal">
                                        {labels.templateUnavailable}
                                      </span>
                                    ) : null}
                                  </span>
                                  {selectedTemplateId === template.id ? (
                                    <CheckIcon data-icon="inline-end" className="ml-auto" />
                                  ) : null}
                                </Button>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <label className="sr-only" htmlFor="issue-create-title">
                      {labels.titleLabel}
                    </label>
                    <Input
                      ref={titleInputRef}
                      id="issue-create-title"
                      autoFocus
                      className="h-12 border-transparent bg-transparent px-2 text-xl font-semibold shadow-none md:text-xl lg:h-12"
                      maxLength={500}
                      value={title}
                      placeholder={labels.titlePlaceholder}
                      aria-invalid={showErrors && !title.trim()}
                      aria-describedby={
                        showErrors && !title.trim() ? 'issue-create-title-error' : undefined
                      }
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    {showErrors && !title.trim() ? (
                      <span id="issue-create-title-error" className="text-destructive text-xs">
                        {labels.titleRequired}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2 text-sm font-medium">
                  <span id="issue-create-description-label">{labels.descriptionLabel}</span>
                  <IssueDescriptionEditor
                    boundedHeight
                    charLimit={100_000}
                    disabled={templateApplyPending}
                    labels={editorLabels}
                    mentionOptions={mentionOptions}
                    onChange={(next) => {
                      markTemplateFieldDirty('description');
                      setDescriptionMarkdown(next);
                    }}
                    value={descriptionMarkdown}
                  />
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <span id="issue-create-priority-label" className="sr-only">
                    {priorityTriggerText}
                  </span>
                  <Popover
                    open={openPopover === 'priority'}
                    onOpenChange={(next) => setOpenPopover(next ? 'priority' : null)}
                  >
                    <PopoverTrigger
                      type="button"
                      id="issue-create-priority"
                      aria-labelledby="issue-create-priority-label"
                      className={toolbarTriggerClassName}
                      disabled={templateApplyPending}
                    >
                      <selectedPriority.icon
                        data-icon="inline-start"
                        className={selectedPriority.iconClassName}
                      />
                      {priorityTriggerText}
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-56 gap-0 p-1"
                      aria-labelledby="issue-create-priority-popover-title"
                    >
                      <PopoverTitle id="issue-create-priority-popover-title" className="sr-only">
                        {labels.priorityLabel}
                      </PopoverTitle>
                      <div
                        role="listbox"
                        aria-labelledby="issue-create-priority-popover-title"
                        onKeyDown={handlePopoverOptionsKeyDown}
                      >
                        {priorityOptions.map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={priority === option.value}
                            data-issue-create-option
                            variant="ghost"
                            className="w-full justify-start"
                            onClick={() => {
                              markTemplateFieldDirty('priority');
                              setPriority(option.value);
                              setOpenPopover(null);
                            }}
                          >
                            <option.icon
                              data-icon="inline-start"
                              className={option.iconClassName}
                            />
                            {option.label}
                            {priority === option.value ? (
                              <CheckIcon data-icon="inline-end" className="ml-auto" />
                            ) : null}
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <div className="flex flex-col items-start gap-1 sm:relative">
                    <span id="issue-create-project-label" className="sr-only">
                      {projectTriggerText}
                    </span>
                    <Popover
                      open={openPopover === 'project'}
                      onOpenChange={(next) => setOpenPopover(next ? 'project' : null)}
                    >
                      <PopoverTrigger
                        type="button"
                        id="issue-create-project"
                        aria-labelledby="issue-create-project-label"
                        aria-invalid={showErrors && !projectId}
                        aria-describedby={
                          showErrors && !projectId ? 'issue-create-project-error' : undefined
                        }
                        className={cn(toolbarTriggerClassName, 'max-w-full')}
                        disabled={templateApplyPending || projects.isPending}
                      >
                        <FolderKanbanIcon data-icon="inline-start" />
                        <span className="max-w-56 truncate">
                          {projects.isPending ? labels.optionsLoading : projectTriggerText}
                        </span>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-64 gap-0 p-1"
                        aria-labelledby="issue-create-project-popover-title"
                      >
                        <PopoverTitle id="issue-create-project-popover-title" className="sr-only">
                          {labels.projectLabel}
                        </PopoverTitle>
                        {projectOptions.length > 0 ? (
                          <div
                            role="listbox"
                            aria-labelledby="issue-create-project-popover-title"
                            className="max-h-64 overflow-y-auto"
                            onKeyDown={handlePopoverOptionsKeyDown}
                          >
                            {projectOptions.map((option) => (
                              <Button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={projectId === option.value}
                                data-issue-create-option
                                variant="ghost"
                                className="w-full justify-start"
                                onClick={() => {
                                  markTemplateFieldDirty('project');
                                  setProjectId(option.value);
                                  setInitialTeamIds([]);
                                  setOpenPopover(null);
                                }}
                              >
                                <FolderKanbanIcon data-icon="inline-start" />
                                <span className="truncate">{option.label}</span>
                                {projectId === option.value ? (
                                  <CheckIcon data-icon="inline-end" className="ml-auto" />
                                ) : null}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground px-2 py-2 text-sm">
                            {labels.projectRequired}
                          </p>
                        )}
                      </PopoverContent>
                    </Popover>
                    {showErrors && !projectId ? (
                      <span
                        id="issue-create-project-error"
                        className="text-destructive text-xs sm:absolute sm:top-full sm:left-0 sm:mt-1 sm:whitespace-nowrap"
                      >
                        {labels.projectRequired}
                      </span>
                    ) : null}
                  </div>

                  <span id="issue-create-labels-label" className="sr-only">
                    {labelsTriggerText}
                  </span>
                  <Popover
                    open={openPopover === 'labels'}
                    onOpenChange={(next) => setOpenPopover(next ? 'labels' : null)}
                  >
                    <PopoverTrigger
                      type="button"
                      id="issue-create-labels"
                      aria-labelledby="issue-create-labels-label"
                      className={toolbarTriggerClassName}
                      disabled={templateApplyPending}
                    >
                      <TagIcon data-icon="inline-start" />
                      {labels.labelsLabel}
                      {labelIds.length > 0 ? (
                        <Badge variant="secondary">{labelIds.length}</Badge>
                      ) : null}
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-64 gap-0 p-1"
                      aria-labelledby="issue-create-labels-popover-title"
                    >
                      <PopoverTitle id="issue-create-labels-popover-title" className="sr-only">
                        {labels.labelsLabel}
                      </PopoverTitle>
                      {activeLabels.length === 0 && unavailableSelectedLabelIds.length === 0 ? (
                        <p className="text-muted-foreground px-2 py-2 text-sm">{labels.noLabels}</p>
                      ) : (
                        <ul
                          className="max-h-64 overflow-y-auto"
                          onKeyDown={handlePopoverOptionsKeyDown}
                        >
                          {activeLabels.map((label) => (
                            <li key={label.id}>
                              <label className="hover:bg-accent flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm">
                                <Checkbox
                                  checked={labelIds.includes(label.id)}
                                  disabled={templateApplyPending}
                                  data-issue-create-option
                                  onCheckedChange={(checked) => {
                                    markTemplateFieldDirty('labels');
                                    setLabelIds((current) =>
                                      checked
                                        ? [...current, label.id]
                                        : current.filter((id) => id !== label.id),
                                    );
                                  }}
                                />
                                <span
                                  aria-hidden="true"
                                  className="size-2.5 shrink-0 rounded-full border"
                                  style={{ backgroundColor: label.color }}
                                />
                                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                              </label>
                            </li>
                          ))}
                          {unavailableSelectedLabelIds.map((id) => (
                            <li key={id}>
                              <label className="text-muted-foreground hover:bg-accent flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm">
                                <Checkbox
                                  checked
                                  disabled={templateApplyPending}
                                  data-issue-create-option
                                  onCheckedChange={(checked) => {
                                    if (checked) return;
                                    markTemplateFieldDirty('labels');
                                    setLabelIds((current) =>
                                      current.filter((labelId) => labelId !== id),
                                    );
                                  }}
                                />
                                <span
                                  aria-hidden="true"
                                  className="bg-muted-foreground size-2.5 shrink-0 rounded-full"
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {labels.templateUnavailable} · {id}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </PopoverContent>
                  </Popover>

                  <span id="issue-create-initial-teams-label" className="sr-only">
                    {initialTeamsTriggerText}
                  </span>
                  <span id="issue-create-initial-teams-description" className="sr-only">
                    {labels.initialTeamsDescription}
                  </span>
                  <Popover
                    open={openPopover === 'initialTeams'}
                    onOpenChange={(next) => setOpenPopover(next ? 'initialTeams' : null)}
                  >
                    <PopoverTrigger
                      type="button"
                      id="issue-create-initial-teams"
                      aria-labelledby="issue-create-initial-teams-label"
                      aria-describedby="issue-create-initial-teams-description"
                      className={toolbarTriggerClassName}
                      disabled={templateApplyPending}
                    >
                      <UsersIcon data-icon="inline-start" />
                      {selectedTeamLabels.length === 1
                        ? initialTeamsTriggerText
                        : labels.initialTeamsToolbarLabel}
                      {selectedTeamLabels.length > 1 ? (
                        <Badge variant="secondary">{selectedTeamLabels.length}</Badge>
                      ) : null}
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-64 gap-1 p-1"
                      aria-labelledby="issue-create-initial-teams-popover-title"
                    >
                      <PopoverTitle
                        id="issue-create-initial-teams-popover-title"
                        className="sr-only"
                      >
                        {labels.initialTeamsLabel}
                      </PopoverTitle>
                      <p className="text-muted-foreground px-2 py-1 text-xs">
                        {labels.initialTeamsDescription}
                      </p>
                      {!projectId && unavailableSelectedTeamIds.length === 0 ? (
                        <p className="text-muted-foreground px-2 py-2 text-sm">
                          {labels.initialTeamsNoProject}
                        </p>
                      ) : availableProjectTeams.size === 0 && unavailableSelectedTeamIds.length === 0 ? (
                        <p className="text-muted-foreground px-2 py-2 text-sm">
                          {labels.initialTeamsEmpty}
                        </p>
                      ) : (
                        <ul onKeyDown={handlePopoverOptionsKeyDown}>
                          {[...availableProjectTeams.values()].map((projectTeam) => (
                            <li key={projectTeam.id}>
                              <label className="hover:bg-accent flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm">
                                <Checkbox
                                  checked={initialTeamIds.includes(projectTeam.id)}
                                  disabled={templateApplyPending}
                                  data-issue-create-option
                                  onCheckedChange={(checked) => {
                                    markTemplateFieldDirty('initialTeams');
                                    setInitialTeamIds((current) =>
                                      checked
                                        ? [...current, projectTeam.id]
                                        : current.filter((item) => item !== projectTeam.id),
                                    );
                                  }}
                                />
                                <span className="font-mono text-xs">{projectTeam.team.key}</span>
                                <span className="truncate">{projectTeam.team.name}</span>
                              </label>
                            </li>
                          ))}
                          {unavailableSelectedTeamIds.map((projectTeamId) => (
                            <li key={projectTeamId}>
                              <label className="text-muted-foreground hover:bg-accent flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm">
                                <Checkbox
                                  checked
                                  disabled={templateApplyPending}
                                  data-issue-create-option
                                  onCheckedChange={(checked) => {
                                    if (checked) return;
                                    markTemplateFieldDirty('initialTeams');
                                    setInitialTeamIds((current) =>
                                      current.filter((item) => item !== projectTeamId),
                                    );
                                  }}
                                />
                                {projectTeamsById.get(projectTeamId)?.team.name ?? projectTeamId} ·{' '}
                                {labels.templateUnavailable}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </PopoverContent>
                  </Popover>

                  <FileUploadQueue
                    compactTrigger
                    labels={fileUploadQueueLabels(filesT)}
                    onFileIdsChange={setFileIds}
                    onReadyChange={setFilesReady}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="shrink-0">
              <Button
                type="button"
                variant="outline"
                disabled={templateApplyPending}
                onClick={requestClose}
              >
                {labels.cancel}
              </Button>
              <Button
                type="submit"
                disabled={
                  create.isPending ||
                  templateApplyPending ||
                  templateSelectionRequired ||
                  !filesReady
                }
              >
                {create.isPending ? (
                  <>
                    <Spinner />
                    {labels.submitting}
                  </>
                ) : (
                  labels.submit
                )}
              </Button>
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
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={discardAndClose}>
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pendingTemplate !== null}
        onOpenChange={(next) => {
          if (!next) cancelTemplateOverwrite();
        }}
      >
        <AlertDialogContent
          finalFocus={templateTriggerRef}
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            cancelTemplateOverwrite();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.overwriteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{overwriteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={templateApplyPending}>
              {labels.overwriteCancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={templateApplyPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingTemplate) void apply(pendingTemplate);
              }}
            >
              {labels.overwriteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
