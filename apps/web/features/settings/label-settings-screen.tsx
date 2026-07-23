'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Pencil,
  Plus,
  Search,
  ShieldX,
  Tags,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  getLabelsControllerListQueryKey,
  type LabelResponseDto,
  type LabelsControllerCreateMutationError,
  type LabelsControllerListParams,
  useLabelsControllerArchive,
  useLabelsControllerCreate,
  useLabelsControllerList,
  useLabelsControllerUpdate,
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
import { Button } from '@/components/ui/button';
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
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DEFAULT_LABEL_COLOR = '#9A8CF2';
const LABEL_COLOR_OPTIONS = [
  { label: 'colorLavender', value: '#9A8CF2' },
  { label: 'colorBlue', value: '#72A7F2' },
  { label: 'colorCyan', value: '#4BC7C7' },
  { label: 'colorGreen', value: '#45C46B' },
  { label: 'colorYellow', value: '#E0B85A' },
  { label: 'colorOrange', value: '#E58A4A' },
  { label: 'colorRed', value: '#EF6A70' },
  { label: 'colorGray', value: '#8A8F98' },
] as const;
const LABEL_COLOR_VALUES = new Set<string>(LABEL_COLOR_OPTIONS.map(({ value }) => value));

type LabelTab = 'active' | 'archived';
type LabelChange = 'archive' | 'create' | 'update';
type LabelFormValues = { color: string; name: string };

export type LabelSettingsLabels = {
  activeTab: string;
  archive: string;
  archiveAction: string;
  archiveDescription: string;
  archiveErrorDescription: string;
  archiveErrorTitle: string;
  archiveTitle: string;
  archivedNoticeDescription: string;
  archivedNoticeTitle: string;
  archivedTab: string;
  archiving: string;
  cancel: string;
  clearSearch: string;
  colorBlue: string;
  colorCyan: string;
  colorCustom: string;
  colorDescription: string;
  colorFormat: string;
  colorGray: string;
  colorGreen: string;
  colorLabel: string;
  colorLavender: string;
  colorOrange: string;
  colorPreview: string;
  colorRed: string;
  colorYellow: string;
  conflictDescription: string;
  conflictTitle: string;
  createDescription: string;
  createLabel: string;
  createTitle: string;
  description: string;
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
  emptySearchDescription: string;
  emptySearchTitle: string;
  errorDescription: string;
  errorTitle: string;
  loading: string;
  keepEditing: string;
  nameInUse: string;
  nameInvalid: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  nameTooLong: string;
  nextPage: string;
  paginationLabel: string;
  permissionDescription: string;
  permissionTitle: string;
  previousPage: string;
  reloadLatest: string;
  retry: string;
  saveChanges: string;
  saveErrorDescription: string;
  saveErrorTitle: string;
  saving: string;
  search: string;
  searchLabel: string;
  searchPlaceholder: string;
  tabsLabel: string;
  title: string;
};

function LabelColor({
  color,
  label,
  showCode,
}: {
  color: string;
  label: string;
  showCode: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="size-5 rounded-md border"
        style={{ backgroundColor: color }}
      />
      <span className="sr-only">{label}</span>
      {showCode ? <code className="text-muted-foreground text-xs">{color}</code> : null}
    </span>
  );
}

function LabelRows({
  items,
  labels,
  onArchive,
  onEdit,
}: {
  items: LabelResponseDto[];
  labels: LabelSettingsLabels;
  onArchive: (label: LabelResponseDto) => void;
  onEdit: (label: LabelResponseDto) => void;
}) {
  return (
    <ul className="border-t">
      {items.map((label) => (
        <li key={label.id} className="flex min-h-14 items-center gap-4 border-b py-2">
          <LabelColor
            color={label.color}
            label={`${labels.colorPreview}: ${label.color}`}
            showCode={!LABEL_COLOR_VALUES.has(label.color.toUpperCase())}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{label.name}</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${label.name} ${labels.edit}`}
              onClick={() => onEdit(label)}
            >
              <Pencil data-icon="inline-start" aria-hidden="true" />
              {labels.edit}
            </Button>
            {!label.archived ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${label.name} ${labels.archive}`}
                onClick={() => onArchive(label)}
              >
                <Archive data-icon="inline-start" aria-hidden="true" />
                {labels.archive}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function LabelResults({
  hasNextPage,
  hasPreviousPage,
  isError,
  isForbidden,
  isPending,
  items,
  labels,
  onArchive,
  onClearSearch,
  onCreate,
  onEdit,
  onNextPage,
  onPreviousPage,
  onRetry,
  query,
  tab,
}: {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isError: boolean;
  isForbidden: boolean;
  isPending: boolean;
  items: LabelResponseDto[];
  labels: LabelSettingsLabels;
  onArchive: (label: LabelResponseDto) => void;
  onClearSearch: () => void;
  onCreate: () => void;
  onEdit: (label: LabelResponseDto) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onRetry: () => void;
  query: string;
  tab: LabelTab;
}) {
  if (isPending) {
    return <ContentLoading label={labels.loading} />;
  }

  if (isForbidden) {
    return (
      <ContentEmpty
        icon={ShieldX}
        title={labels.permissionTitle}
        description={labels.permissionDescription}
      />
    );
  }

  if (isError) {
    return (
      <ContentError
        title={labels.errorTitle}
        description={labels.errorDescription}
        retryLabel={labels.retry}
        onRetry={onRetry}
      />
    );
  }

  if (items.length === 0) {
    const hasQuery = query.length > 0;
    const title = hasQuery
      ? labels.emptySearchTitle
      : tab === 'active'
        ? labels.emptyActiveTitle
        : labels.emptyArchivedTitle;
    const description = hasQuery
      ? labels.emptySearchDescription
      : tab === 'active'
        ? labels.emptyActiveDescription
        : labels.emptyArchivedDescription;

    return (
      <>
        <ContentEmpty
          icon={tab === 'active' ? Tags : Archive}
          title={title}
          description={description}
        >
          {hasQuery ? (
            <Button type="button" variant="outline" onClick={onClearSearch}>
              <X data-icon="inline-start" aria-hidden="true" />
              {labels.clearSearch}
            </Button>
          ) : tab === 'active' ? (
            <Button type="button" onClick={onCreate}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {labels.createLabel}
            </Button>
          ) : null}
        </ContentEmpty>
        {hasNextPage || hasPreviousPage ? (
          <LabelPagination
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            labels={labels}
            onNextPage={onNextPage}
            onPreviousPage={onPreviousPage}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <LabelRows items={items} labels={labels} onArchive={onArchive} onEdit={onEdit} />
      {hasNextPage || hasPreviousPage ? (
        <LabelPagination
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          labels={labels}
          onNextPage={onNextPage}
          onPreviousPage={onPreviousPage}
        />
      ) : null}
    </>
  );
}

function LabelPagination({
  hasNextPage,
  hasPreviousPage,
  labels,
  onNextPage,
  onPreviousPage,
}: {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  labels: LabelSettingsLabels;
  onNextPage: () => void;
  onPreviousPage: () => void;
}) {
  return (
    <nav aria-label={labels.paginationLabel} className="mt-4 flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasPreviousPage}
        onClick={onPreviousPage}
      >
        <ChevronLeft data-icon="inline-start" aria-hidden="true" />
        {labels.previousPage}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasNextPage}
        onClick={onNextPage}
      >
        {labels.nextPage}
        <ChevronRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </nav>
  );
}

function LabelFormDialog({
  label,
  labels,
  onClose,
  onReloadLatest,
  onSaved,
}: {
  label: LabelResponseDto | null;
  labels: LabelSettingsLabels;
  onClose: () => void;
  onReloadLatest: () => Promise<void>;
  onSaved: (change: LabelChange) => Promise<void>;
}) {
  const initialColor = label?.color.toUpperCase() ?? DEFAULT_LABEL_COLOR;
  const customColor = label && !LABEL_COLOR_VALUES.has(initialColor) ? initialColor : null;
  const colorOptions = customColor
    ? [{ label: 'colorCustom' as const, value: customColor }, ...LABEL_COLOR_OPTIONS]
    : LABEL_COLOR_OPTIONS;
  const schema = z.object({
    color: z
      .string()
      .trim()
      .refine(
        (value) =>
          LABEL_COLOR_VALUES.has(value.toUpperCase()) || value.toUpperCase() === customColor,
        labels.colorFormat,
      ),
    name: z
      .string()
      .refine((value) => [...value.normalize('NFC').trim()].length > 0, labels.nameRequired)
      .refine((value) => [...value.normalize('NFC').trim()].length <= 50, labels.nameTooLong),
  });
  const form = useForm<LabelFormValues>({
    defaultValues: {
      color: initialColor,
      name: label?.name ?? '',
    },
    resolver: zodResolver(schema),
  });
  const createLabel = useLabelsControllerCreate();
  const updateLabel = useLabelsControllerUpdate();
  const [version, setVersion] = useState(label?.version ?? 1);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);
  const mutation = label ? updateLabel : createLabel;
  const isDirty = form.formState.isDirty;
  const dirtyFields = form.formState.dirtyFields;
  const mutationError = mutation.error;
  const isConflict = mutationError?.body.code === 'VERSION_CONFLICT';
  const hasMappedError = Boolean(
    mutationError &&
    (mutationError.body.code === 'LABEL_NAME_IN_USE' ||
      mutationError.body.fieldErrors.name?.length ||
      mutationError.body.fieldErrors.color?.length),
  );

  function handleError(error: LabelsControllerCreateMutationError) {
    const hasNameError = Boolean(error.body.fieldErrors.name?.length);
    const hasColorError = Boolean(error.body.fieldErrors.color?.length);

    if (hasNameError || error.body.code === 'LABEL_NAME_IN_USE') {
      form.setError(
        'name',
        {
          message: error.body.code === 'LABEL_NAME_IN_USE' ? labels.nameInUse : labels.nameInvalid,
          type: 'server',
        },
        { shouldFocus: true },
      );
    } else if (hasColorError) {
      form.setError(
        'color',
        { message: labels.colorFormat, type: 'server' },
        { shouldFocus: true },
      );
    }
  }

  const submit = form.handleSubmit((values) => {
    if (mutation.isPending) {
      return;
    }

    form.clearErrors();
    createLabel.reset();
    updateLabel.reset();
    const normalized = {
      color: values.color.trim().toUpperCase(),
      name: values.name.normalize('NFC').trim(),
    };

    if (label) {
      updateLabel.mutate(
        {
          data: {
            ...(dirtyFields.color ? { color: normalized.color } : {}),
            ...(dirtyFields.name ? { name: normalized.name } : {}),
            version,
          },
          labelId: label.id,
        },
        {
          onError: handleError,
          onSuccess: async () => {
            await onSaved('update');
            onClose();
          },
        },
      );
      return;
    }

    createLabel.mutate(
      { data: normalized },
      {
        onError: handleError,
        onSuccess: async () => {
          await onSaved('create');
          onClose();
        },
      },
    );
  });

  function requestClose() {
    if (isDirty) {
      setShowDiscardConfirmation(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            requestClose();
          }
        }}
      >
        <DialogContent closeLabel={labels.cancel}>
          <form noValidate aria-busy={mutation.isPending} onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{label ? labels.editTitle : labels.createTitle}</DialogTitle>
              <DialogDescription>
                {label ? labels.editDescription : labels.createDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="my-5 flex flex-col gap-5">
              {isConflict ? (
                <Alert>
                  <CircleAlert aria-hidden="true" data-icon="inline-start" />
                  <AlertTitle>{labels.conflictTitle}</AlertTitle>
                  <AlertDescription>{labels.conflictDescription}</AlertDescription>
                  <AlertAction>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const currentVersion = mutationError?.body.currentVersion;
                        if (currentVersion) {
                          setVersion(currentVersion);
                          mutation.reset();
                        } else {
                          void onReloadLatest();
                        }
                      }}
                    >
                      {labels.reloadLatest}
                    </Button>
                  </AlertAction>
                </Alert>
              ) : null}
              {mutation.isError && !hasMappedError && !isConflict ? (
                <Alert variant="destructive">
                  <AlertTitle>{labels.saveErrorTitle}</AlertTitle>
                  <AlertDescription>{labels.saveErrorDescription}</AlertDescription>
                </Alert>
              ) : null}

              <FieldGroup>
                <Field data-invalid={Boolean(form.formState.errors.name)}>
                  <FieldLabel htmlFor="label-name">{labels.nameLabel}</FieldLabel>
                  <Input
                    id="label-name"
                    autoComplete="off"
                    aria-errormessage={form.formState.errors.name ? 'label-name-error' : undefined}
                    aria-invalid={Boolean(form.formState.errors.name)}
                    maxLength={50}
                    placeholder={labels.namePlaceholder}
                    {...form.register('name')}
                  />
                  <FieldError id="label-name-error" errors={[form.formState.errors.name]} />
                </Field>

                <FieldSet data-invalid={Boolean(form.formState.errors.color)}>
                  <FieldLegend variant="label">{labels.colorLabel}</FieldLegend>
                  <div data-slot="radio-group" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {colorOptions.map((option) => (
                      <label
                        key={option.value}
                        className="border-border bg-background hover:bg-muted focus-within:border-ring focus-within:ring-ring/50 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10 flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-sm outline-none focus-within:ring-2"
                      >
                        <input
                          type="radio"
                          value={option.value}
                          className="sr-only"
                          aria-describedby="label-color-description label-color-error"
                          aria-errormessage={
                            form.formState.errors.color ? 'label-color-error' : undefined
                          }
                          aria-invalid={Boolean(form.formState.errors.color)}
                          {...form.register('color')}
                        />
                        <span
                          aria-hidden="true"
                          className="size-4 shrink-0 rounded-full border"
                          style={{ backgroundColor: option.value }}
                        />
                        <span
                          className={
                            option.label === 'colorCustom' ? undefined : 'whitespace-nowrap'
                          }
                        >
                          {labels[option.label]}
                          {option.label === 'colorCustom' ? ` (${option.value})` : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                  <FieldDescription id="label-color-description">
                    {labels.colorDescription}
                  </FieldDescription>
                  <FieldError id="label-color-error" errors={[form.formState.errors.color]} />
                </FieldSet>
              </FieldGroup>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={requestClose}
              >
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending || Boolean(label && !isDirty)}>
                {mutation.isPending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {label ? labels.saveChanges : labels.createLabel}
              </Button>
            </DialogFooter>
            {mutation.isPending ? (
              <span role="status" className="sr-only">
                {labels.saving}
              </span>
            ) : null}
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
            <AlertDialogAction type="button" variant="destructive" onClick={onClose}>
              {labels.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ArchiveLabelDialog({
  label,
  labels,
  onClose,
  onReloadLatest,
  onSaved,
}: {
  label: LabelResponseDto;
  labels: LabelSettingsLabels;
  onClose: () => void;
  onReloadLatest: () => Promise<void>;
  onSaved: (change: LabelChange) => Promise<void>;
}) {
  const archiveLabel = useLabelsControllerArchive();
  const isConflict = archiveLabel.error?.body.code === 'VERSION_CONFLICT';

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !archiveLabel.isPending) {
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.archiveTitle}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <strong className="text-foreground font-medium">{label.name}</strong>
            <span>{labels.archiveDescription}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isConflict ? (
          <Alert>
            <AlertTitle>{labels.conflictTitle}</AlertTitle>
            <AlertDescription>{labels.conflictDescription}</AlertDescription>
            <AlertAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  archiveLabel.reset();
                  onClose();
                  void onReloadLatest();
                }}
              >
                {labels.reloadLatest}
              </Button>
            </AlertAction>
          </Alert>
        ) : archiveLabel.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{labels.archiveErrorTitle}</AlertTitle>
            <AlertDescription>{labels.archiveErrorDescription}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={archiveLabel.isPending}>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={archiveLabel.isPending}
            onClick={() =>
              archiveLabel.mutate(
                { data: { version: label.version }, labelId: label.id },
                {
                  onSuccess: async () => {
                    await onSaved('archive');
                    onClose();
                  },
                },
              )
            }
          >
            {archiveLabel.isPending ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : null}
            {labels.archiveAction}
          </AlertDialogAction>
        </AlertDialogFooter>
        {archiveLabel.isPending ? (
          <span role="status" className="sr-only">
            {labels.archiving}
          </span>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LabelSettingsScreen({ labels }: { labels: LabelSettingsLabels }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<LabelTab>('active');
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [formLabel, setFormLabel] = useState<LabelResponseDto | null | undefined>();
  const [archiveLabel, setArchiveLabel] = useState<LabelResponseDto | null>(null);
  const params: LabelsControllerListParams = {
    archivedOnly: tab === 'archived',
    includeArchived: tab === 'archived',
    limit: 20,
    ...(cursor ? { cursor } : {}),
    ...(query ? { query } : {}),
  };
  const labelsQuery = useLabelsControllerList(params, { query: { retry: false } });
  const visibleItems =
    labelsQuery.data?.items.filter((label) =>
      tab === 'archived' ? label.archived : !label.archived,
    ) ?? [];
  const isForbidden = Boolean(
    labelsQuery.error &&
    (labelsQuery.error.status === 403 ||
      ['FORBIDDEN', 'MEMBERSHIP_INACTIVE'].includes(labelsQuery.error.body.code)),
  );

  function resetPagination() {
    setCursor(undefined);
    setPreviousCursors([]);
  }

  async function reloadLabels(change?: LabelChange) {
    resetPagination();
    if (change === 'create') {
      setTab('active');
    }
    await queryClient.invalidateQueries({ queryKey: getLabelsControllerListQueryKey() });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(draftQuery.normalize('NFC').trim());
    resetPagination();
  }

  function clearSearch() {
    setDraftQuery('');
    setQuery('');
    resetPagination();
  }

  function nextPage() {
    const nextCursor = labelsQuery.data?.nextCursor;
    if (!nextCursor) {
      return;
    }
    setPreviousCursors((previous) => [...previous, cursor]);
    setCursor(nextCursor);
  }

  function previousPage() {
    if (previousCursors.length === 0) {
      return;
    }
    setCursor(previousCursors.at(-1));
    setPreviousCursors((previous) => previous.slice(0, -1));
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeading title={labels.title} description={labels.description} />

      <div className="flex items-end justify-between gap-4">
        <form
          role="search"
          className="flex max-w-xl flex-1 items-end gap-2"
          onSubmit={submitSearch}
        >
          <FieldGroup className="flex-1">
            <Field>
              <FieldLabel htmlFor="label-search" className="sr-only">
                {labels.searchLabel}
              </FieldLabel>
              <Input
                id="label-search"
                type="search"
                value={draftQuery}
                maxLength={100}
                placeholder={labels.searchPlaceholder}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" variant="outline">
            <Search data-icon="inline-start" aria-hidden="true" />
            {labels.search}
          </Button>
          {draftQuery || query ? (
            <Button type="button" variant="ghost" onClick={clearSearch}>
              <X data-icon="inline-start" aria-hidden="true" />
              {labels.clearSearch}
            </Button>
          ) : null}
        </form>
        <Button type="button" onClick={() => setFormLabel(null)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {labels.createLabel}
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === 'active' || value === 'archived') {
            setTab(value);
            resetPagination();
          }
        }}
      >
        <TabsList variant="line" aria-label={labels.tabsLabel}>
          <TabsTrigger value="active">{labels.activeTab}</TabsTrigger>
          <TabsTrigger value="archived">{labels.archivedTab}</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {tab === 'active' ? (
            <LabelResults
              hasNextPage={Boolean(labelsQuery.data?.nextCursor)}
              hasPreviousPage={previousCursors.length > 0}
              isError={labelsQuery.isError}
              isForbidden={isForbidden}
              isPending={labelsQuery.isPending}
              items={visibleItems}
              labels={labels}
              onArchive={setArchiveLabel}
              onClearSearch={clearSearch}
              onCreate={() => setFormLabel(null)}
              onEdit={setFormLabel}
              onNextPage={nextPage}
              onPreviousPage={previousPage}
              onRetry={() => void labelsQuery.refetch()}
              query={query}
              tab={tab}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="archived">
          {tab === 'archived' ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <Archive aria-hidden="true" data-icon="inline-start" />
                <AlertTitle>{labels.archivedNoticeTitle}</AlertTitle>
                <AlertDescription>{labels.archivedNoticeDescription}</AlertDescription>
              </Alert>
              <LabelResults
                hasNextPage={Boolean(labelsQuery.data?.nextCursor)}
                hasPreviousPage={previousCursors.length > 0}
                isError={labelsQuery.isError}
                isForbidden={isForbidden}
                isPending={labelsQuery.isPending}
                items={visibleItems}
                labels={labels}
                onArchive={setArchiveLabel}
                onClearSearch={clearSearch}
                onCreate={() => setFormLabel(null)}
                onEdit={setFormLabel}
                onNextPage={nextPage}
                onPreviousPage={previousPage}
                onRetry={() => void labelsQuery.refetch()}
                query={query}
                tab={tab}
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {formLabel !== undefined ? (
        <LabelFormDialog
          label={formLabel}
          labels={labels}
          onClose={() => setFormLabel(undefined)}
          onReloadLatest={reloadLabels}
          onSaved={reloadLabels}
        />
      ) : null}
      {archiveLabel ? (
        <ArchiveLabelDialog
          label={archiveLabel}
          labels={labels}
          onClose={() => setArchiveLabel(null)}
          onReloadLatest={reloadLabels}
          onSaved={reloadLabels}
        />
      ) : null}
    </div>
  );
}
