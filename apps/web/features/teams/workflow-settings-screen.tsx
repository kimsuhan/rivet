'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, GitBranch, Pencil, ShieldX, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  getTeamsControllerListWorkflowStatesQueryKey,
  useTeamsControllerDeleteWorkflowState,
  useTeamsControllerList,
  useTeamsControllerListWorkflowStates,
  useTeamsControllerReorderWorkflowStates,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
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
  defaultBadge: string;
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
    name: z.string().trim().min(1, labels.nameRequired).max(100, labels.nameTooLong),
  });
  const {
    clearErrors,
    formState: { errors, isDirty },
    handleSubmit,
    register,
    setError,
  } = useForm<z.infer<typeof schema>>({
    defaultValues: { name: state.name },
    resolver: zodResolver(schema),
  });
  const [version, setVersion] = useState(state.version);
  const [conflict, setConflict] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState(false);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);

  const submit = handleSubmit((values) => {
    if (mutation.isPending) return;

    clearErrors();
    setConflict(false);
    setUnexpectedError(false);
    mutation.mutate(
      { data: { name: values.name, version }, stateId: state.id },
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
  const [renameTarget, setRenameTarget] = useState<WorkflowStateResponseDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStateResponseDto | null>(null);
  const [notice, setNotice] = useState<'CONFLICT' | 'ERROR' | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const selectedTeam = teams.data?.items.find((team) => team.id === teamId);
  const sortedStates = [...(workflow.data?.items ?? [])].sort(
    (left, right) => left.position - right.position,
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

  const categoryInfo = {
    BACKLOG: [labels.categoryBacklog, labels.categoryBacklogDescription],
    UNSTARTED: [labels.categoryUnstarted, labels.categoryUnstartedDescription],
    STARTED: [labels.categoryStarted, labels.categoryStartedDescription],
    COMPLETED: [labels.categoryCompleted, labels.categoryCompletedDescription],
    CANCELED: [labels.categoryCanceled, labels.categoryCanceledDescription],
  } satisfies Record<(typeof categories)[number], [string, string]>;
  const stateSections = sortedStates.reduce<
    Array<{
      category: WorkflowStateResponseDto['category'];
      states: WorkflowStateResponseDto[];
    }>
  >((sections, state) => {
    const currentSection = sections.at(-1);
    if (currentSection?.category === state.category) {
      currentSection.states.push(state);
    } else {
      sections.push({ category: state.category, states: [state] });
    }
    return sections;
  }, []);
  for (const category of categories) {
    if (!stateSections.some((section) => section.category === category)) {
      stateSections.push({ category, states: [] });
    }
  }

  const move = (state: WorkflowStateResponseDto, direction: -1 | 1) => {
    if (reorder.isPending) return;

    const currentIndex = sortedStates.findIndex((candidate) => candidate.id === state.id);
    const other = sortedStates[currentIndex + direction];
    if (!other) return;

    const next = [...sortedStates];
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
          setNotice(error.body.code === 'VERSION_CONFLICT' ? 'CONFLICT' : 'ERROR');
          if (error.body.code === 'VERSION_CONFLICT') void refresh();
        },
        onSuccess: (data) => {
          queryClient.setQueryData(getTeamsControllerListWorkflowStatesQueryKey(teamId), data);
          setReorderAnnouncement(
            labels.reorderSuccess
              .replace('{state}', state.name)
              .replace('{position}', String(otherIndex + 1)),
          );
        },
      },
    );
  };

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
      {notice === 'ERROR' ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>{labels.reorderErrorTitle}</AlertTitle>
          <AlertDescription>{labels.reorderErrorDescription}</AlertDescription>
        </Alert>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {reorderAnnouncement}
      </p>

      <div className="mt-5 grid gap-4">
        {stateSections.map(({ category, states: sectionStates }, sectionIndex) => {
          const [title, description] = categoryInfo[category];

          return (
            <Card key={`${category}-${sectionIndex}`} size="sm">
              <CardHeader className="border-b">
                <CardTitle>
                  <h2>{title}</h2>
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {sectionStates.length ? (
                  <ol>
                    {sectionStates.map((state) => {
                      const stateIndex = sortedStates.findIndex(
                        (candidate) => candidate.id === state.id,
                      );
                      return (
                        <li
                          key={state.id}
                          className="flex min-h-12 items-center gap-3 border-b px-3 py-2 last:border-b-0"
                        >
                          <span className="text-muted-foreground w-5 text-center text-xs tabular-nums">
                            {stateIndex + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{state.name}</span>
                          {state.isDefault ? (
                            <Badge variant="outline">{labels.defaultBadge}</Badge>
                          ) : null}
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={stateLabel(labels.moveUp, state.name)}
                              disabled={stateIndex === 0 || reorder.isPending}
                              onClick={() => move(state, -1)}
                            >
                              <ArrowUp aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={stateLabel(labels.moveDown, state.name)}
                              disabled={stateIndex === sortedStates.length - 1 || reorder.isPending}
                              onClick={() => move(state, 1)}
                            >
                              <ArrowDown aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setRenameTarget(state)}
                            >
                              <Pencil data-icon="inline-start" />
                              {labels.rename}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(state)}
                            >
                              <Trash2 data-icon="inline-start" />
                              {labels.delete}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-muted-foreground px-3 py-5 text-sm">{labels.categoryEmpty}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

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
    </section>
  );
}
