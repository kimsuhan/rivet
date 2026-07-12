import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type ProjectResponseDto } from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { ProjectDetailScreen } from './project-detail-screen';

const mocks = vi.hoisted(() => ({
  archiveMutate: vi.fn(),
  archiveReset: vi.fn(),
  issuePagesHook: vi.fn(),
  projectHook: vi.fn(),
  projectRefetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  trashHook: vi.fn(),
  trashMutate: vi.fn(),
  trashReset: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectsControllerArchive: () => ({
    error: null,
    isError: false,
    isPending: false,
    mutate: mocks.archiveMutate,
    reset: mocks.archiveReset,
  }),
  useProjectsControllerGet: mocks.projectHook,
  useProjectsControllerTrash: mocks.trashHook,
}));

vi.mock('../issues/issue-list-queries', () => ({
  useIssuePages: mocks.issuePagesHook,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: () => `/projects/${project.id}`,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

const project: ProjectResponseDto = {
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  description: 'MVP 운영 프로젝트',
  id: '98659200-edda-438a-813e-0495588d436d',
  lead: null,
  name: 'Rivet MVP',
  progress: { completed: 0, percentage: 0, total: 0 },
  roleTeams: [],
  startDate: null,
  status: 'PLANNED',
  targetDate: null,
  updatedAt: '2026-07-11T00:00:00.000Z',
  version: 3,
};

type TrashCallbacks = {
  onError?: (error: ApiError<{ code: string }>) => void;
  onSuccess?: () => void;
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
  return render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });
}

describe('ProjectDetailScreen trash action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    mocks.projectHook.mockReturnValue({
      data: project,
      error: null,
      isError: false,
      isPending: false,
      refetch: mocks.projectRefetch,
    });
    mocks.issuePagesHook.mockReturnValue({
      data: { pageParams: [undefined], pages: [{ items: [], nextCursor: null }] },
      error: null,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    });
    mocks.trashHook.mockReturnValue({
      error: null,
      isError: false,
      isPending: false,
      mutate: mocks.trashMutate,
      reset: mocks.trashReset,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('프로젝트와 30일 복구 가능성을 확인한 뒤 성공하면 프로젝트 목록으로 이동한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: messages.Projects.trash.action }));
    const dialog = screen.getByRole('alertdialog', {
      name: messages.Projects.trash.title.replace('{name}', project.name),
    });
    expect(within(dialog).getByText(messages.Projects.trash.description)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: messages.Projects.trash.confirm }));

    expect(mocks.trashMutate).toHaveBeenCalledWith(
      { data: { version: project.version }, projectId: project.id },
      expect.any(Object),
    );
    act(() => {
      const callbacks = mocks.trashMutate.mock.calls[0]?.[1] as TrashCallbacks | undefined;
      callbacks?.onSuccess?.();
    });

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/projects'));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('연결된 이슈가 있으면 현재 상세의 이슈 영역에서 정리하도록 안내한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: messages.Projects.trash.action }));
    await user.click(screen.getByRole('button', { name: messages.Projects.trash.confirm }));
    act(() => {
      const callbacks = mocks.trashMutate.mock.calls[0]?.[1] as TrashCallbacks | undefined;
      callbacks?.onError?.(new ApiError(409, { code: 'PROJECT_NOT_EMPTY' }, 'request-id'));
    });

    expect(screen.getByText(messages.Projects.trash.notEmptyTitle)).toBeVisible();
    expect(screen.getByRole('link', { name: messages.Projects.trash.openIssues })).toHaveAttribute(
      'href',
      '#project-issues',
    );
    expect(document.querySelector('#project-issues')).not.toBeNull();
  });

  it('프로젝트 version 충돌은 최신 상세를 다시 조회하고 목록 이동을 중단한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: messages.Projects.trash.action }));
    await user.click(screen.getByRole('button', { name: messages.Projects.trash.confirm }));
    act(() => {
      const callbacks = mocks.trashMutate.mock.calls[0]?.[1] as TrashCallbacks | undefined;
      callbacks?.onError?.(new ApiError(409, { code: 'VERSION_CONFLICT' }, 'request-id'));
    });

    expect(screen.getByText(messages.Projects.trash.conflictDescription)).toBeVisible();
    expect(mocks.projectRefetch).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
