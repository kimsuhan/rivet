'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, CircleCheck, GitBranch, Rocket, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  ApiError,
  getDeploymentsControllerListQueryKey,
  getIssuesControllerGetQueryKey,
  type IssueDetailResponseDto,
  useDeploymentsControllerUpdatePlan,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { deploymentProgress } from './deployment-presentation';

type Condition = 'INDEPENDENT' | 'TOGETHER' | `AFTER:${string}`;

function conditionFromWork(work: IssueDetailResponseDto['teamWorks'][number]): Condition {
  if (work.deploymentGroupId) return 'TOGETHER';
  if (work.deploymentPredecessorTeamWorkIds[0]) {
    return `AFTER:${work.deploymentPredecessorTeamWorkIds[0]}`;
  }
  return 'INDEPENDENT';
}

export function DeploymentPlanDialog({ issue }: { issue: IssueDetailResponseDto }) {
  const t = useTranslations('Deployments');
  const queryClient = useQueryClient();
  const mutation = useDeploymentsControllerUpdatePlan();
  const works = issue.teamWorks.filter(
    ({ deploymentStatus }) => deploymentStatus !== 'NOT_APPLICABLE',
  );
  const progress = deploymentProgress(works);
  const [open, setOpen] = useState(false);
  const [conditions, setConditions] = useState<Record<string, Condition>>({});
  const [validation, setValidation] = useState<string | null>(null);
  const togetherIds = works
    .filter((work) => conditions[work.id] === 'TOGETHER')
    .map((work) => work.id);
  const dependencies = works.flatMap((work) => {
    const condition = conditions[work.id];
    return condition?.startsWith('AFTER:')
      ? [{ dependent: work, predecessorId: condition.slice('AFTER:'.length) }]
      : [];
  });
  const isDirty = works.some(
    (work) => (conditions[work.id] ?? conditionFromWork(work)) !== conditionFromWork(work),
  );

  function conditionLabel(condition: Condition): string {
    if (condition === 'INDEPENDENT') return t('condition.independent');
    if (condition === 'TOGETHER') return t('condition.together');

    const predecessorId = condition.slice('AFTER:'.length);
    const predecessor = works.find(({ id }) => id === predecessorId);
    return t('condition.afterTeam', {
      team: predecessor?.projectTeam.team.name ?? t('condition.unknownPredecessor'),
    });
  }

  function openChanged(nextOpen: boolean) {
    if (nextOpen) {
      setConditions(Object.fromEntries(works.map((work) => [work.id, conditionFromWork(work)])));
      setValidation(null);
    }
    setOpen(nextOpen);
  }

  function save() {
    if (togetherIds.length === 1) {
      setValidation(t('plan.togetherValidation'));
      return;
    }
    mutation.mutate(
      {
        issueId: issue.id,
        data: {
          dependencies: dependencies.map(({ dependent, predecessorId }) => ({
            dependentTeamWorkId: dependent.id,
            predecessorTeamWorkId: predecessorId,
          })),
          togetherGroups: togetherIds.length > 1 ? [{ teamWorkIds: togetherIds }] : [],
          version: issue.version,
        },
      },
      {
        onSuccess: async (updated) => {
          queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.id), updated);
          queryClient.setQueryData(getIssuesControllerGetQueryKey(issue.identifier), updated);
          await queryClient.invalidateQueries({ queryKey: getDeploymentsControllerListQueryKey() });
          setOpen(false);
        },
      },
    );
  }

  const serverMessage =
    mutation.error instanceof ApiError &&
    mutation.error.body &&
    typeof mutation.error.body === 'object' &&
    typeof (mutation.error.body as { message?: unknown }).message === 'string'
      ? (mutation.error.body as { message: string }).message
      : null;

  return (
    <Dialog open={open} onOpenChange={openChanged}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {progress.completed === progress.total ? (
          <CircleCheck aria-hidden="true" data-icon="inline-start" />
        ) : (
          <Rocket aria-hidden="true" data-icon="inline-start" />
        )}
        {progress.completed === progress.total
          ? t('summary.complete', progress)
          : t('summary.progress', progress)}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('plan.title')}</DialogTitle>
          <DialogDescription>{t('plan.description')}</DialogDescription>
        </DialogHeader>

        <div className="divide-border overflow-hidden rounded-xl border">
          <div className="bg-muted/40 text-muted-foreground hidden grid-cols-[1fr_15rem] gap-4 px-4 py-2 text-xs font-medium sm:grid">
            <span>{t('plan.teamWorkColumn')}</span>
            <span>{t('plan.conditionColumn')}</span>
          </div>
          {works.map((work) => {
            const condition = conditions[work.id] ?? 'INDEPENDENT';
            return (
              <div
                key={work.id}
                className="grid gap-2 border-t p-4 first:border-t-0 sm:grid-cols-[1fr_15rem] sm:items-center"
              >
                <Label htmlFor={`deployment-condition-${work.id}`} className="min-w-0">
                  <span className="block truncate font-medium">{work.projectTeam.team.name}</span>
                  <span className="text-muted-foreground block font-mono text-xs">
                    {work.identifier}
                  </span>
                </Label>
                <Select
                  value={condition}
                  onValueChange={(value) => {
                    setValidation(null);
                    setConditions((current) => ({ ...current, [work.id]: value as Condition }));
                  }}
                >
                  <SelectTrigger id={`deployment-condition-${work.id}`}>
                    <SelectValue>{conditionLabel(condition)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INDEPENDENT">{t('condition.independent')}</SelectItem>
                    <SelectItem value="TOGETHER">{t('condition.together')}</SelectItem>
                    {works
                      .filter((candidate) => candidate.id !== work.id)
                      .map((candidate) => (
                        <SelectItem key={candidate.id} value={`AFTER:${candidate.id}`}>
                          {t('condition.afterTeam', {
                            team: candidate.projectTeam.team.name,
                          })}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        <section aria-labelledby="deployment-preview-title">
          <h3
            id="deployment-preview-title"
            className="text-muted-foreground mb-2 text-xs font-medium"
          >
            {t('plan.previewTitle')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {dependencies.map(({ dependent, predecessorId }) => {
              const predecessor = works.find(({ id }) => id === predecessorId);
              return (
                <Badge key={dependent.id} variant="outline" className="gap-1.5 px-2.5 py-1.5">
                  <GitBranch aria-hidden="true" className="size-3.5" />
                  {predecessor?.identifier ?? t('condition.unknownPredecessor')}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                  {dependent.identifier}
                </Badge>
              );
            })}
            {togetherIds.length > 0 ? (
              <Badge variant="outline" className="gap-1.5 px-2.5 py-1.5">
                <Users aria-hidden="true" className="size-3.5" />
                {t('plan.togetherPreview', {
                  works: works
                    .filter(({ id }) => togetherIds.includes(id))
                    .map(({ identifier }) => identifier)
                    .join(' + '),
                })}
              </Badge>
            ) : null}
            {dependencies.length === 0 && togetherIds.length === 0 ? (
              <span className="text-muted-foreground flex items-center gap-2 text-sm">
                <Rocket aria-hidden="true" className="size-4" />
                {t('plan.independentPreview')}
              </span>
            ) : null}
          </div>
        </section>

        {validation || mutation.isError ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t('plan.errorTitle')}</AlertTitle>
            <AlertDescription>
              {validation ?? serverMessage ?? t('plan.errorDescription')}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('plan.cancel')}
          </Button>
          <Button type="button" disabled={mutation.isPending || !isDirty} onClick={save}>
            {t('plan.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
