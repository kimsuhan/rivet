'use client';

import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIcon, MessageSquareIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import {
  ApiError,
  type CommentResourceResponseDto,
  getIssueCollaborationControllerTimelineQueryKey,
  getIssuesControllerGetQueryKey,
  issueCollaborationControllerTimeline,
  type TimelineResponseDto,
  useCommentsControllerRemove,
  useCommentsControllerUpdate,
  useIssueCollaborationControllerCreateComment,
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
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { UserAvatar } from '@/components/user-avatar';
import { CommentEditor, type MentionOption } from '@/features/collaboration/markdown-editor';
import { MarkdownRenderer } from '@/features/collaboration/markdown-renderer';
import { Link } from '@/i18n/navigation';

import { ISSUE_STATUS_PRESENTATION, PRIORITY_PRESENTATION } from './issue-attribute-presentation';
import { markdownEditorLabels } from './issue-collaboration-labels';
import { issueWorkHref } from './issue-work-routing';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function activityLabel(
  eventType: string,
  fieldName: string | null,
  t: ReturnType<typeof useTranslations<'IssueDetail'>>,
): string {
  if (eventType === 'ISSUE_CREATED') return t('timeline.activity.created');
  if (eventType === 'ISSUE_TRASHED') return t('timeline.activity.trashed');
  if (eventType === 'ISSUE_RESTORED') return t('timeline.activity.restored');
  if (eventType === 'TEAM_WORK_CREATED') return t('timeline.activity.teamWorkCreated');
  if (eventType === 'TEAM_WORK_REMOVED') return t('timeline.activity.teamWorkRemoved');
  if (eventType === 'TEAM_WORK_ASSIGNEE_CHANGED') {
    return t('timeline.activity.fields.teamWorkAssignee');
  }
  if (eventType === 'TEAM_WORK_CHANGED') {
    const teamWorkFields: Record<string, string> = {
      assigneeMembershipId: 'teamWorkAssignee',
      workNoteMarkdown: 'teamWorkWorkNote',
      workflowStateId: 'teamWorkState',
    };
    return t(
      `timeline.activity.fields.${teamWorkFields[fieldName ?? ''] ?? 'teamWorkDefault'}` as never,
    );
  }
  if (eventType !== 'ISSUE_CHANGED') return t('timeline.activity.updated');

  const fields: Record<string, string> = {
    descriptionMarkdown: 'description',
    labelIds: 'labels',
    priority: 'priority',
    projectId: 'project',
    status: 'state',
    title: 'title',
  };
  return t(`timeline.activity.fields.${fields[fieldName ?? ''] ?? 'default'}` as never);
}

function activityValueLabel(fieldName: string, value: unknown): string | null {
  if (value === null) return fieldName === 'assigneeMembershipId' ? '미할당' : null;
  if (value === undefined) return null;
  if (fieldName === 'priority' && typeof value === 'string') {
    return (PRIORITY_PRESENTATION as Record<string, { label: string }>)[value]?.label ?? null;
  }
  if (fieldName === 'status' && typeof value === 'string') {
    return (ISSUE_STATUS_PRESENTATION as Record<string, { label: string }>)[value]?.label ?? null;
  }
  if (fieldName === 'title' && typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.displayName === 'string') return record.displayName;
  }
  return null;
}

function activityValueChange(
  fieldName: string | null,
  before: unknown,
  after: unknown,
): string | null {
  if (!fieldName) return null;
  const beforeLabel = activityValueLabel(fieldName, before);
  const afterLabel = activityValueLabel(fieldName, after);
  // 전후 값을 모두 사람이 읽을 수 있는 라벨로 만들 수 있을 때만 표시하고 추측하지 않는다.
  if (beforeLabel === null || afterLabel === null || beforeLabel === afterLabel) return null;
  return `${beforeLabel} → ${afterLabel}`;
}

function commentError(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof ApiError)) return t('timeline.comments.errors.default');
  if (error.status === 409) return t('timeline.comments.errors.conflict');
  if (error.status === 403) return t('timeline.comments.errors.permission');
  const body = error.body;
  if (typeof body === 'object' && body && 'code' in body) {
    if (body.code === 'MENTION_INVALID') return t('timeline.comments.errors.mention');
    if (body.code === 'MARKDOWN_INVALID') return t('timeline.comments.errors.invalid');
    if (typeof body.code === 'string' && body.code.startsWith('FILE_')) {
      return t('timeline.comments.errors.file');
    }
  }
  return t('timeline.comments.errors.default');
}

function appendComment(
  data: InfiniteData<TimelineResponseDto, string | null> | undefined,
  comment: CommentResourceResponseDto,
): InfiniteData<TimelineResponseDto, string | null> {
  if (!data) {
    return {
      pageParams: [null],
      pages: [
        { items: [{ comment, createdAt: comment.createdAt, type: 'COMMENT' }], nextCursor: null },
      ],
    };
  }
  if (
    data.pages.some((page) =>
      page.items.some((item) => timelineItemId(item) === `comment-${comment.id}`),
    )
  ) {
    return data;
  }

  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index === data.pages.length - 1
        ? {
            ...page,
            items: [...page.items, { comment, createdAt: comment.createdAt, type: 'COMMENT' }],
          }
        : page,
    ),
  };
}

function updateComment(
  data: InfiniteData<TimelineResponseDto, string | null> | undefined,
  commentId: string,
  update: (comment: CommentResourceResponseDto) => CommentResourceResponseDto,
): InfiniteData<TimelineResponseDto, string | null> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.type === 'COMMENT' && item.comment.id === commentId
          ? { ...item, comment: update(item.comment) }
          : item,
      ),
    })),
  };
}

function CommentItem({
  comment,
  currentMembershipId,
  imageUnavailableLabel,
  mentionOptions,
  onDeleted,
  onUpdated,
  refresh,
}: {
  comment: CommentResourceResponseDto;
  currentMembershipId: string | null;
  imageUnavailableLabel: string;
  mentionOptions: MentionOption[];
  onDeleted: (comment: CommentResourceResponseDto) => void;
  onUpdated: (comment: CommentResourceResponseDto) => void;
  refresh: () => Promise<void>;
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const updateComment = useCommentsControllerUpdate();
  const removeComment = useCommentsControllerRemove();
  const [isEditing, setIsEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState(comment.bodyMarkdown ?? '');
  const [canSubmit, setCanSubmit] = useState(true);
  const isAuthor = currentMembershipId === comment.author.id;
  const canSave = canSubmit && draft.trim().length > 0 && draft !== comment.bodyMarkdown;

  return (
    <li id={`comment-${comment.id}`} className="relative scroll-mt-20 pb-4 last:pb-0">
      <span className="bg-border absolute top-3 -left-[1.31rem] size-2 rounded-full" />
      <article className="min-w-0 py-1">
        <header className="flex min-w-0 flex-wrap items-center gap-2">
          <UserAvatar
            avatarFileId={comment.author.user.avatarFileId}
            displayName={comment.author.user.displayName}
            size="sm"
          />
          <span className="truncate text-sm font-medium">{comment.author.user.displayName}</span>
          <time dateTime={comment.createdAt} className="text-muted-foreground text-xs">
            {formatDate(comment.createdAt)}
          </time>
          {comment.editedAt && !comment.deletedAt ? (
            <span className="text-muted-foreground text-xs">{t('timeline.comments.edited')}</span>
          ) : null}
          {isAuthor && !comment.deletedAt && !isEditing ? (
            <span className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title={t('timeline.comments.edit')}
                aria-label={t('timeline.comments.edit')}
                onClick={() => {
                  setDraft(comment.bodyMarkdown ?? '');
                  setIsEditing(true);
                }}
              >
                <PencilIcon data-icon="inline-start" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title={t('timeline.comments.delete')}
                aria-label={t('timeline.comments.delete')}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon data-icon="inline-start" />
              </Button>
            </span>
          ) : null}
        </header>

        {comment.deletedAt ? (
          <p className="text-muted-foreground mt-2 text-sm italic">
            {t('timeline.comments.deleted')}
          </p>
        ) : isEditing ? (
          <div className="mt-3 flex flex-col gap-3">
            <CommentEditor
              charLimit={50_000}
              disabled={updateComment.isPending}
              error={
                updateComment.isError
                  ? commentError(updateComment.error, (key) => t(key as never))
                  : null
              }
              labels={markdownEditorLabels(
                (key) => markdownT(key as never),
                (key) => String(markdownT.raw(key as never)),
              )}
              mentionOptions={mentionOptions}
              status={updateComment.isPending ? t('timeline.comments.saving') : null}
              value={draft}
              onCanSubmitChange={setCanSubmit}
              onChange={setDraft}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={updateComment.isPending}
                onClick={() => setIsEditing(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                disabled={!canSave || updateComment.isPending}
                onClick={() =>
                  updateComment.mutate(
                    {
                      commentId: comment.id,
                      data: { bodyMarkdown: draft, version: comment.version },
                    },
                    {
                      onError: (error) => {
                        if (error instanceof ApiError && error.status === 409) {
                          void refresh().catch(() => undefined);
                        }
                      },
                      onSuccess: (updated) => {
                        onUpdated(updated);
                        setIsEditing(false);
                        void refresh().catch(() => undefined);
                      },
                    },
                  )
                }
              >
                {t('timeline.comments.save')}
              </Button>
            </div>
          </div>
        ) : comment.bodyMarkdown ? (
          <MarkdownRenderer
            className="mt-2"
            imageUnavailableLabel={imageUnavailableLabel}
            markdown={comment.bodyMarkdown}
          />
        ) : null}
      </article>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!removeComment.isPending) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('timeline.comments.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('timeline.comments.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeComment.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {commentError(removeComment.error, (key) => t(key as never))}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeComment.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={removeComment.isPending}
              onClick={(event) => {
                event.preventDefault();
                removeComment.mutate(
                  { commentId: comment.id, params: { version: comment.version } },
                  {
                    onError: (error) => {
                      if (error instanceof ApiError && error.status === 409) {
                        void refresh().catch(() => undefined);
                      }
                    },
                    onSuccess: () => {
                      onDeleted(comment);
                      setDeleteOpen(false);
                      void refresh().catch(() => undefined);
                    },
                  },
                );
              }}
            >
              {t('timeline.comments.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function timelineItemId(item: TimelineResponseDto['items'][number]): string {
  if (item.type === 'COMMENT') return `comment-${item.comment.id}`;
  if (item.type === 'HANDOFF') return `handoff-${item.handoff.id}`;
  return `activity-${item.activity.id}`;
}

function readCommentQuoteLabel(issueId: string): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem('rivet.comment.quote-context');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { issueId: string; label: string };
    return parsed.issueId === issueId ? parsed.label : null;
  } catch {
    return null;
  }
}

export function IssueTimeline({
  currentMembershipId,
  issueId,
  issueIdentifier = issueId,
  mentionOptions,
  mode = 'comments',
}: {
  currentMembershipId: string | null;
  issueId: string;
  issueIdentifier?: string;
  mentionOptions: MentionOption[];
  mode?: 'activity' | 'comments';
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const queryClient = useQueryClient();
  const [commentDraft, setCommentDraft] = useState(() => {
    if (mode !== 'comments') return '';
    const label = readCommentQuoteLabel(issueId);
    return label ? `> ${label}\n\n` : '';
  });
  const [canSubmitComment, setCanSubmitComment] = useState(true);
  const createComment = useIssueCollaborationControllerCreateComment();

  useEffect(() => {
    if (mode !== 'comments') return;
    if (!readCommentQuoteLabel(issueId)) return;
    window.sessionStorage.removeItem('rivet.comment.quote-context');
    window.requestAnimationFrame(() => document.getElementById('comment-editor')?.focus());
  }, [issueId, mode]);
  const timeline = useInfiniteQuery({
    initialPageParam: null as string | null,
    queryKey: getIssueCollaborationControllerTimelineQueryKey(issueId, {
      limit: 20,
      sortDirection: 'asc',
    }),
    queryFn: ({ pageParam, signal }) =>
      issueCollaborationControllerTimeline(
        issueId,
        {
          limit: 20,
          sortDirection: 'asc',
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getIssueCollaborationControllerTimelineQueryKey(issueId),
      }),
      queryClient.invalidateQueries({ queryKey: getIssuesControllerGetQueryKey(issueId) }),
    ]);
  }

  function setTimelineData(
    update: (
      data: InfiniteData<TimelineResponseDto, string | null> | undefined,
    ) => InfiniteData<TimelineResponseDto, string | null> | undefined,
  ) {
    queryClient.setQueriesData<InfiniteData<TimelineResponseDto, string | null>>(
      { queryKey: getIssueCollaborationControllerTimelineQueryKey(issueId) },
      update,
    );
  }

  function cacheUpdatedComment(comment: CommentResourceResponseDto) {
    setTimelineData((data) => updateComment(data, comment.id, () => comment));
  }

  function cacheDeletedComment(comment: CommentResourceResponseDto) {
    setTimelineData((data) =>
      updateComment(data, comment.id, (current) => ({
        ...current,
        bodyMarkdown: null,
        deletedAt: new Date().toISOString(),
        version: current.version + 1,
      })),
    );
  }

  const seen = new Set<string>();
  const allItems = (timeline.data?.pages ?? []).flatMap((page) =>
    page.items.filter((item) => {
      const id = timelineItemId(item);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  );
  const items = allItems.filter((item) => {
    if (mode === 'comments') return item.type === 'COMMENT';
    return item.type === 'ACTIVITY';
  });
  const commentBody = commentDraft.trim().length ? commentDraft : null;

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(hash.slice(1));
      if (target && !target.closest('[hidden]')) {
        target.querySelector('details')?.setAttribute('open', '');
        target.scrollIntoView?.({ block: 'center' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [items.length, mode]);

  const loadingLabel =
    mode === 'comments' ? t('timeline.comments.loading') : t('timeline.activity.loading');
  const errorTitle =
    mode === 'comments' ? t('timeline.comments.errorTitle') : t('timeline.activity.errorTitle');
  const errorDescription =
    mode === 'comments'
      ? t('timeline.comments.errorDescription')
      : t('timeline.activity.errorDescription');
  const loadMoreLabel =
    mode === 'comments' ? t('timeline.comments.loadMore') : t('timeline.activity.loadMore');
  const timelineError = timeline.isError ? (
    <Alert variant="destructive" className="mt-3">
      <AlertTitle>{errorTitle}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{errorDescription}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void timeline.refetch()}>
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  const title = mode === 'comments' ? t('timeline.comments.title') : t('timeline.activity.title');
  const titleId = mode === 'comments' ? 'issue-comments-title' : 'issue-activity-title';

  return (
    <section
      aria-labelledby={titleId}
      className={mode === 'activity' ? 'scroll-mt-20' : 'mt-8 scroll-mt-20'}
    >
      <div className="flex items-center gap-2">
        {mode === 'comments' ? (
          <MessageSquareIcon aria-hidden="true" className="text-muted-foreground size-4" />
        ) : (
          <ActivityIcon aria-hidden="true" className="text-muted-foreground size-4" />
        )}
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
      </div>

      {timeline.data ? timelineError : null}
      {timeline.isError && !timeline.data ? (
        timelineError
      ) : timeline.isPending ? (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          {loadingLabel}
        </p>
      ) : items.length === 0 && !timeline.hasNextPage ? (
        <p className="text-muted-foreground mt-3 border-y py-4 text-sm">
          {mode === 'comments' ? t('timeline.comments.empty') : t('timeline.activity.empty')}
        </p>
      ) : items.length > 0 ? (
        <ol className="mt-4 border-l pl-4">
          {items.map((item) => {
            if (item.type === 'COMMENT') {
              return (
                <CommentItem
                  key={item.comment.id}
                  comment={item.comment}
                  currentMembershipId={currentMembershipId}
                  imageUnavailableLabel={markdownT('imageUnavailable')}
                  mentionOptions={mentionOptions}
                  onDeleted={cacheDeletedComment}
                  onUpdated={cacheUpdatedComment}
                  refresh={refresh}
                />
              );
            }

            if (item.type !== 'ACTIVITY') return null;
            const valueChange = activityValueChange(
              item.activity.fieldName,
              item.activity.before,
              item.activity.after,
            );
            return (
              <li key={item.activity.id} className="relative pb-4 last:pb-0">
                <span className="bg-border absolute top-2 -left-[1.31rem] size-2 rounded-full" />
                <div className="min-w-0 py-1 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {item.activity.actor ? (
                      <UserAvatar
                        avatarFileId={item.activity.actor.user.avatarFileId}
                        displayName={item.activity.actor.user.displayName}
                        size="sm"
                      />
                    ) : null}
                    <span className="font-medium">
                      {activityLabel(item.activity.eventType, item.activity.fieldName, t)}
                    </span>
                    {item.activity.teamWorkIdentifier ? (
                      <Link
                        href={issueWorkHref(issueIdentifier, item.activity.teamWorkIdentifier)}
                        className="text-muted-foreground font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {item.activity.teamWorkIdentifier}
                      </Link>
                    ) : null}
                    <time dateTime={item.createdAt} className="text-muted-foreground text-xs">
                      {formatDate(item.createdAt)}
                    </time>
                  </div>
                  {item.activity.actor || valueChange ? (
                    <p className="text-muted-foreground mt-0.5 pl-8 text-xs">
                      {item.activity.actor?.user.displayName}
                      {item.activity.actor && valueChange ? ' · ' : null}
                      {valueChange}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {timeline.hasNextPage ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {timeline.isFetchingNextPage ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : null}
          {loadMoreLabel}
        </Button>
      ) : null}

      {mode === 'comments' ? (
        <div className="mt-6 flex flex-col gap-3" aria-labelledby="new-comment-title">
          <div className="flex items-center gap-2">
            <MessageSquareIcon aria-hidden="true" className="text-muted-foreground size-4" />
            <h3 id="new-comment-title" className="text-sm font-semibold">
              {t('timeline.comments.write')}
            </h3>
          </div>
          <CommentEditor
            charLimit={50_000}
            disabled={createComment.isPending}
            editorId="comment-editor"
            error={
              createComment.isError
                ? commentError(createComment.error, (key) => t(key as never))
                : null
            }
            labels={markdownEditorLabels(
              (key) => markdownT(key as never),
              (key) => String(markdownT.raw(key as never)),
            )}
            mentionOptions={mentionOptions}
            status={createComment.isPending ? t('timeline.comments.saving') : null}
            value={commentDraft}
            onCanSubmitChange={setCanSubmitComment}
            onChange={setCommentDraft}
          />
          <div className="flex justify-end">
            {!commentBody ? (
              <p id="comment-submit-hint" className="sr-only">
                댓글 내용을 입력해야 댓글을 남길 수 있습니다.
              </p>
            ) : null}
            <Button
              type="button"
              aria-describedby={!commentBody ? 'comment-submit-hint' : undefined}
              disabled={!commentBody || !canSubmitComment || createComment.isPending}
              onClick={() => {
                if (!commentBody) return;
                createComment.mutate(
                  { data: { bodyMarkdown: commentDraft }, issueId },
                  {
                    onSuccess: (created) => {
                      setTimelineData((data) => appendComment(data, created));
                      setCommentDraft('');
                      void refresh().catch(() => undefined);
                    },
                  },
                );
              }}
            >
              {createComment.isPending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : null}
              {t('timeline.comments.submit')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
