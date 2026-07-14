'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import {
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  getProjectsControllerGetQueryKey,
  getProjectsControllerListQueryKey,
  useIssuesControllerCreate,
  useLabelsControllerList,
  useProjectsControllerList,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { FileUploadQueue } from '@/features/files/file-upload-queue';
import { useRouter } from '@/i18n/navigation';

import { fileUploadQueueLabels } from './issue-collaboration-labels';
import { issueWorkHref } from './issue-work-routing';

const PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const PROJECT_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;
type ProjectRole = (typeof PROJECT_ROLES)[number];

export type IssueCreateSeed = { projectId?: string };

export type IssueCreateLabels = {
  cancel: string;
  close: string;
  description: string;
  errorDescription: string;
  errorTitle: string;
  initialRolesDescription: string;
  initialRolesLabel: string;
  labelsLabel: string;
  noLabels: string;
  optionsErrorDescription: string;
  optionsErrorTitle: string;
  optionsLoading: string;
  priorities: Record<(typeof PRIORITIES)[number], string>;
  priorityLabel: string;
  projectLabel: string;
  projectPlaceholder: string;
  projectRequired: string;
  projectRoles: Record<ProjectRole, string>;
  submit: string;
  submitting: string;
  title: string;
  titleLabel: string;
  titlePlaceholder: string;
  titleRequired: string;
};

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
  const queryClient = useQueryClient();
  const router = useRouter();
  const projects = useProjectsControllerList(
    { includeArchived: false, limit: 100, sort: 'updatedAt', sortDirection: 'desc' },
    { query: { enabled: open, retry: false } },
  );
  const labelsQuery = useLabelsControllerList(
    { includeArchived: false, limit: 100 },
    { query: { enabled: open, retry: false } },
  );
  const create = useIssuesControllerCreate();
  const [title, setTitle] = useState('');
  const [descriptionMarkdown, setDescriptionMarkdown] = useState('');
  const [projectId, setProjectId] = useState(seed?.projectId ?? '');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('NONE');
  const [initialRoles, setInitialRoles] = useState<ProjectRole[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [attachmentFileIds, setAttachmentFileIds] = useState<string[]>([]);
  const [filesReady, setFilesReady] = useState(true);
  const [showErrors, setShowErrors] = useState(false);

  const selectedProject = projects.data?.items.find((project) => project.id === projectId);
  const availableRoles = useMemo(
    () => new Set((selectedProject?.roleTeams ?? []).map(({ role }) => role)),
    [selectedProject],
  );
  const setFileIds = useCallback((ids: string[]) => setAttachmentFileIds(ids), []);

  function reset() {
    setTitle('');
    setDescriptionMarkdown('');
    setProjectId('');
    setPriority('NONE');
    setInitialRoles([]);
    setLabelIds([]);
    setAttachmentFileIds([]);
    setFilesReady(true);
    setShowErrors(false);
    create.reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !projectId || !filesReady) {
      setShowErrors(true);
      return;
    }
    const result = await create.mutateAsync({
      data: {
        attachmentFileIds,
        descriptionMarkdown: descriptionMarkdown.trim() || null,
        initialRoles: initialRoles.map((projectRole) => ({ projectRole })),
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
    queryClient.setQueryData(getIssuesControllerGetQueryKey(result.issue.identifier), result.issue);
    reset();
    onOpenChange(false);
    const selected = result.createdTeamWorks[0];
    router.push(issueWorkHref(result.issue.identifier, selected?.identifier));
  }

  const optionError = projects.isError || labelsQuery.isError;
  const activeLabels = (labelsQuery.data?.items ?? []).filter((label) => !label.archived);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent closeLabel={labels.close} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          {optionError ? (
            <Alert variant="destructive"><AlertTitle>{labels.optionsErrorTitle}</AlertTitle><AlertDescription>{labels.optionsErrorDescription}</AlertDescription></Alert>
          ) : null}
          {create.isError ? (
            <Alert variant="destructive"><AlertTitle>{labels.errorTitle}</AlertTitle><AlertDescription>{labels.errorDescription}</AlertDescription></Alert>
          ) : null}
          <label className="grid gap-2 text-sm font-medium" htmlFor="issue-create-title">
            {labels.titleLabel}
            <Input id="issue-create-title" autoFocus maxLength={500} value={title} placeholder={labels.titlePlaceholder} onChange={(event) => setTitle(event.target.value)} />
            {showErrors && !title.trim() ? <span className="text-destructive text-xs">{labels.titleRequired}</span> : null}
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="issue-create-project">
            {labels.projectLabel}
            <select id="issue-create-project" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={projectId} onChange={(event) => { setProjectId(event.target.value); setInitialRoles([]); }}>
              <option value="">{projects.isPending ? labels.optionsLoading : labels.projectPlaceholder}</option>
              {(projects.data?.items ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {showErrors && !projectId ? <span className="text-destructive text-xs">{labels.projectRequired}</span> : null}
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="issue-create-description">
            설명 (Markdown)
            <textarea id="issue-create-description" className="border-input bg-background min-h-32 resize-y rounded-md border px-3 py-2 font-mono text-sm" maxLength={100000} value={descriptionMarkdown} onChange={(event) => setDescriptionMarkdown(event.target.value)} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium" htmlFor="issue-create-priority">
              {labels.priorityLabel}
              <select id="issue-create-priority" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
                {PRIORITIES.map((value) => <option key={value} value={value}>{labels.priorities[value]}</option>)}
              </select>
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{labels.initialRolesLabel}</legend>
              <p className="text-muted-foreground text-xs">{labels.initialRolesDescription}</p>
              <div className="flex flex-wrap gap-3">
                {PROJECT_ROLES.filter((role) => availableRoles.has(role)).map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={initialRoles.includes(role)} onCheckedChange={(checked) => setInitialRoles((current) => checked ? [...current, role] : current.filter((item) => item !== role))} />
                    {labels.projectRoles[role]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{labels.labelsLabel}</legend>
            <div className="flex flex-wrap gap-3">
              {activeLabels.length === 0 ? <span className="text-muted-foreground text-sm">{labels.noLabels}</span> : activeLabels.map((label) => (
                <label key={label.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={labelIds.includes(label.id)} onCheckedChange={(checked) => setLabelIds((current) => checked ? [...current, label.id] : current.filter((id) => id !== label.id))} />
                  {label.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2"><span className="text-sm font-medium">첨부파일</span><FileUploadQueue labels={fileUploadQueueLabels(filesT)} onFileIdsChange={setFileIds} onReadyChange={setFilesReady} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" disabled={create.isPending || !filesReady}>{create.isPending ? <><Spinner />{labels.submitting}</> : labels.submit}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
