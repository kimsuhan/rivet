'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldX,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  getTeamsControllerListWorkflowStatesQueryKey,
  useTeamsControllerCreateWorkflowState,
  useTeamsControllerDeleteWorkflowState,
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
  useTeamsControllerReorderWorkflowStates,
  useTeamsControllerSetDefaultWorkflowState,
  useTeamsControllerUpdateWorkflowState,
  type WorkflowStateResponseDto,
  WorkflowStateResponseDtoCategory,
} from '@rivet/api-client';

import { ContentEmpty } from '@/components/states/content-empty';
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
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import {
  isWorkflowStateColorKey,
  WORKFLOW_STATE_COLOR_PALETTE,
  type WorkflowStateColorKey,
  workflowStateColorKey,
  WorkflowStateIcon,
} from '@/components/workflow-state-icon';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type WorkflowSettingsLabels = {
  backToTeams: string;
  cancel: string;
  categoryBacklog: string;
  categoryBacklogDescription: string;
  categoryCanceled: string;
  categoryCanceledDescription: string;
  categoryCompleted: string;
  categoryCompletedDescription: string;
  categoryEmpty: string;
  categoryStarted: string;
  categoryStartedDescription: string;
  categoryUnstarted: string;
  categoryUnstartedDescription: string;
  close: string;
  conflictDescription: string;
  conflictTitle: string;
  colorLabel: string;
  colors: Record<WorkflowStateColorKey, string>;
  create: string;
  createDescription: string;
  createTitle: string;
  creating: string;
  defaultBadge: string;
  defaultErrorDescription: string;
  defaultErrorTitle: string;
  defaultSet: string;
  defaultSuccess: string;
  defaulting: string;
  delete: string;
  deleteConfirm: string;
  deleteDescription: string;
  deleteInUseDescription: string;
  deleteInUseTitle: string;
  deleteTitle: string;
  deleting: string;
  description: string;
  discardChanges: string;
  discardDescription: string;
  discardTitle: string;
  errorDescription: string;
  errorTitle: string;
  forbiddenDescription: string;
  forbiddenTitle: string;
  loading: string;
  manage: string;
  keepEditing: string;
  moveDown: string;
  moveUp: string;
  nameInvalid: string;
  nameLabel: string;
  nameRequired: string;
  nameTooLong: string;
  rename: string;
  renameDescription: string;
  renameTitle: string;
  reorderErrorDescription: string;
  reorderErrorTitle: string;
  reorderSuccess: string;
  replacementDescription: string;
  replacementLabel: string;
  replacementPlaceholder: string;
  replacementRequired: string;
  retry: string;
  save: string;
  saving: string;
  teamLabel: string;
  teamMissingDescription: string;
  teamMissingTitle: string;
  terminalDefaultConfirm: string;
  terminalDefaultDescription: string;
  terminalDefaultTitle: string;
  title: string;
};

const categories = [
  WorkflowStateResponseDtoCategory.BACKLOG,
  WorkflowStateResponseDtoCategory.UNSTARTED,
  WorkflowStateResponseDtoCategory.STARTED,
  WorkflowStateResponseDtoCategory.COMPLETED,
  WorkflowStateResponseDtoCategory.CANCELED,
] as const;

function stateLabel(template: string, name: string): string {
  return name + ' ' + template;
}

function categoryName(
  labels: WorkflowSettingsLabels,
  category: WorkflowStateResponseDto['category'],
) {
  switch (category) {
    case WorkflowStateResponseDtoCategory.BACKLOG:
      return labels.categoryBacklog;
    case WorkflowStateResponseDtoCategory.UNSTARTED:
      return labels.categoryUnstarted;
    case WorkflowStateResponseDtoCategory.STARTED:
      return labels.categoryStarted;
    case WorkflowStateResponseDtoCategory.COMPLETED:
      return labels.categoryCompleted;
    case WorkflowStateResponseDtoCategory.CANCELED:
      return labels.categoryCanceled;
  }
}

function WorkflowStateColorPicker({
  category,
  color,
  labels,
  onChange,
}: {
  category: WorkflowStateResponseDto['category'];
  color: WorkflowStateColorKey;
  labels: WorkflowSettingsLabels;
  onChange: (color: WorkflowStateColorKey) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{labels.colorLabel}</legend>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(WORKFLOW_STATE_COLOR_PALETTE) as WorkflowStateColorKey[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-label={labels.colors[option]}
            aria-pressed={color === option}
            className={cn(
              buttonVariants({ size: 'icon', variant: 'ghost' }),
              'relative size-9',
              color === option && 'bg-accent ring-ring ring-2',
            )}
            onClick={() => onChange(option)}
            title={labels.colors[option]}
          >
            <WorkflowStateIcon category={category} color={option} variant="swatch" />
            {color === option ? (
              <Check
                aria-hidden="true"
                className="bg-background absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full"
              />
            ) : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CreateStateDialog({
  category,
  labels,
  onClose,
  onRefresh,
  teamId,
}: {
  category: WorkflowStateResponseDto['category'];
  labels: WorkflowSettingsLabels;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  teamId: string;
}) {
  const mutation = useTeamsControllerCreateWorkflowState();
  const schema = z.object({
    color: z.custom<WorkflowStateColorKey>(isWorkflowStateColorKey),
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
  });
  const {
    clearErrors,
    control,
    formState: { errors, isDirty },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { color: workflowStateColorKey(category), name: '' },
    resolver: zodResolver(schema),
  });
  const [unexpectedError, setUnexpectedError] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const color = useWatch({ control, name: 'color' });

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;

    clearErrors();
    setUnexpectedError(false);
    mutation.mutate(
      { data: { category, color: values.color, name: values.name }, teamId },
      {
        onError: (error) => {
          if (error.body.fieldErrors.name?.length || error.body.code === 'VALIDATION_ERROR') {
            setError(
              'name',
              { message: labels.nameInvalid, type: 'server' },
              { shouldFocus: true },
            );
            return;
          }
          setUnexpectedError(true);
        },
        onSuccess: async () => {
          await onRefresh();
          onClose();
        },
      },
    );
  });

  const requestClose = () => {
    if (mutation.isPending) return;
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent closeLabel={labels.close}>
          <DialogHeader>
            <DialogTitle>{labels.createTitle}</DialogTitle>
            <DialogDescription>
              {labels.createDescription.replace('{category}', categoryName(labels, category))}
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-workflow-state-form"
            noValidate
            aria-busy={mutation.isPending}
            onSubmit={submit}
            className="flex flex-col gap-4"
          >
            {unexpectedError ? (
              <Alert variant="destructive">
                <AlertTitle>{labels.errorTitle}</AlertTitle>
                <AlertDescription>{labels.errorDescription}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="create-workflow-state-name">{labels.nameLabel}</FieldLabel>
              <Input
                id="create-workflow-state-name"
                autoComplete="off"
                aria-errormessage={errors.name ? 'create-workflow-state-name-error' : undefined}
                aria-invalid={Boolean(errors.name)}
                {...register('name')}
              />
              <FieldError id="create-workflow-state-name-error" errors={[errors.name]} />
            </Field>
            <WorkflowStateColorPicker
              category={category}
              color={color}
              labels={labels}
              onChange={(color) => setValue('color', color, { shouldDirty: true })}
            />
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" form="create-workflow-state-form" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {mutation.isPending ? labels.creating : labels.create}
            </Button>
          </DialogFooter>
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
            <AlertDialogAction type="button" variant="destructive" onClick={onClose}>
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RenameStateDialog({
  labels,
  onClose,
  onRefresh,
  state,
}: {
  labels: WorkflowSettingsLabels;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  state: WorkflowStateResponseDto;
}) {
  const mutation = useTeamsControllerUpdateWorkflowState();
  const schema = z.object({
    color: z.custom<WorkflowStateColorKey>(isWorkflowStateColorKey),
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
  });
  const {
    clearErrors,
    control,
    formState: { errors, isDirty },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { color: workflowStateColorKey(state.category, state.color), name: state.name },
    resolver: zodResolver(schema),
  });
  const [version, setVersion] = useState(state.version);
  const [conflict, setConflict] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const color = useWatch({ control, name: 'color' });

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;

    clearErrors();
    setConflict(false);
    setUnexpectedError(false);
    mutation.mutate(
      { data: { color: values.color, name: values.name, version }, stateId: state.id },
      {
        onError: (error) => {
          if (error.body.code === 'VERSION_CONFLICT') {
            setVersion(error.body.currentVersion ?? version);
            setConflict(true);
            void onRefresh();
            return;
          }
          if (error.body.fieldErrors.name?.length || error.body.code === 'VALIDATION_ERROR') {
            setError(
              'name',
              { message: labels.nameInvalid, type: 'server' },
              { shouldFocus: true },
            );
            return;
          }
          setUnexpectedError(true);
        },
        onSuccess: async () => {
          await onRefresh();
          onClose();
        },
      },
    );
  });

  const requestClose = () => {
    if (mutation.isPending) return;
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) requestClose();
        }}
      >
        <DialogContent closeLabel={labels.close}>
          <DialogHeader>
            <DialogTitle>{labels.renameTitle}</DialogTitle>
            <DialogDescription>{labels.renameDescription}</DialogDescription>
          </DialogHeader>
          <form
            id="rename-workflow-state-form"
            noValidate
            aria-busy={mutation.isPending}
            onSubmit={submit}
          >
            <div className="flex flex-col gap-4">
              {conflict ? (
                <Alert>
                  <AlertTitle>{labels.conflictTitle}</AlertTitle>
                  <AlertDescription>{labels.conflictDescription}</AlertDescription>
                </Alert>
              ) : null}
              {unexpectedError ? (
                <Alert variant="destructive">
                  <AlertTitle>{labels.errorTitle}</AlertTitle>
                  <AlertDescription>{labels.errorDescription}</AlertDescription>
                </Alert>
              ) : null}
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="workflow-state-name">{labels.nameLabel}</FieldLabel>
                <Input
                  id="workflow-state-name"
                  autoComplete="off"
                  aria-errormessage={errors.name ? 'workflow-state-name-error' : undefined}
                  aria-invalid={Boolean(errors.name)}
                  {...register('name')}
                />
                <FieldError id="workflow-state-name-error" errors={[errors.name]} />
              </Field>
              <WorkflowStateColorPicker
                category={state.category}
                color={color}
                labels={labels}
                onChange={(color) => setValue('color', color, { shouldDirty: true })}
              />
            </div>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={requestClose}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" form="rename-workflow-state-form" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {mutation.isPending ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
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
            <AlertDialogAction type="button" variant="destructive" onClick={onClose}>
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DeleteStateDialog({
  labels,
  onClose,
  onRefresh,
  state,
  states,
}: {
  labels: WorkflowSettingsLabels;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  state: WorkflowStateResponseDto;
  states: WorkflowStateResponseDto[];
}) {
  const mutation = useTeamsControllerDeleteWorkflowState();
  const [version, setVersion] = useState(state.version);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [replacementRequired, setReplacementRequired] = useState(state.isDefault);
  const [replacementError, setReplacementError] = useState(false);
  const [notice, setNotice] = useState<'CONFLICT' | 'IN_USE' | 'ERROR' | null>(null);
  const replacementTriggerRef = useRef<HTMLButtonElement>(null);
  const replacements = states.filter((candidate) => candidate.id !== state.id);
  const replacementItems = replacements.map((candidate) => ({
    label: candidate.name,
    value: candidate.id,
  }));

  useEffect(() => {
    if (replacementError) replacementTriggerRef.current?.focus();
  }, [replacementError]);

  const remove = () => {
    if (mutation.isPending) return;
    if (replacementRequired && !replacementId) {
      setReplacementError(true);
      replacementTriggerRef.current?.focus();
      return;
    }

    setNotice(null);
    setReplacementError(false);
    mutation.mutate(
      {
        params: { version, ...(replacementId ? { replacementStateId: replacementId } : {}) },
        stateId: state.id,
      },
      {
        onError: (error) => {
          if (error.body.code === 'VERSION_CONFLICT') {
            setVersion(error.body.currentVersion ?? version);
            setNotice('CONFLICT');
            void onRefresh();
            return;
          }
          if (error.body.code === 'WORKFLOW_STATE_IN_USE') {
            setReplacementRequired(true);
            setReplacementError(true);
            setNotice('IN_USE');
            return;
          }
          setNotice('ERROR');
        },
        onSuccess: async () => {
          await onRefresh();
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={labels.close}>
        <DialogHeader>
          <DialogTitle>{labels.deleteTitle}</DialogTitle>
          <DialogDescription>
            {labels.deleteDescription.replace('{state}', state.name)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {notice === 'CONFLICT' ? (
            <Alert>
              <AlertTitle>{labels.conflictTitle}</AlertTitle>
              <AlertDescription>{labels.conflictDescription}</AlertDescription>
            </Alert>
          ) : null}
          {notice === 'IN_USE' ? (
            <Alert variant="destructive">
              <AlertTitle>{labels.deleteInUseTitle}</AlertTitle>
              <AlertDescription>{labels.deleteInUseDescription}</AlertDescription>
            </Alert>
          ) : null}
          {notice === 'ERROR' ? (
            <Alert variant="destructive">
              <AlertTitle>{labels.errorTitle}</AlertTitle>
              <AlertDescription>{labels.errorDescription}</AlertDescription>
            </Alert>
          ) : null}
          {replacementRequired ? (
            <Field data-invalid={replacementError}>
              <FieldLabel htmlFor="replacement-state">{labels.replacementLabel}</FieldLabel>
              <Select
                items={replacementItems}
                value={replacementId}
                onValueChange={(value) => {
                  setReplacementId(value);
                  setReplacementError(false);
                }}
              >
                <SelectTrigger
                  ref={replacementTriggerRef}
                  id="replacement-state"
                  className="w-full"
                  aria-errormessage={replacementError ? 'replacement-state-error' : undefined}
                  aria-invalid={replacementError}
                >
                  <SelectValue placeholder={labels.replacementPlaceholder} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {replacements.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{labels.replacementDescription}</FieldDescription>
              {replacementError ? (
                <FieldError id="replacement-state-error">{labels.replacementRequired}</FieldError>
              ) : null}
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.isPending}
            onClick={remove}
          >
            {mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
            {mutation.isPending ? labels.deleting : labels.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowSettingsScreen({
  labels,
  teamId,
}: {
  labels: WorkflowSettingsLabels;
  teamId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const teams = useTeamsControllerList({ includeArchived: false }, { query: { retry: false } });
  const workflow = useTeamsControllerListWorkflowStates(teamId, { query: { retry: false } });
  const reorder = useTeamsControllerReorderWorkflowStates();
  const setDefault = useTeamsControllerSetDefaultWorkflowState();
  const [createCategory, setCreateCategory] = useState<WorkflowStateResponseDto['category'] | null>(
    null,
  );
  const [manageTargetId, setManageTargetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<WorkflowStateResponseDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStateResponseDto | null>(null);
  const [defaultConfirmationTarget, setDefaultConfirmationTarget] =
    useState<WorkflowStateResponseDto | null>(null);
  const [notice, setNotice] = useState<'CONFLICT' | 'DEFAULT_ERROR' | 'REORDER_ERROR' | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const selectedTeam = teams.data?.items.find((team) => team.id === teamId);
  const sortedStates = categories.flatMap((category) =>
    (workflow.data?.items ?? [])
      .filter((state) => state.category === category)
      .sort((left, right) => left.position - right.position),
  );
  const teamItems = (teams.data?.items ?? []).map((team) => ({ label: team.name, value: team.id }));

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getTeamsControllerListWorkflowStatesQueryKey(teamId),
    });
  };

  if (teams.isPending || workflow.isPending) {
    return <ContentLoading label={labels.loading} />;
  }

  if (teams.error?.status === 403 || workflow.error?.status === 403) {
    return (
      <ContentEmpty
        icon={ShieldX}
        title={labels.forbiddenTitle}
        description={labels.forbiddenDescription}
      />
    );
  }

  if (teams.isError || workflow.isError) {
    return (
      <ContentEmpty
        icon={GitBranch}
        title={labels.errorTitle}
        description={labels.errorDescription}
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void teams.refetch();
            void workflow.refetch();
          }}
        >
          {labels.retry}
        </Button>
      </ContentEmpty>
    );
  }

  if (!selectedTeam) {
    return (
      <ContentEmpty
        icon={GitBranch}
        title={labels.teamMissingTitle}
        description={labels.teamMissingDescription}
      >
        <Link href="/settings/teams" className={buttonVariants({ variant: 'outline' })}>
          {labels.backToTeams}
        </Link>
      </ContentEmpty>
    );
  }

  const stateSections = categories.map((category) => ({
    category,
    states: sortedStates.filter((state) => state.category === category),
  }));

  const move = (state: WorkflowStateResponseDto, direction: -1 | 1) => {
    if (reorder.isPending || setDefault.isPending) return;

    const sectionStates = sortedStates.filter((candidate) => candidate.category === state.category);
    const sectionIndex = sectionStates.findIndex((candidate) => candidate.id === state.id);
    const other = sectionStates[sectionIndex + direction];
    if (!other) return;

    const next = [...sortedStates];
    const currentIndex = next.findIndex((candidate) => candidate.id === state.id);
    const otherIndex = next.findIndex((candidate) => candidate.id === other.id);
    [next[currentIndex], next[otherIndex]] = [next[otherIndex]!, next[currentIndex]!];

    setNotice(null);
    setReorderAnnouncement('');
    reorder.mutate(
      {
        data: { states: next.map(({ id, version }) => ({ id, version })) },
        teamId,
      },
      {
        onError: (error) => {
          setNotice(error.body.code === 'VERSION_CONFLICT' ? 'CONFLICT' : 'REORDER_ERROR');
          if (error.body.code === 'VERSION_CONFLICT') void refresh();
        },
        onSuccess: (data) => {
          queryClient.setQueryData(getTeamsControllerListWorkflowStatesQueryKey(teamId), data);
          setReorderAnnouncement(
            labels.reorderSuccess
              .replace('{state}', state.name)
              .replace('{position}', String(sectionIndex + direction + 1)),
          );
        },
      },
    );
  };

  const makeDefault = (state: WorkflowStateResponseDto) => {
    if (setDefault.isPending || reorder.isPending || state.isDefault) return;

    setNotice(null);
    setReorderAnnouncement('');
    setDefault.mutate(
      { data: { version: state.version }, stateId: state.id },
      {
        onError: (error) => {
          setNotice(error.body.code === 'VERSION_CONFLICT' ? 'CONFLICT' : 'DEFAULT_ERROR');
          if (error.body.code === 'VERSION_CONFLICT') void refresh();
        },
        onSuccess: (data) => {
          queryClient.setQueryData(getTeamsControllerListWorkflowStatesQueryKey(teamId), data);
          setReorderAnnouncement(labels.defaultSuccess.replace('{state}', state.name));
        },
      },
    );
  };

  const requestDefault = (state: WorkflowStateResponseDto) => {
    setManageTargetId(null);
    if (
      state.category === WorkflowStateResponseDtoCategory.COMPLETED ||
      state.category === WorkflowStateResponseDtoCategory.CANCELED
    ) {
      setDefaultConfirmationTarget(state);
      return;
    }
    makeDefault(state);
  };

  const isWorkflowMutating = reorder.isPending || setDefault.isPending;

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="border-b pb-5">
        <Link
          href="/settings/teams"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), '-ml-2')}
        >
          <ArrowLeft data-icon="inline-start" />
          {labels.backToTeams}
        </Link>
        <div className="mt-3 flex items-end justify-between gap-6">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.015em]">{labels.title}</h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{labels.description}</p>
          </div>
          <Field className="w-64 shrink-0">
            <FieldLabel htmlFor="workflow-team">{labels.teamLabel}</FieldLabel>
            <Select
              items={teamItems}
              value={teamId}
              onValueChange={(value) => {
                if (value && value !== teamId) {
                  router.replace('/settings/teams/' + value + '/workflow');
                }
              }}
            >
              <SelectTrigger id="workflow-team" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {teams.data.items.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </header>

      {notice === 'CONFLICT' ? (
        <Alert className="mt-4">
          <AlertTitle>{labels.conflictTitle}</AlertTitle>
          <AlertDescription>{labels.conflictDescription}</AlertDescription>
        </Alert>
      ) : null}
      {notice === 'REORDER_ERROR' ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>{labels.reorderErrorTitle}</AlertTitle>
          <AlertDescription>{labels.reorderErrorDescription}</AlertDescription>
        </Alert>
      ) : null}
      {notice === 'DEFAULT_ERROR' ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>{labels.defaultErrorTitle}</AlertTitle>
          <AlertDescription>{labels.defaultErrorDescription}</AlertDescription>
        </Alert>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {reorderAnnouncement}
      </p>

      <Card className="mt-5 overflow-hidden" size="sm">
        <CardContent className="p-0">
          {stateSections.map(({ category, states: sectionStates }, sectionIndex) => {
            const title = categoryName(labels, category);

            return (
              <section
                key={category}
                aria-labelledby={`workflow-category-${category}`}
                className={cn(sectionIndex > 0 && 'border-t')}
              >
                <div className="bg-muted/35 flex h-10 items-center justify-between border-b px-3">
                  <h2
                    id={`workflow-category-${category}`}
                    className="text-muted-foreground text-xs font-medium tracking-wide"
                  >
                    {title}
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={stateLabel(labels.create, title)}
                    disabled={isWorkflowMutating}
                    onClick={() => setCreateCategory(category)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </div>
                {sectionStates.length ? (
                  <ol>
                    {sectionStates.map((state, stateIndex) => (
                      <li
                        key={state.id}
                        className="group hover:bg-muted/25 focus-within:bg-muted/25 flex min-h-12 items-center gap-3 border-b px-3 last:border-b-0"
                      >
                        <WorkflowStateIcon
                          category={state.category}
                          color={state.color}
                          progress={
                            state.category === WorkflowStateResponseDtoCategory.STARTED
                              ? (stateIndex + 1) / (sectionStates.length + 1)
                              : null
                          }
                          variant="swatch"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {state.name}
                        </span>
                        {state.isDefault ? (
                          <Badge variant="outline" className="text-muted-foreground font-normal">
                            {labels.defaultBadge}
                          </Badge>
                        ) : null}
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={stateLabel(labels.moveUp, state.name)}
                            disabled={stateIndex === 0 || isWorkflowMutating}
                            onClick={() => move(state, -1)}
                          >
                            <ArrowUp aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={stateLabel(labels.moveDown, state.name)}
                            disabled={stateIndex === sectionStates.length - 1 || isWorkflowMutating}
                            onClick={() => move(state, 1)}
                          >
                            <ArrowDown aria-hidden="true" />
                          </Button>
                        </div>
                        <Popover
                          open={manageTargetId === state.id}
                          onOpenChange={(open) => setManageTargetId(open ? state.id : null)}
                        >
                          <PopoverTrigger
                            type="button"
                            aria-label={stateLabel(labels.manage, state.name)}
                            className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-52 gap-1 p-1">
                            <PopoverTitle className="px-2 py-1.5 text-sm">
                              {state.name}
                            </PopoverTitle>
                            <Button
                              type="button"
                              className="w-full justify-start"
                              size="sm"
                              variant="ghost"
                              disabled={stateIndex === 0 || isWorkflowMutating}
                              onClick={() => {
                                setManageTargetId(null);
                                move(state, -1);
                              }}
                            >
                              <ArrowUp data-icon="inline-start" aria-hidden="true" />
                              {labels.moveUp}
                            </Button>
                            <Button
                              type="button"
                              className="w-full justify-start"
                              size="sm"
                              variant="ghost"
                              disabled={
                                stateIndex === sectionStates.length - 1 || isWorkflowMutating
                              }
                              onClick={() => {
                                setManageTargetId(null);
                                move(state, 1);
                              }}
                            >
                              <ArrowDown data-icon="inline-start" aria-hidden="true" />
                              {labels.moveDown}
                            </Button>
                            <Separator className="my-1" />
                            <Button
                              type="button"
                              className="w-full justify-start"
                              size="sm"
                              variant="ghost"
                              disabled={state.isDefault || isWorkflowMutating}
                              onClick={() => requestDefault(state)}
                            >
                              {setDefault.isPending &&
                              setDefault.variables?.stateId === state.id ? (
                                <Spinner data-icon="inline-start" aria-hidden="true" />
                              ) : (
                                <Star data-icon="inline-start" aria-hidden="true" />
                              )}
                              {state.isDefault
                                ? labels.defaultBadge
                                : setDefault.isPending && setDefault.variables?.stateId === state.id
                                  ? labels.defaulting
                                  : labels.defaultSet}
                            </Button>
                            <Button
                              type="button"
                              className="w-full justify-start"
                              size="sm"
                              variant="ghost"
                              disabled={isWorkflowMutating}
                              onClick={() => {
                                setManageTargetId(null);
                                setRenameTarget(state);
                              }}
                            >
                              <Pencil data-icon="inline-start" />
                              {labels.rename}
                            </Button>
                            <Button
                              type="button"
                              className="w-full justify-start"
                              size="sm"
                              variant="destructive"
                              disabled={isWorkflowMutating}
                              onClick={() => {
                                setManageTargetId(null);
                                setDeleteTarget(state);
                              }}
                            >
                              <Trash2 data-icon="inline-start" />
                              {labels.delete}
                            </Button>
                          </PopoverContent>
                        </Popover>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-muted-foreground px-3 py-4 text-sm">{labels.categoryEmpty}</p>
                )}
              </section>
            );
          })}
        </CardContent>
      </Card>

      {createCategory ? (
        <CreateStateDialog
          category={createCategory}
          labels={labels}
          onClose={() => setCreateCategory(null)}
          onRefresh={refresh}
          teamId={teamId}
        />
      ) : null}
      {renameTarget ? (
        <RenameStateDialog
          labels={labels}
          onClose={() => setRenameTarget(null)}
          onRefresh={refresh}
          state={renameTarget}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteStateDialog
          labels={labels}
          onClose={() => setDeleteTarget(null)}
          onRefresh={refresh}
          state={deleteTarget}
          states={sortedStates}
        />
      ) : null}
      <AlertDialog
        open={defaultConfirmationTarget !== null}
        onOpenChange={(open) => !open && setDefaultConfirmationTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.terminalDefaultTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.terminalDefaultDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => {
                if (defaultConfirmationTarget) makeDefault(defaultConfirmationTarget);
                setDefaultConfirmationTarget(null);
              }}
            >
              {labels.terminalDefaultConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
