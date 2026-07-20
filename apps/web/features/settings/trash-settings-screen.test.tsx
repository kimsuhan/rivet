import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTrashControllerListQueryKey,
  trashControllerList,
  type TrashItemResponseDto,
  type TrashRestoreResponseDto,
  useTrashControllerRestoreIssue,
  useTrashControllerRestoreProject,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { TrashSettingsScreen } from './trash-settings-screen';

const mocks = vi.hoisted(() => ({
  issueMutate: vi.fn(),
  issueReset: vi.fn(),
  projectMutate: vi.fn(),
  projectReset: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trashControllerList: vi.fn(),
  useTrashControllerRestoreIssue: vi.fn(),
  useTrashControllerRestoreProject: vi.fn(),
}));

const issue: TrashItemResponseDto = {
  createdAt: '2026-06-01T02:00:00.000Z',
  deletedAt: '2026-07-10T03:00:00.000Z',
  deletedBy: {
    avatarFileId: null,
    displayName: '김관리',
    id: '8be6d069-fd1a-4cd7-ae1c-9d7fe499d936',
  },
  id: 'de38396f-7dcc-42e4-a789-205f60a84c69',
  identifier: 'WEB-21',
  name: '휴지통 화면 연결',
  project: { id: 'de0f78b6-5711-4a98-9bd0-61c88577ea7a', name: 'MVP' },
  purgeAt: '2026-08-09T03:00:00.000Z',
  resourceType: 'ISSUE',
  projectTeams: [],
  version: 4,
};

const project: TrashItemResponseDto = {
  createdAt: '2026-05-01T02:00:00.000Z',
  deletedAt: '2026-07-09T03:00:00.000Z',
  deletedBy: issue.deletedBy,
  id: 'b63fae1f-74f0-45cd-80c3-a90d497705e6',
  identifier: null,
  name: '이전 모바일 프로젝트',
  project: null,
  purgeAt: '2026-08-08T03:00:00.000Z',
  resourceType: 'PROJECT',
  projectTeams: [
    {
      active: true,
      id: 'project-team-backend',
      teamArchived: true,
      teamId: 'ce708dad-552d-4709-98d5-6618e647fd01',
      teamName: '보관된 백엔드',
    },
  ],
  version: 2,
};

type RestoreCallbacks = {
  onSuccess?: (result: TrashRestoreResponseDto) => Promise<void> | void;
};

let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderScreen() {
  return render(<TrashSettingsScreen />, { wrapper: Wrapper });
}

function mockMutations(issueError: unknown = null) {
  vi.mocked(useTrashControllerRestoreIssue).mockReturnValue({
    error: issueError,
    isError: issueError !== null,
    isPending: false,
    mutate: mocks.issueMutate,
    reset: mocks.issueReset,
  } as never);
  vi.mocked(useTrashControllerRestoreProject).mockReturnValue({
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.projectMutate,
    reset: mocks.projectReset,
  } as never);
}

describe('TrashSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    vi.mocked(trashControllerList).mockImplementation((params) =>
      Promise.resolve({
        items: params?.resourceType === 'PROJECT' ? [project] : [issue],
        nextCursor: null,
      }),
    );
    mockMutations();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('유형, 검색어, 삭제자·기한과 원래 연결을 생성 계약으로 조회한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(await screen.findByText(issue.name)).toBeVisible();
    expect(screen.getByText(issue.deletedBy.displayName)).toBeVisible();
    expect(screen.getByText('프로젝트 MVP')).toBeVisible();
    expect(screen.getAllByRole('time')).toHaveLength(2);
    expect(trashControllerList).toHaveBeenCalledWith(
      { limit: 20, resourceType: 'ISSUE' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await user.type(screen.getByLabelText(messages.Settings.trash.searchLabel), '모바일');
    await user.click(screen.getByRole('button', { name: messages.Settings.trash.search }));
    await waitFor(() =>
      expect(trashControllerList).toHaveBeenCalledWith(
        { limit: 20, query: '모바일', resourceType: 'ISSUE' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    await user.click(screen.getByRole('tab', { name: messages.Settings.trash.projectTab }));
    expect(await screen.findByText(project.name)).toBeVisible();
    expect(trashControllerList).toHaveBeenCalledWith(
      { limit: 20, query: '모바일', resourceType: 'PROJECT' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('커서가 있으면 현재 항목을 유지하고 다음 휴지통 항목을 더 불러온다', async () => {
    const user = userEvent.setup();
    const nextIssue = { ...issue, id: '337ca148-ced1-4fb5-a9ae-af38be594a15', name: '다음 이슈' };
    vi.mocked(trashControllerList).mockImplementation((params) =>
      Promise.resolve(
        params?.cursor
          ? { items: [nextIssue], nextCursor: null }
          : { items: [issue], nextCursor: 'next-trash-page' },
      ),
    );
    renderScreen();

    expect(await screen.findByText(issue.name)).toBeVisible();
    await user.click(screen.getByRole('button', { name: messages.Settings.trash.loadMore }));

    expect(await screen.findByText(nextIssue.name)).toBeVisible();
    expect(screen.getByText(issue.name)).toBeVisible();
    expect(trashControllerList).toHaveBeenCalledWith(
      { cursor: 'next-trash-page', limit: 20, resourceType: 'ISSUE' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('복구 전에 보관 팀 영향을 확인하고 성공 warnings를 한국어로 남긴다', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(issue.name);
    await user.click(screen.getByRole('tab', { name: messages.Settings.trash.projectTab }));
    expect(await screen.findByText(project.name)).toBeVisible();

    await user.click(
      screen.getByRole('button', {
        name: messages.Settings.trash.restoreNamed.replace('{name}', project.name),
      }),
    );
    const dialog = screen.getByRole('alertdialog', {
      name: messages.Settings.trash.restoreTitle.replace('{name}', project.name),
    });
    expect(
      within(dialog).getByText(messages.Settings.trash.restoreImpactDescription),
    ).toBeVisible();
    expect(within(dialog).getAllByText(/보관된 백엔드/).length).toBeGreaterThan(0);

    await user.click(
      within(dialog).getByRole('button', { name: messages.Settings.trash.restoreAction }),
    );
    expect(mocks.projectMutate).toHaveBeenCalledWith(
      { data: { version: project.version }, projectId: project.id },
      expect.any(Object),
    );

    await act(async () => {
      const callbacks = mocks.projectMutate.mock.calls[0]?.[1] as RestoreCallbacks | undefined;
      await callbacks?.onSuccess?.({
        id: project.id,
        resourceType: 'PROJECT',
        version: 3,
        warnings: ['TEAM_ARCHIVED'],
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getTrashControllerListQueryKey(),
    });
    expect(screen.getByText(messages.Settings.trash.warnings.teamArchived)).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('version 충돌은 복구를 진행하지 않고 최신 휴지통 목록을 다시 조회한다', async () => {
    const user = userEvent.setup();
    mockMutations({
      body: { code: 'VERSION_CONFLICT' },
      status: 409,
    });
    renderScreen();
    expect(await screen.findByText(issue.name)).toBeVisible();

    await user.click(
      screen.getByRole('button', {
        name: messages.Settings.trash.restoreNamed.replace('{name}', issue.name),
      }),
    );
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(messages.Settings.trash.conflictDescription)).toBeVisible();
    await user.click(
      within(dialog).getByRole('button', { name: messages.Settings.trash.reloadLatest }),
    );

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: getTrashControllerListQueryKey(),
      }),
    );
    expect(mocks.issueMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
