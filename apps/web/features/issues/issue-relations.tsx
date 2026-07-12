'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranch, Link2, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  ApiError,
  getIssuesControllerGetQueryKey,
  getIssuesControllerListQueryKey,
  type IssueBlockRelationResponseDto,
  type IssueDetailResponseDto,
  issuesControllerGet,
  useIssueBlockRelationsControllerCreate,
  useIssueBlockRelationsControllerRemove,
  useIssuesControllerList,
} from '@rivet/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@/i18n/navigation';

import type { TeamTaskIssue } from './issue-types';

type Direction = 'BLOCKED_BY' | 'BLOCKS';

function relationError(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('relations.errors.default');

  switch (error.body.code) {
    case 'BLOCK_RELATION_SELF':
      return t('relations.errors.self');
    case 'BLOCK_RELATION_DUPLICATE':
      return t('relations.errors.duplicate');
    case 'BLOCK_RELATION_CYCLE':
      return t('relations.errors.cycle');
    case 'VERSION_CONFLICT':
      return t('relations.errors.version');
    default:
      return t('relations.errors.default');
  }
}

function RelationGroup({
  issue,
  label,
  onRemove,
  relations,
  removeLabel,
  removingId,
  resolvedLabel,
}: {
  issue: TeamTaskIssue<IssueDetailResponseDto>;
  label: string;
  onRemove: (relation: IssueBlockRelationResponseDto) => void;
  relations: IssueBlockRelationResponseDto[];
  removeLabel: string;
  removingId: string | null;
  resolvedLabel: string;
}) {
  return (
    <details open className="group rounded-xl border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <Badge variant="secondary">{relations.length}</Badge>
      </summary>
      <div className="border-t px-3 py-2">
        <ul className="divide-y">
          {relations.map((relation) => (
            <li key={relation.id} className="flex min-w-0 items-center gap-2 py-2.5">
              <ArrowRight aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
              <Link
                href={`/issues/${encodeURIComponent(relation.issue.identifier)}`}
                className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
              >
                {relation.issue.identifier} · {relation.issue.title}
              </Link>
              {relation.resolved ? <Badge variant="outline">{resolvedLabel}</Badge> : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="hidden lg:inline-flex"
                aria-label={`${relation.issue.identifier} ${removeLabel}`}
                disabled={removingId !== null || issue.version < 1}
                onClick={() => onRemove(relation)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function IssueRelations({
  issue,
  t,
}: {
  issue: TeamTaskIssue<IssueDetailResponseDto>;
  t: (key: string) => string;
}) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<Direction>('BLOCKED_BY');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeReadError, setRemoveReadError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const candidates = useIssuesControllerList(
    { limit: 100, type: 'TEAM_TASK' },
    { query: { enabled: showCreate, retry: false } },
  );
  const createRelation = useIssueBlockRelationsControllerCreate();
  const removeRelation = useIssueBlockRelationsControllerRemove();
  const relatedIds = new Set(
    (direction === 'BLOCKED_BY' ? issue.blockers : issue.blocking).map(({ issue }) => issue.id),
  );
  const candidateItems = (candidates.data?.items ?? []).filter(
    (candidate) => candidate.id !== issue.id && !relatedIds.has(candidate.id),
  );
  const activeBlockers = issue.blockers.filter((relation) => !relation.resolved);
  const resolvedBlockers = issue.blockers.filter((relation) => relation.resolved);
  const hasRelations = issue.blockers.length > 0 || issue.blocking.length > 0;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.id) }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issue.identifier) }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerListQueryKey() }),
    ]);
  }

  function create() {
    const target = candidateItems.find((candidate) => candidate.id === targetId);
    if (!target || createRelation.isPending) return;

    createRelation.mutate(
      {
        data:
          direction === 'BLOCKED_BY'
            ? {
                blockedIssueId: issue.id,
                blockedIssueVersion: issue.version,
                blockingIssueId: target.id,
                blockingIssueVersion: target.version,
              }
            : {
                blockedIssueId: target.id,
                blockedIssueVersion: target.version,
                blockingIssueId: issue.id,
                blockingIssueVersion: issue.version,
              },
      },
      {
        onSuccess: () => {
          setTargetId(null);
          setShowCreate(false);
          void refresh();
        },
      },
    );
  }

  async function remove(relation: IssueBlockRelationResponseDto) {
    if (removingId || removeRelation.isPending) return;
    setRemovingId(relation.id);
    setRemoveReadError(false);

    try {
      const other = await issuesControllerGet(relation.issue.id);
      const currentBlocksOther = issue.blocking.some(({ id }) => id === relation.id);
      removeRelation.mutate(
        {
          data: currentBlocksOther
            ? { blockedIssueVersion: other.version, blockingIssueVersion: issue.version }
            : { blockedIssueVersion: issue.version, blockingIssueVersion: other.version },
          relationId: relation.id,
        },
        {
          onSettled: () => setRemovingId(null),
          onSuccess: () => void refresh(),
        },
      );
    } catch {
      setRemoveReadError(true);
      setRemovingId(null);
    }
  }

  const error = createRelation.error ?? removeRelation.error;

  return (
    <section
      aria-labelledby={
        hasRelations || showCreate ? 'issue-relations-title' : 'issue-relations-empty-title'
      }
      className="mt-8"
    >
      {hasRelations || showCreate ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link2 aria-hidden="true" className="text-muted-foreground size-4" />
            <h2 id="issue-relations-title" className="text-base font-semibold">
              {t('relations.title')}
            </h2>
            {hasRelations && !showCreate ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto hidden lg:inline-flex"
                onClick={() => setShowCreate(true)}
              >
                {t('relations.add')}
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">{t('relations.description')}</p>
        </>
      ) : null}

      {(error || removeReadError) && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>{t('relations.errorTitle')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{removeReadError ? t('relations.errors.default') : relationError(error, t)}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {showCreate ? (
        <FieldGroup className="mt-4 hidden grid-cols-[12rem_minmax(0,1fr)_auto] items-end gap-2 lg:grid">
          <Field>
            <FieldLabel htmlFor="issue-order-direction">{t('relations.direction')}</FieldLabel>
            <Select
              items={[
                { label: t('relations.before'), value: 'BLOCKED_BY' },
                { label: t('relations.after'), value: 'BLOCKS' },
              ]}
              value={direction}
              onValueChange={(value) => {
                if (value === 'BLOCKED_BY' || value === 'BLOCKS') {
                  setDirection(value);
                  setTargetId(null);
                  createRelation.reset();
                }
              }}
            >
              <SelectTrigger id="issue-order-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value="BLOCKED_BY">{t('relations.before')}</SelectItem>
                  <SelectItem value="BLOCKS">{t('relations.after')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="issue-order-target">{t('relations.target')}</FieldLabel>
            <Select
              items={candidateItems.map((candidate) => ({
                label: `${candidate.identifier} · ${candidate.title}`,
                value: candidate.id,
              }))}
              value={targetId}
              onValueChange={setTargetId}
            >
              <SelectTrigger id="issue-order-target" className="w-full">
                <SelectValue
                  placeholder={candidates.isPending ? t('loadingOptions') : t('relations.target')}
                />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {candidateItems.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.identifier} · {candidate.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!targetId || createRelation.isPending}
              onClick={create}
            >
              {t('relations.add')}
            </Button>
          </div>
        </FieldGroup>
      ) : null}

      {!hasRelations && !showCreate ? (
        <div className="bg-surface-1 rounded-xl border p-4">
          <div className="flex items-center gap-2">
            <GitBranch aria-hidden="true" className="text-muted-foreground size-4" />
            <h2 id="issue-relations-empty-title" className="text-base font-semibold">
              {t('relations.emptyTitle')}
            </h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">{t('relations.emptyDescription')}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 hidden lg:inline-flex"
            onClick={() => setShowCreate(true)}
          >
            {t('relations.add')}
          </Button>
        </div>
      ) : hasRelations ? (
        <div className="mt-4 grid gap-3">
          {activeBlockers.length > 0 ? (
            <RelationGroup
              issue={issue}
              label={t('relations.blockedBy')}
              onRemove={remove}
              relations={activeBlockers}
              removeLabel={t('relations.remove')}
              removingId={removingId}
              resolvedLabel={t('relations.available')}
            />
          ) : null}
          {issue.blocking.length > 0 ? (
            <RelationGroup
              issue={issue}
              label={t('relations.blocks')}
              onRemove={remove}
              relations={issue.blocking}
              removeLabel={t('relations.remove')}
              removingId={removingId}
              resolvedLabel={t('relations.available')}
            />
          ) : null}
          {resolvedBlockers.length > 0 ? (
            <RelationGroup
              issue={issue}
              label={t('relations.resolved')}
              onRemove={remove}
              relations={resolvedBlockers}
              removeLabel={t('relations.remove')}
              removingId={removingId}
              resolvedLabel={t('relations.available')}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
