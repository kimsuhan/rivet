'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  FileSearch,
  FileUp,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  csvImportControllerExecute,
  csvImportControllerInspect,
  csvImportControllerListRuns,
  csvImportControllerMappingOptions,
  csvImportControllerValidate,
  type CsvImportInspectionResponseDto,
  type CsvImportMappingOptionsResponseDto,
  type CsvImportPreviewErrorDto,
  type CsvImportRunResponseDto,
  type CsvImportValidationResponseDto,
} from '@rivet/api-client';

import { PageHeading } from '@/components/layout/page-heading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import {
  buildImportMapping,
  contextKey,
  CREATE,
  type CsvImportColumnMapping,
  type CsvImportValueContexts,
  type CsvImportValueSelections,
  deriveValueContexts,
  EXCLUDE,
  guessColumnMapping,
  hasRequiredColumns,
  IGNORE,
  initialValueSelections,
  NONE,
  parseLocalCsv,
  valueSelectionsComplete,
} from './csv-import-model';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type PendingAction = 'execute' | 'inspect' | 'validate' | null;
type MappingKind = keyof CsvImportValueSelections;
type SelectOption = { label: string; value: string };

const EMPTY_SELECTIONS: CsvImportValueSelections = {
  labels: {},
  members: {},
  priorities: {},
  projects: {},
  states: {},
  teams: {},
};

const COLUMN_FIELDS = [
  ['sourceKey', true],
  ['title', true],
  ['team', true],
  ['status', true],
  ['project', true],
  ['description', false],
  ['assignee', false],
  ['priority', false],
  ['labels', false],
] as const satisfies ReadonlyArray<[keyof CsvImportColumnMapping, boolean]>;

function apiErrorCode(error: unknown): string {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || !error.body) {
    return 'UNKNOWN';
  }
  return 'code' in error.body && typeof error.body.code === 'string' ? error.body.code : 'UNKNOWN';
}

function MappingSelect({
  ariaLabel,
  onChange,
  options,
  placeholder,
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  value: string;
}) {
  return (
    <Select
      items={options}
      value={value || null}
      onValueChange={(nextValue) => nextValue && onChange(nextValue)}
    >
      <SelectTrigger className="w-full max-w-md" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function MappingSection({
  children,
  count,
  description,
  title,
}: {
  children: React.ReactNode;
  count: number;
  description: string;
  title: string;
}) {
  if (count === 0) return null;
  return (
    <section className="border-t pt-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        </div>
        <Badge variant="outline">{count}</Badge>
      </div>
      <div className="divide-y">{children}</div>
    </section>
  );
}

function MappingRow({
  children,
  source,
  sourceContext,
}: {
  children: React.ReactNode;
  source: string;
  sourceContext?: string;
}) {
  return (
    <div className="grid gap-3 py-3 first:pt-0 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.2fr)] lg:items-center">
      <div className="min-w-0">
        {sourceContext ? (
          <p className="text-muted-foreground truncate text-xs">{sourceContext}</p>
        ) : null}
        <p className="truncate text-sm font-medium" title={source}>
          {source}
        </p>
      </div>
      {children}
    </div>
  );
}

function SummaryGrid({ summary }: { summary: CsvImportValidationResponseDto['summary'] }) {
  const t = useTranslations('Settings.import');
  const items = [
    ['projects', summary.projectCreateCount],
    ['issues', summary.issueCreateCount],
    ['connections', summary.connectionCreateCount],
    ['excluded', summary.excludedRowCount],
  ] as const;
  return (
    <dl className="bg-border grid gap-px overflow-hidden rounded-lg sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="bg-card px-4 py-3">
          <dt className="text-muted-foreground text-xs">{t(`summary.${label}`)}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CsvImportSettingsScreen() {
  const t = useTranslations('Settings.import');
  const format = useFormatter();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [executionId, setExecutionId] = useState('');
  const [inspection, setInspection] = useState<CsvImportInspectionResponseDto | null>(null);
  const [options, setOptions] = useState<CsvImportMappingOptionsResponseDto | null>(null);
  const [columns, setColumns] = useState<Partial<CsvImportColumnMapping>>({});
  const [contexts, setContexts] = useState<CsvImportValueContexts | null>(null);
  const [selections, setSelections] = useState<CsvImportValueSelections>(EMPTY_SELECTIONS);
  const [mapping, setMapping] = useState('');
  const [validation, setValidation] = useState<CsvImportValidationResponseDto | null>(null);
  const [result, setResult] = useState<CsvImportRunResponseDto | null>(null);
  const [history, setHistory] = useState<CsvImportRunResponseDto[]>([]);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void csvImportControllerListRuns({ limit: 5 })
      .then((response) => {
        if (!disposed) setHistory(response.items);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  const columnSelectionValid = useMemo(() => {
    if (!hasRequiredColumns(columns)) return false;
    const values = Object.values(columns).filter(Boolean);
    return (
      new Set(values).size === values.length &&
      !inspection?.unsupportedColumns.some((column) => values.includes(column))
    );
  }, [columns, inspection]);
  const ignoredColumns = useMemo(() => {
    if (!inspection) return [];
    const selected = new Set(Object.values(columns).filter(Boolean));
    return inspection.columns.filter((column) => !selected.has(column));
  }, [columns, inspection]);
  const mappingsComplete = Boolean(
    contexts && options && valueSelectionsComplete(contexts, selections),
  );

  function messageForCode(code: string): string {
    const key = `errors.${code}`;
    return t.has(key) ? String(t.raw(key)) : `${t('errors.UNKNOWN')} (${code})`;
  }

  function reset(): void {
    setStep(1);
    setFile(null);
    setExecutionId('');
    setInspection(null);
    setOptions(null);
    setColumns({});
    setContexts(null);
    setSelections(EMPTY_SELECTIONS);
    setMapping('');
    setValidation(null);
    setResult(null);
    setError(null);
  }

  async function inspectFile(): Promise<void> {
    if (!file || !executionId || pending) return;
    setPending('inspect');
    setError(null);
    try {
      const [nextInspection, nextOptions] = await Promise.all([
        csvImportControllerInspect({ executionId, file }),
        csvImportControllerMappingOptions(),
      ]);
      setInspection(nextInspection);
      setOptions(nextOptions);
      setColumns(guessColumnMapping(nextInspection.columns));
      if (nextInspection.errors.length > 0) {
        setError(nextInspection.errors[0]!.code);
      } else {
        setStep(2);
      }
    } catch (nextError) {
      setError(apiErrorCode(nextError));
    } finally {
      setPending(null);
    }
  }

  async function prepareValueMappings(): Promise<void> {
    if (!file || !inspection || !options || !hasRequiredColumns(columns) || !columnSelectionValid) {
      return;
    }
    setError(null);
    try {
      const localCsv = parseLocalCsv(await file.text());
      if (localCsv.columns.join('\u0000') !== inspection.columns.join('\u0000')) {
        setError('IMPORT_FILE_CHANGED');
        return;
      }
      const nextContexts = deriveValueContexts(localCsv.rows, columns);
      setContexts(nextContexts);
      setSelections(initialValueSelections(nextContexts, options));
      setStep(3);
    } catch {
      setError('IMPORT_CSV_INVALID');
    }
  }

  function setSelection(kind: MappingKind, key: string, value: string): void {
    setSelections((current) => ({
      ...current,
      [kind]: { ...current[kind], [key]: value },
    }));
  }

  function setTeamSelection(source: string, value: string): void {
    if (!contexts || !options) return;
    setSelections((current) => {
      const states = { ...current.states };
      const members = { ...current.members };
      for (const context of contexts.states.filter((item) => item.teamSource === source)) {
        const key = contextKey(context.source, context.teamSource);
        const state = options.states.find(
          (item) =>
            item.teamId === value &&
            item.name.normalize('NFC').trim().toLowerCase() ===
              context.source.normalize('NFC').trim().toLowerCase(),
        );
        states[key] = value === EXCLUDE ? EXCLUDE : (state?.id ?? '');
      }
      for (const context of contexts.members.filter((item) => item.teamSource === source)) {
        const key = contextKey(context.source, context.teamSource);
        if (
          !options.members.some(
            (member) => member.id === members[key] && member.teamIds.includes(value),
          )
        ) {
          members[key] = NONE;
        }
      }
      return { ...current, members, states, teams: { ...current.teams, [source]: value } };
    });
  }

  async function validateImport(): Promise<void> {
    if (!file || !inspection || !options || !contexts || !hasRequiredColumns(columns) || pending) {
      return;
    }
    const nextMapping = buildImportMapping(columns, contexts, selections, options);
    setMapping(nextMapping);
    setPending('validate');
    setError(null);
    try {
      const nextValidation = await csvImportControllerValidate({
        executionId,
        file,
        mapping: nextMapping,
      });
      setValidation(nextValidation);
      setStep(4);
    } catch (nextError) {
      setError(apiErrorCode(nextError));
    } finally {
      setPending(null);
    }
  }

  async function executeImport(): Promise<void> {
    if (!file || !validation?.validationSignature || !mapping || pending) return;
    setPending('execute');
    setError(null);
    try {
      const nextResult = await csvImportControllerExecute({
        executionId,
        file,
        mapping,
        validationSignature: validation.validationSignature,
      });
      setResult(nextResult);
      setHistory((current) =>
        [nextResult, ...current.filter((run) => run.id !== nextResult.id)].slice(0, 5),
      );
      setStep(6);
    } catch (nextError) {
      setError(apiErrorCode(nextError));
    } finally {
      setPending(null);
    }
  }

  function renderPreviewRows(rows: CsvImportPreviewErrorDto[]) {
    if (rows.length === 0) return null;
    return (
      <div className="overflow-hidden rounded-lg border">
        <div className="max-h-72 divide-y overflow-y-auto">
          {rows.map((item, index) => (
            <div
              key={`${item.code}-${item.rowNumber}-${item.field ?? ''}-${index}`}
              className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground tabular-nums">
                {t('row', { row: item.rowNumber })}
              </span>
              <span>
                {messageForCode(item.code)}
                {item.field ? <span className="text-muted-foreground"> · {item.field}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stepLabels = [
    t('steps.file'),
    t('steps.columns'),
    t('steps.values'),
    t('steps.validation'),
    t('steps.confirm'),
    t('steps.result'),
  ];

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeading title={t('title')} description={t('description')} />

      <div className="space-y-2" aria-label={t('progressLabel')}>
        <Progress value={(step / 6) * 100}>
          <ProgressLabel>{stepLabels[step - 1]}</ProgressLabel>
          <span className="text-muted-foreground ml-auto text-sm tabular-nums">
            {t('stepCount', { current: step, total: 6 })}
          </span>
        </Progress>
        <ol className="grid grid-cols-6 gap-1" aria-hidden="true">
          {stepLabels.map((label, index) => (
            <li
              key={label}
              className={cn(
                'truncate text-center text-[11px]',
                index + 1 <= step ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </li>
          ))}
        </ol>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('failureTitle')}</AlertTitle>
          <AlertDescription>{messageForCode(error)}</AlertDescription>
        </Alert>
      ) : null}

      {step === 1 ? (
        <>
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <FileUp aria-hidden="true" />
                {t('file.title')}
              </CardTitle>
              <CardDescription>{t('file.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="csv-import-file">{t('file.label')}</FieldLabel>
                <Input
                  id="csv-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setFile(nextFile);
                    setExecutionId(nextFile ? crypto.randomUUID() : '');
                    setError(null);
                  }}
                />
                <FieldDescription>{t('file.limits')}</FieldDescription>
              </Field>
              {file ? (
                <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
                  <span className="truncate font-medium">{file.name}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {format.number(file.size / 1024, { maximumFractionDigits: 1 })} KB
                  </span>
                </div>
              ) : null}
              <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>{t('privacy.title')}</AlertTitle>
                <AlertDescription>{t('privacy.description')}</AlertDescription>
              </Alert>
              <p className="text-muted-foreground text-sm leading-6">{t('unsupported')}</p>
            </CardContent>
            <CardFooter className="justify-end">
              <Button disabled={!file || pending !== null} onClick={() => void inspectFile()}>
                {pending === 'inspect' ? (
                  <Spinner aria-hidden="true" data-icon="inline-start" />
                ) : (
                  <FileSearch aria-hidden="true" data-icon="inline-start" />
                )}
                {pending === 'inspect' ? t('file.inspecting') : t('file.inspect')}
              </Button>
            </CardFooter>
          </Card>

          {history.length > 0 ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t('history.title')}</CardTitle>
                <CardDescription>{t('history.description')}</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {history.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="focus-visible:ring-ring flex w-full items-center justify-between gap-4 py-3 text-left outline-none focus-visible:ring-2"
                    onClick={() => {
                      setResult(run);
                      setStep(6);
                      setError(null);
                    }}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {t(`statuses.${run.status}`)}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {format.dateTime(new Date(run.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t('history.count', { count: run.inputRowCount })}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {step === 2 && inspection ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t('columns.title')}</CardTitle>
            <CardDescription>
              {t('columns.description', { count: inspection.rowCount })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {ignoredColumns.length > 0 ? (
              <Alert>
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{t('columns.unsupportedTitle')}</AlertTitle>
                <AlertDescription>
                  {t('columns.unsupportedDescription', {
                    columns: ignoredColumns.join(', '),
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {COLUMN_FIELDS.map(([field, required]) => {
                const selectOptions = [
                  ...(!required ? [{ label: t('columns.notUsed'), value: NONE }] : []),
                  ...inspection.columns
                    .filter((column) => !inspection.unsupportedColumns.includes(column))
                    .map((column) => ({ label: column, value: column })),
                ];
                return (
                  <Field key={field}>
                    <FieldLabel>
                      {t(`columns.fields.${field}`)}
                      {required ? <span className="text-destructive">*</span> : null}
                    </FieldLabel>
                    <MappingSelect
                      ariaLabel={t(`columns.fields.${field}`)}
                      options={selectOptions}
                      placeholder={t('columns.choose')}
                      value={columns[field] ?? (required ? '' : NONE)}
                      onChange={(value) =>
                        setColumns((current) => {
                          const next = { ...current };
                          if (value === NONE) delete next[field];
                          else next[field] = value;
                          return next;
                        })
                      }
                    />
                  </Field>
                );
              })}
            </div>
            {!columnSelectionValid ? (
              <p role="alert" className="text-destructive text-sm">
                {t('columns.incomplete')}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('back')}
            </Button>
            <Button disabled={!columnSelectionValid} onClick={() => void prepareValueMappings()}>
              {t('next')}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 3 && contexts && options ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t('values.title')}</CardTitle>
            <CardDescription>{t('values.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <MappingSection
              title={t('values.teams')}
              description={t('values.teamsDescription')}
              count={contexts.teams.length}
            >
              {contexts.teams.map((source) => (
                <MappingRow key={source} source={source}>
                  <MappingSelect
                    ariaLabel={t('values.targetFor', { source })}
                    value={selections.teams[source] ?? ''}
                    placeholder={t('values.choose')}
                    onChange={(value) => setTeamSelection(source, value)}
                    options={[
                      { label: t('values.exclude'), value: EXCLUDE },
                      ...options.teams.map((team) => ({
                        label: `${team.name} · ${team.key}`,
                        value: team.id,
                      })),
                    ]}
                  />
                </MappingRow>
              ))}
            </MappingSection>
            <MappingSection
              title={t('values.states')}
              description={t('values.statesDescription')}
              count={contexts.states.length}
            >
              {contexts.states.map(({ source, teamSource }) => {
                const key = contextKey(source, teamSource);
                const teamId = selections.teams[teamSource];
                return (
                  <MappingRow key={key} source={source} sourceContext={teamSource}>
                    <MappingSelect
                      ariaLabel={t('values.targetFor', { source })}
                      value={teamId === EXCLUDE ? EXCLUDE : (selections.states[key] ?? '')}
                      placeholder={t('values.choose')}
                      onChange={(value) => setSelection('states', key, value)}
                      options={[
                        { label: t('values.exclude'), value: EXCLUDE },
                        ...options.states
                          .filter((state) => state.teamId === teamId)
                          .map((state) => ({ label: state.name, value: state.id })),
                      ]}
                    />
                  </MappingRow>
                );
              })}
            </MappingSection>
            <MappingSection
              title={t('values.members')}
              description={t('values.membersDescription')}
              count={contexts.members.length}
            >
              {contexts.members.map(({ source, teamSource }) => {
                const key = contextKey(source, teamSource);
                const teamId = selections.teams[teamSource];
                return (
                  <MappingRow key={key} source={source} sourceContext={teamSource}>
                    <MappingSelect
                      ariaLabel={t('values.targetFor', { source })}
                      value={selections.members[key] ?? ''}
                      placeholder={t('values.choose')}
                      onChange={(value) => setSelection('members', key, value)}
                      options={[
                        { label: t('values.unassigned'), value: NONE },
                        ...options.members
                          .filter((member) => member.teamIds.includes(teamId ?? ''))
                          .map((member) => ({
                            label: `${member.displayName} · ${member.email}`,
                            value: member.id,
                          })),
                      ]}
                    />
                  </MappingRow>
                );
              })}
            </MappingSection>
            <MappingSection
              title={t('values.projects')}
              description={t('values.projectsDescription')}
              count={contexts.projects.length}
            >
              {contexts.projects.map((source) => (
                <MappingRow key={source} source={source}>
                  <MappingSelect
                    ariaLabel={t('values.targetFor', { source })}
                    value={selections.projects[source] ?? ''}
                    placeholder={t('values.choose')}
                    onChange={(value) => setSelection('projects', source, value)}
                    options={[
                      { label: t('values.create'), value: CREATE },
                      { label: t('values.exclude'), value: EXCLUDE },
                      ...options.projects.map((project) => ({
                        label: project.name,
                        value: project.id,
                      })),
                    ]}
                  />
                </MappingRow>
              ))}
            </MappingSection>
            <MappingSection
              title={t('values.priorities')}
              description={t('values.prioritiesDescription')}
              count={contexts.priorities.length}
            >
              {contexts.priorities.map((source) => (
                <MappingRow key={source} source={source}>
                  <MappingSelect
                    ariaLabel={t('values.targetFor', { source })}
                    value={selections.priorities[source] ?? ''}
                    placeholder={t('values.choose')}
                    onChange={(value) => setSelection('priorities', source, value)}
                    options={options.priorities.map((priority) => ({
                      label: t(`priorities.${priority}`),
                      value: priority,
                    }))}
                  />
                </MappingRow>
              ))}
            </MappingSection>
            <MappingSection
              title={t('values.labels')}
              description={t('values.labelsDescription')}
              count={contexts.labels.length}
            >
              {contexts.labels.map((source) => (
                <MappingRow key={source} source={source}>
                  <MappingSelect
                    ariaLabel={t('values.targetFor', { source })}
                    value={selections.labels[source] ?? ''}
                    placeholder={t('values.choose')}
                    onChange={(value) => setSelection('labels', source, value)}
                    options={[
                      { label: t('values.create'), value: CREATE },
                      { label: t('values.ignore'), value: IGNORE },
                      ...options.labels.map((label) => ({ label: label.name, value: label.id })),
                    ]}
                  />
                </MappingRow>
              ))}
            </MappingSection>
            {!mappingsComplete ? (
              <p role="alert" className="text-destructive text-sm">
                {t('values.incomplete')}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('back')}
            </Button>
            <Button
              disabled={!mappingsComplete || pending !== null}
              onClick={() => void validateImport()}
            >
              {pending === 'validate' ? (
                <Spinner aria-hidden="true" data-icon="inline-start" />
              ) : (
                <ShieldCheck aria-hidden="true" data-icon="inline-start" />
              )}
              {pending === 'validate' ? t('values.validating') : t('values.validate')}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 4 && validation ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t('validation.title')}</CardTitle>
            <CardDescription>
              {validation.canExecute ? t('validation.ready') : t('validation.blocked')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SummaryGrid summary={validation.summary} />
            {validation.errors.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-destructive font-medium">
                  {t('validation.errors', { count: validation.summary.errorCount })}
                </h3>
                {renderPreviewRows(validation.errors)}
              </section>
            ) : null}
            {validation.warnings.length > 0 ? (
              <section className="space-y-2">
                <h3 className="font-medium">
                  {t('validation.warnings', { count: validation.summary.warningCount })}
                </h3>
                {renderPreviewRows(validation.warnings)}
              </section>
            ) : null}
            {validation.canExecute ? (
              <Alert>
                <CircleCheck aria-hidden="true" />
                <AlertTitle>{t('validation.passTitle')}</AlertTitle>
                <AlertDescription>{t('validation.passDescription')}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('validation.edit')}
            </Button>
            <Button disabled={!validation.canExecute} onClick={() => setStep(5)}>
              {t('next')}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 5 && validation ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t('confirm.title')}</CardTitle>
            <CardDescription>{t('confirm.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SummaryGrid summary={validation.summary} />
            <Alert>
              <ShieldCheck aria-hidden="true" />
              <AlertTitle>{t('confirm.atomicTitle')}</AlertTitle>
              <AlertDescription>{t('confirm.atomicDescription')}</AlertDescription>
            </Alert>
            <p className="text-muted-foreground text-sm leading-6">{t('unsupported')}</p>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="ghost" onClick={() => setStep(4)}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('back')}
            </Button>
            <Button disabled={pending !== null} onClick={() => void executeImport()}>
              {pending === 'execute' ? (
                <Spinner aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Check aria-hidden="true" data-icon="inline-start" />
              )}
              {pending === 'execute' ? t('confirm.saving') : t('confirm.save')}
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {step === 6 && result ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              {result.status === 'SUCCEEDED' ? (
                <CircleCheck aria-hidden="true" className="text-success" />
              ) : (
                <AlertTriangle aria-hidden="true" className="text-destructive" />
              )}
              {t('result.title')}
            </CardTitle>
            <CardDescription>{t(`statuses.${result.status}`)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SummaryGrid
              summary={{
                connectionCreateCount: result.connectionCreatedCount,
                errorCount: result.errorCount,
                excludedRowCount: result.excludedRowCount,
                issueCreateCount: result.issueCreatedCount,
                projectCreateCount: result.projectCreatedCount,
                warningCount: 0,
              }}
            />
            {result.lastErrorCode ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{t('failureTitle')}</AlertTitle>
                <AlertDescription>{messageForCode(result.lastErrorCode)}</AlertDescription>
              </Alert>
            ) : null}
            {result.createdProjects.length > 0 || result.createdIssues.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <section>
                  <h3 className="mb-2 font-medium">{t('result.projects')}</h3>
                  <div className="flex flex-col gap-1">
                    {result.createdProjects.map((project) => (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="text-primary text-sm underline-offset-4 hover:underline"
                      >
                        {project.label}
                      </Link>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 font-medium">{t('result.issues')}</h3>
                  <div className="flex flex-col gap-1">
                    {result.createdIssues.map((issue) => (
                      <Link
                        key={issue.id}
                        href={`/issues/${issue.label}`}
                        className="text-primary text-sm underline-offset-4 hover:underline"
                      >
                        {issue.label}
                      </Link>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {t('result.executionId', { id: result.executionId })}
            </p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline" onClick={reset}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t('result.newImport')}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </section>
  );
}
