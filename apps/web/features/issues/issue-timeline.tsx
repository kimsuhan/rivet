'use client';

import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { UserAvatar } from '@/components/user-avatar';
import { MarkdownEditor, type MentionOption } from '@/features/collaboration/markdown-editor';
import { MarkdownRenderer } from '@/features/collaboration/markdown-renderer';

import { markdownEditorLabels } from './issue-collaboration-labels';
import { extractHandoffApiSpecificationUrl } from './issue-handoff-validation';

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
  if (eventType === 'ISSUE_BLOCK_RELATION_ADDED') return t('timeline.activity.blockAdded');
  if (eventType === 'ISSUE_BLOCK_RELATION_REMOVED') return t('timeline.activity.blockRemoved');
  if (eventType !== 'ISSUE_UPDATED') return t('timeline.activity.updated');

  const fields: Record<string, string> = {
    assigneeMembershipId: 'assignee',
    descriptionMarkdown: 'description',
    featureStatus: 'state',
    labelIds: 'labels',
    parentIssueId: 'parent',
    priority: 'priority',
    projectId: 'project',
    projectRole: 'projectRole',
    title: 'title',
    workflowStateId: 'state',
  };
  return t(`timeline.activity.fields.${fields[fieldName ?? ''] ?? 'default'}` as never);
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
            <MarkdownEditor
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

export function IssueTimeline({
  currentMembershipId,
  issueId,
  mentionOptions,
}: {
  currentMembershipId: string | null;
  issueId: string;
  mentionOptions: MentionOption[];
}) {
  const t = useTranslations('IssueDetail');
  const markdownT = useTranslations('Markdown');
  const queryClient = useQueryClient();
  const [commentDraft, setCommentDraft] = useState('');
  const [canSubmitComment, setCanSubmitComment] = useState(true);
  const createComment = useIssueCollaborationControllerCreateComment();
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
  const items = (timeline.data?.pages ?? []).flatMap((page) =>
    page.items.filter((item) => {
      const id = timelineItemId(item);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  );
  const commentBody = commentDraft.trim().length ? commentDraft : null;
  const timelineError = timeline.isError ? (
    <Alert variant="destructive" className="mt-3">
      <AlertTitle>{t('timeline.errorTitle')}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{t('timeline.errorDescription')}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => void timeline.refetch()}>
          {t('retry')}
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  return (
    <section aria-labelledby="issue-timeline-title" className="mt-8">
      <div className="flex items-center gap-2">
        <ActivityIcon aria-hidden="true" className="text-muted-foreground size-4" />
        <h2 id="issue-timeline-title" className="text-base font-semibold">
          {t('timeline.title')}
        </h2>
      </div>

      {timeline.data ? timelineError : null}
      {timeline.isError && !timeline.data ? (
        timelineError
      ) : timeline.isPending ? (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          {t('timeline.loading')}
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground mt-3 border-y py-4 text-sm">{t('timeline.empty')}</p>
      ) : (
        <>
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

              if (item.type === 'HANDOFF') {
                const url = extractHandoffApiSpecificationUrl(item.handoff.bodyMarkdown);
                return (
                  <li
                    id={`handoff-${item.handoff.id}`}
                    key={item.handoff.id}
                    className="relative scroll-mt-20 pb-4 last:pb-0"
                  >
                    <span className="bg-primary absolute top-2 -left-[1.31rem] size-2 rounded-full" />
                    <article className="bg-surface-1 min-w-0 rounded-xl border p-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <SendIcon aria-hidden="true" className="text-primary size-4" />
                        <h3 className="text-sm font-semibold">
                          {item.handoff.kind === 'INITIAL'
                            ? t('handoff.initial')
                            : t('handoff.followUp')}
                        </h3>
                        <Badge variant="secondary">#{item.handoff.sequenceNumber}</Badge>
                        <time
                          dateTime={item.createdAt}
                          className="text-muted-foreground ml-auto text-xs"
                        >
                          {formatDate(item.createdAt)}
                        </time>
                      </div>
                      <div className="text-muted-foreground mt-2 flex min-w-0 items-center gap-1.5 text-xs">
                        <UserAvatar
                          avatarFileId={item.handoff.author.user.avatarFileId}
                          displayName={item.handoff.author.user.displayName}
                          size="sm"
                        />
                        <span className="truncate">{item.handoff.author.user.displayName}</span>
                      </div>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary mt-3 inline-flex max-w-full items-center gap-1 truncate text-sm underline underline-offset-4"
                        >
                          <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
                          {url}
                        </a>
                      ) : null}
                      <details className="mt-3">
                        <summary className="text-muted-foreground cursor-pointer text-sm">
                          {t('handoff.showBody')}
                        </summary>
                        <MarkdownRenderer
                          className="mt-2"
                          imageUnavailableLabel={markdownT('imageUnavailable')}
                          markdown={item.handoff.bodyMarkdown}
                        />
                      </details>
                    </article>
                  </li>
                );
              }

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
                      <time dateTime={item.createdAt} className="text-muted-foreground text-xs">
                        {formatDate(item.createdAt)}
                      </time>
                    </div>
                    {item.activity.actor ? (
                      <p className="text-muted-foreground mt-0.5 pl-8 text-xs">
                        {item.activity.actor.user.displayName}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
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
              {t('timeline.loadMore')}
            </Button>
          ) : null}
        </>
      )}

      <div className="mt-6 flex flex-col gap-3" aria-labelledby="new-comment-title">
        <div className="flex items-center gap-2">
          <MessageSquareIcon aria-hidden="true" className="text-muted-foreground size-4" />
          <h3 id="new-comment-title" className="text-sm font-semibold">
            {t('timeline.comments.write')}
          </h3>
        </div>
        <MarkdownEditor
          charLimit={50_000}
          disabled={createComment.isPending}
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
          <Button
            type="button"
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
    </section>
  );
}
