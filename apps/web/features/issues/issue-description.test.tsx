import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IssueDetailResponseDto } from '@rivet/api-client';

import { IssueDescription } from './issue-description';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.raw = (key: string) => (key === 'characterCount' ? '{current}/{max}자' : key);
    return translate;
  },
}));

vi.mock('@/features/collaboration/markdown-editor', () => ({
  MarkdownEditor: ({
    error,
    onCanSubmitChange,
    onChange,
    value,
  }: {
    error: string | null;
    onCanSubmitChange: (ready: boolean) => void;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <>
      <textarea
        aria-label="description-editor"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          onCanSubmitChange(true);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
    </>
  ),
}));

vi.mock('@/features/collaboration/markdown-renderer', () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => (
    <div data-testid="markdown-renderer">{markdown}</div>
  ),
}));

const issue = {
  assignee: null,
  attachments: [],
  blocked: false,
  blockers: [],
  blocking: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  createdBy: {
    id: 'membership-creator',
    role: 'MEMBER',
    status: 'ACTIVE',
    user: { avatarFileId: null, displayName: '작성자', id: 'user-creator' },
  },
  descriptionMarkdown: null,
  handoffSummary: null,
  id: '7c8fc5da-cccb-4478-b9b0-78ec539e9271',
  identifier: 'API-1',
  labels: [],
  parentIssue: null,
  priority: 'NONE',
  progress: null,
  project: null,
  projectRole: null,
  status: {
    category: 'UNSTARTED',
    featureStatus: null,
    workflowState: {
      category: 'UNSTARTED',
      id: '93331a10-3dc7-44cd-820c-33b74c63dc2f',
      isDefault: true,
      name: '할 일',
      position: 0,
      version: 1,
    },
  },
  team: { archived: false, id: 'team-id', key: 'API', name: 'API 팀' },
  title: '첫 이슈',
  type: 'TEAM_TASK',
  updatedAt: '2026-07-01T00:00:00.000Z',
  version: 1,
  workflowSummary: null,
} satisfies IssueDetailResponseDto;

function mutation(overrides: Record<string, unknown> = {}) {
  return {
    conflict: null,
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.mutate,
    variables: undefined,
    ...overrides,
  } as never;
}

describe('IssueDescription', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('저장된 설명은 공용 Markdown 렌더러로 표시한다', () => {
    render(
      <IssueDescription
        issue={{ ...issue, descriptionMarkdown: '## 저장된 설명' }}
        mentionOptions={[]}
        mutation={mutation()}
      />,
    );

    expect(screen.getByTestId('markdown-renderer')).toHaveTextContent('## 저장된 설명');
  });

  it('빈 설명을 편집해 현재 이슈 버전 mutation으로 저장한다', async () => {
    const user = userEvent.setup();
    render(<IssueDescription issue={issue} mentionOptions={[]} mutation={mutation()} />);

    await user.click(screen.getByRole('button', { name: 'description.add' }));
    await user.type(screen.getByRole('textbox', { name: 'description-editor' }), '## 새 설명');
    await user.click(screen.getByRole('button', { name: 'description.save' }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { change: { kind: 'description', value: '## 새 설명' }, issue },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('버전 충돌 뒤에도 작성 중인 설명과 충돌 안내를 유지한다', async () => {
    const user = userEvent.setup();
    const view = render(
      <IssueDescription issue={issue} mentionOptions={[]} mutation={mutation()} />,
    );
    await user.click(screen.getByRole('button', { name: 'description.add' }));
    await user.type(screen.getByRole('textbox', { name: 'description-editor' }), '내 설명');

    view.rerender(
      <IssueDescription
        issue={{ ...issue, descriptionMarkdown: '최신 설명', version: 2 }}
        mentionOptions={[]}
        mutation={mutation({
          conflict: {
            attemptedChange: { kind: 'description', value: '내 설명' },
            issueRef: issue.identifier,
            latest: { ...issue, descriptionMarkdown: '최신 설명', version: 2 },
          },
          isError: true,
          variables: { change: { kind: 'description', value: '내 설명' }, issue },
        })}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'description-editor' })).toHaveValue('내 설명');
    expect(screen.getByText('description.conflictTitle')).toBeVisible();
  });
});
