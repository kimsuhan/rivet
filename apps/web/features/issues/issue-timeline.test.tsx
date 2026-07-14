import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IssueTimeline } from './issue-timeline';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  timeline: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@rivet/api-client', () => ({
  ApiError: class ApiError extends Error {},
  getIssueCollaborationControllerTimelineQueryKey: (
    issueId: string,
    params?: Record<string, unknown>,
  ) => [`/api/v1/issues/${issueId}/timeline`, ...(params ? [params] : [])],
  getIssuesControllerGetQueryKey: (issueRef: string) => [`/api/v1/issues/${issueRef}`],
  issueCollaborationControllerTimeline: mocks.timeline,
  useCommentsControllerRemove: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: (variables: Record<string, unknown>, callbacks?: { onSuccess?: () => void }) => {
      mocks.remove(variables);
      mocks.timeline.mockResolvedValue({
        items: [
          {
            comment: {
              author: {
                id: 'membership-me',
                role: 'MEMBER',
                status: 'ACTIVE',
                user: { avatarFileId: null, displayName: '나', id: 'user-me' },
              },
              bodyMarkdown: null,
              createdAt: '2026-07-01T00:00:00.000Z',
              deletedAt: '2026-07-01T01:30:00.000Z',
              editedAt: '2026-07-01T01:00:00.000Z',
              id: 'comment-own',
              version: 3,
            },
            createdAt: '2026-07-01T00:00:00.000Z',
            type: 'COMMENT',
          },
        ],
        nextCursor: null,
      });
      callbacks?.onSuccess?.();
    },
  }),
  useCommentsControllerUpdate: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: (
      variables: {
        commentId: string;
        data: { bodyMarkdown: string; version: number };
      },
      callbacks?: { onSuccess?: (comment: Record<string, unknown>) => void },
    ) => {
      mocks.update(variables);
      const updated = {
        author: {
          id: 'membership-me',
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { avatarFileId: null, displayName: '나', id: 'user-me' },
        },
        bodyMarkdown: variables.data.bodyMarkdown,
        createdAt: '2026-07-01T00:00:00.000Z',
        deletedAt: null,
        editedAt: '2026-07-01T01:00:00.000Z',
        id: variables.commentId,
        version: variables.data.version + 1,
      };
      mocks.timeline.mockResolvedValue({
        items: [{ comment: updated, createdAt: updated.createdAt, type: 'COMMENT' }],
        nextCursor: null,
      });
      callbacks?.onSuccess?.(updated);
    },
  }),
  useIssueCollaborationControllerCreateComment: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: (
      variables: { data: { bodyMarkdown: string }; issueId: string },
      callbacks?: { onSuccess?: (comment: Record<string, unknown>) => void },
    ) => {
      mocks.create(variables);
      const created = {
        author: {
          id: 'membership-me',
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { avatarFileId: null, displayName: '나', id: 'user-me' },
        },
        bodyMarkdown: variables.data.bodyMarkdown,
        createdAt: '2026-07-01T02:00:00.000Z',
        deletedAt: null,
        editedAt: null,
        id: 'comment-created',
        version: 1,
      };
      mocks.timeline.mockResolvedValue({
        items: [
          {
            comment: {
              ...created,
              bodyMarkdown: null,
              createdAt: '2026-07-01T00:00:00.000Z',
              deletedAt: '2026-07-01T01:30:00.000Z',
              id: 'comment-own',
              version: 3,
            },
            createdAt: '2026-07-01T00:00:00.000Z',
            type: 'COMMENT',
          },
          { comment: created, createdAt: created.createdAt, type: 'COMMENT' },
        ],
        nextCursor: null,
      });
      callbacks?.onSuccess?.(created);
    },
  }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.raw = (key: string) => (key === 'characterCount' ? '{current}/{max}자' : key);
    return translate;
  },
}));

vi.mock('@/features/collaboration/markdown-editor', () => {
  const Editor = ({
    disabled,
    onCanSubmitChange,
    onChange,
    value,
  }: {
    disabled?: boolean;
    onCanSubmitChange: (ready: boolean) => void;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <textarea
      aria-label="mock-editor"
      disabled={disabled}
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value);
        onCanSubmitChange(true);
      }}
    />
  );
  return { CommentEditor: Editor, MarkdownEditor: Editor };
});

vi.mock('@/features/collaboration/markdown-renderer', () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => (
    <div data-testid="markdown-renderer">{markdown}</div>
  ),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const ownComment = {
  author: {
    id: 'membership-me',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '나', id: 'user-me' },
  },
  bodyMarkdown: '첫 댓글',
  createdAt: '2026-07-01T00:00:00.000Z',
  deletedAt: null,
  editedAt: null,
  id: 'comment-own',
  version: 1,
};

const otherComment = {
  author: {
    id: 'membership-other',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '다른 사람', id: 'user-other' },
  },
  bodyMarkdown: '다른 댓글',
  createdAt: '2026-07-01T00:30:00.000Z',
  deletedAt: null,
  editedAt: null,
  id: 'comment-other',
  version: 1,
};

const deletedComment = {
  ...otherComment,
  bodyMarkdown: null,
  deletedAt: '2026-07-01T01:00:00.000Z',
  id: 'comment-deleted',
};

let queryClient: QueryClient;

function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('IssueTimeline', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/issues/API-1');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.timeline.mockResolvedValue({
      items: [{ comment: ownComment, createdAt: ownComment.createdAt, type: 'COMMENT' }],
      nextCursor: null,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('커서 페이지를 중복 없이 이어 붙이고 작성자에게만 댓글 동작을 표시한다', async () => {
    mocks.timeline
      .mockResolvedValueOnce({
        items: [
          { comment: ownComment, createdAt: ownComment.createdAt, type: 'COMMENT' },
          { comment: otherComment, createdAt: otherComment.createdAt, type: 'COMMENT' },
        ],
        nextCursor: 'next-page',
      })
      .mockResolvedValueOnce({
        items: [
          { comment: ownComment, createdAt: ownComment.createdAt, type: 'COMMENT' },
          { comment: deletedComment, createdAt: deletedComment.createdAt, type: 'COMMENT' },
        ],
        nextCursor: null,
      });
    const user = userEvent.setup();
    render(
      <IssueTimeline currentMembershipId="membership-me" issueId="issue-id" mentionOptions={[]} />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText('첫 댓글')).toBeVisible();
    expect(screen.getByText('다른 댓글')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'timeline.comments.edit' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'timeline.comments.loadMore' }));

    expect(await screen.findByText('timeline.comments.deleted')).toBeVisible();
    expect(screen.getAllByText('첫 댓글')).toHaveLength(1);
    expect(mocks.timeline).toHaveBeenLastCalledWith(
      'issue-id',
      { cursor: 'next-page', limit: 20, sortDirection: 'asc' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('초기 타임라인이 있으면 백그라운드 갱신 실패에도 댓글을 유지한다', async () => {
    mocks.timeline
      .mockResolvedValueOnce({
        items: [{ comment: ownComment, createdAt: ownComment.createdAt, type: 'COMMENT' }],
        nextCursor: null,
      })
      .mockRejectedValueOnce(new Error('refresh failed'));
    render(
      <IssueTimeline currentMembershipId="membership-me" issueId="issue-id" mentionOptions={[]} />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText('첫 댓글')).toBeVisible();
    await queryClient.invalidateQueries({
      queryKey: ['/api/v1/issues/issue-id/timeline'],
    });

    expect(await screen.findByText('timeline.comments.errorTitle')).toBeVisible();
    expect(screen.getByText('첫 댓글')).toBeVisible();
    expect(screen.getByRole('button', { name: 'retry' })).toBeVisible();
  });

  it('자신의 댓글을 수정·삭제하고 새 댓글을 같은 타임라인 캐시에 반영한다', async () => {
    const user = userEvent.setup();
    render(
      <IssueTimeline currentMembershipId="membership-me" issueId="issue-id" mentionOptions={[]} />,
      { wrapper: Wrapper },
    );
    const comment = await screen.findByText('첫 댓글');
    const commentItem = comment.closest('li');
    if (!commentItem) throw new Error('comment item missing');

    await user.click(within(commentItem).getByRole('button', { name: 'timeline.comments.edit' }));
    const edit = within(commentItem).getByRole('textbox', { name: 'mock-editor' });
    await user.clear(edit);
    await user.type(edit, '수정한 댓글');
    await user.click(within(commentItem).getByRole('button', { name: 'timeline.comments.save' }));
    expect(mocks.update).toHaveBeenCalledWith({
      commentId: ownComment.id,
      data: { bodyMarkdown: '수정한 댓글', version: 1 },
    });
    expect(await screen.findByText('수정한 댓글')).toBeVisible();

    const updatedItem = screen.getByText('수정한 댓글').closest('li');
    if (!updatedItem) throw new Error('updated comment item missing');
    await user.click(within(updatedItem).getByRole('button', { name: 'timeline.comments.delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'timeline.comments.delete',
      }),
    );
    expect(mocks.remove).toHaveBeenCalledWith({
      commentId: ownComment.id,
      params: { version: 2 },
    });
    expect(await screen.findByText('timeline.comments.deleted')).toBeVisible();

    const createEditor = screen.getByRole('textbox', { name: 'mock-editor' });
    await user.type(createEditor, '새 댓글');
    await user.click(screen.getByRole('button', { name: 'timeline.comments.submit' }));
    expect(mocks.create).toHaveBeenCalledWith({
      data: { bodyMarkdown: '새 댓글' },
      issueId: 'issue-id',
    });
    expect(await screen.findByText('새 댓글')).toBeVisible();
  });

  it('휴지통 이동과 복구 활동을 서로 다른 의미로 표시한다', async () => {
    mocks.timeline.mockResolvedValueOnce({
      items: [
        {
          activity: {
            actor: ownComment.author,
            after: null,
            before: null,
            eventType: 'ISSUE_TRASHED',
            fieldName: null,
            id: 'trashed-activity-id',
          },
          createdAt: '2026-07-01T00:00:00.000Z',
          type: 'ACTIVITY',
        },
        {
          activity: {
            actor: ownComment.author,
            after: null,
            before: null,
            eventType: 'ISSUE_RESTORED',
            fieldName: null,
            id: 'restored-activity-id',
          },
          createdAt: '2026-07-01T01:00:00.000Z',
          type: 'ACTIVITY',
        },
      ],
      nextCursor: null,
    });

    render(
      <IssueTimeline
        currentMembershipId="membership-me"
        issueId="issue-id"
        mentionOptions={[]}
        mode="activity"
      />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText('timeline.activity.trashed')).toBeVisible();
    expect(screen.getByText('timeline.activity.restored')).toBeVisible();
  });

  it('댓글 모드와 활동 모드는 같은 응답에서 서로의 항목을 섞어 표시하지 않는다', async () => {
    mocks.timeline.mockResolvedValue({
      items: [
        { comment: ownComment, createdAt: ownComment.createdAt, type: 'COMMENT' },
        {
          activity: {
            actor: ownComment.author,
            after: null,
            before: null,
            eventType: 'ISSUE_CREATED',
            fieldName: null,
            id: 'activity-id',
          },
          createdAt: '2026-07-01T00:01:00.000Z',
          type: 'ACTIVITY',
        },
        {
          activity: {
            actor: ownComment.author,
            after: null,
            before: null,
            eventType: 'TEAM_WORK_CHANGED',
            fieldName: 'workNoteMarkdown',
            id: 'team-work-activity-id',
            teamWorkId: 'team-work-id',
            teamWorkIdentifier: 'WEB-2',
          },
          createdAt: '2026-07-01T00:01:30.000Z',
          type: 'ACTIVITY',
        },
        {
          createdAt: '2026-07-01T00:02:00.000Z',
          handoff: {
            author: ownComment.author,
            bodyMarkdown: '전달 본문',
            createdAt: '2026-07-01T00:02:00.000Z',
            id: 'handoff-id',
            kind: 'INITIAL',
            sequenceNumber: 1,
            sourceTeamWorkId: 'source-work-id',
            targetTeamWorkIds: ['target-work-id'],
          },
          type: 'HANDOFF',
        },
      ],
      nextCursor: null,
    });

    const comments = render(
      <IssueTimeline currentMembershipId="membership-me" issueId="issue-id" mentionOptions={[]} />,
      { wrapper: Wrapper },
    );
    expect(await screen.findByText('첫 댓글')).toBeVisible();
    expect(screen.queryByText('timeline.activity.created')).not.toBeInTheDocument();
    expect(screen.queryByText('timeline.activity.handoffInitial')).not.toBeInTheDocument();
    comments.unmount();
    queryClient.clear();

    render(
      <IssueTimeline
        currentMembershipId="membership-me"
        issueId="issue-id"
        issueIdentifier="API-1"
        mentionOptions={[]}
        mode="activity"
      />,
      { wrapper: Wrapper },
    );
    expect(await screen.findByText('timeline.activity.created')).toBeVisible();
    expect(screen.getByText('timeline.activity.fields.teamWorkWorkNote')).toBeVisible();
    expect(screen.getByRole('link', { name: 'WEB-2' })).toHaveAttribute(
      'href',
      '/issues/API-1?tab=work&work=WEB-2',
    );
    expect(screen.queryByText('timeline.activity.handoffInitial')).not.toBeInTheDocument();
    expect(screen.queryByText('첫 댓글')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'mock-editor' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument();
  });

  it('현재 페이지에 댓글이 없어도 다음 혼합 커서 페이지를 불러올 수 있다', async () => {
    mocks.timeline
      .mockResolvedValueOnce({
        items: [
          {
            activity: {
              actor: null,
              after: null,
              before: null,
              eventType: 'ISSUE_CREATED',
              fieldName: null,
              id: 'activity-id',
            },
            createdAt: '2026-07-01T00:00:00.000Z',
            type: 'ACTIVITY',
          },
        ],
        nextCursor: 'next-page',
      })
      .mockResolvedValueOnce({
        items: [{ comment: ownComment, createdAt: ownComment.createdAt, type: 'COMMENT' }],
        nextCursor: null,
      });
    const user = userEvent.setup();

    render(
      <IssueTimeline currentMembershipId="membership-me" issueId="issue-id" mentionOptions={[]} />,
      { wrapper: Wrapper },
    );

    const loadMore = await screen.findByRole('button', { name: 'timeline.comments.loadMore' });
    expect(screen.queryByText('timeline.comments.empty')).not.toBeInTheDocument();
    await user.click(loadMore);
    expect(await screen.findByText('첫 댓글')).toBeVisible();
  });
});
