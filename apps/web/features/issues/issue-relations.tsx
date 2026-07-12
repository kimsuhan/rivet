'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Link2, RotateCcw, Trash2 } from 'lucide-react';
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
  empty,
  issue,
  label,
  onRemove,
  relations,
  removingId,
}: {
  empty: string;
  issue: TeamTaskIssue<IssueDetailResponseDto>;
  label: string;
  onRemove: (relation: IssueBlockRelationResponseDto) => void;
  relations: IssueBlockRelationResponseDto[];
  removingId: string | null;
}) {
  return (
    <details open className="group rounded-xl border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <Badge variant="secondary">{relations.length}</Badge>
      </summary>
      <div className="border-t px-3 py-2">
        {relations.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">{empty}</p>
        ) : (
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
                {relation.resolved ? <Badge variant="outline">해제됨</Badge> : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="hidden lg:inline-flex"
                  aria-label={`${relation.issue.identifier} 관계 해제`}
                  disabled={removingId !== null || issue.version < 1}
                  onClick={() => onRemove(relation)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
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
  const candidates = useIssuesControllerList(
    { limit: 100, type: 'TEAM_TASK' },
    { query: { retry: false } },
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
    <section aria-labelledby="issue-relations-title" className="mt-8">
      <div className="flex items-center gap-2">
        <Link2 aria-hidden="true" className="text-muted-foreground size-4" />
        <h2 id="issue-relations-title" className="text-base font-semibold">
          {t('relations.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{t('relations.description')}</p>

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

      <div className="mt-4 hidden grid-cols-[10rem_minmax(0,1fr)_auto] gap-2 lg:grid">
        <Select
          items={[
            { label: t('relations.blockedBy'), value: 'BLOCKED_BY' },
            { label: t('relations.blocks'), value: 'BLOCKS' },
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
          <SelectTrigger aria-label={t('relations.direction')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value="BLOCKED_BY">{t('relations.blockedBy')}</SelectItem>
              <SelectItem value="BLOCKS">{t('relations.blocks')}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={candidateItems.map((candidate) => ({
            label: `${candidate.identifier} · ${candidate.title}`,
            value: candidate.id,
          }))}
          value={targetId}
          onValueChange={setTargetId}
        >
          <SelectTrigger aria-label={t('relations.target')} className="w-full">
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
        <Button
          type="button"
          variant="outline"
          disabled={!targetId || createRelation.isPending}
          onClick={create}
        >
          {t('relations.add')}
        </Button>
      </div>

      <div className="mt-4 grid gap-3">
        <RelationGroup
          empty={t('relations.blockedByEmpty')}
          issue={issue}
          label={t('relations.blockedBy')}
          onRemove={remove}
          relations={activeBlockers}
          removingId={removingId}
        />
        <RelationGroup
          empty={t('relations.blocksEmpty')}
          issue={issue}
          label={t('relations.blocks')}
          onRemove={remove}
          relations={issue.blocking}
          removingId={removingId}
        />
        {resolvedBlockers.length > 0 ? (
          <RelationGroup
            empty={t('relations.resolvedEmpty')}
            issue={issue}
            label={t('relations.resolved')}
            onRemove={remove}
            relations={resolvedBlockers}
            removingId={removingId}
          />
        ) : null}
      </div>
    </section>
  );
}
