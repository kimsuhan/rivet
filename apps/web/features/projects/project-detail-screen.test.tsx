import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  useIssuesControllerList,
  useProjectsControllerArchive,
  useProjectsControllerGet,
  useProjectsControllerTrash,
  useTeamWorksControllerList,
} from '@rivet/api-client';

import messages from '@/messages/ko.json';

import { ProjectDetailScreen } from './project-detail-screen';

const mocks = vi.hoisted(() => ({
  archiveMutate: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  issuesRefetch: vi.fn(),
  projectRefetch: vi.fn(),
  removeQueries: vi.fn(),
  replace: vi.fn(),
  setQueryData: vi.fn(),
  trashMutate: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    removeQueries: mocks.removeQueries,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssuesControllerList: vi.fn(),
  useProjectsControllerArchive: vi.fn(),
  useProjectsControllerGet: vi.fn(),
  useProjectsControllerTrash: vi.fn(),
  useTeamWorksControllerList: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props} />
  ),
  useRouter: () => ({ replace: mocks.replace }),
}));

const project = {
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  description: '삭제 흐름을 확인할 프로젝트',
  id: '54c95ae9-cad5-44e6-b95f-2c71a5290ef4',
  lead: null,
  name: '첫 프로젝트',
  progress: { completed: 0, percentage: 0, total: 0 },
  projectTeams: [],
  startDate: null,
  status: 'PLANNED' as const,
  targetDate: null,
  updatedAt: '2026-07-10T00:00:00.000Z',
  version: 2,
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages} timeZone="Asia/Seoul">
      {children}
    </NextIntlClientProvider>
  );
}

function mockProjectDetail({ archived = false, issueCount = 0 } = {}) {
  vi.mocked(useProjectsControllerGet).mockReturnValue({
    data: { ...project, archived },
    isError: false,
    isPending: false,
    refetch: mocks.projectRefetch,
  } as never);
  vi.mocked(useIssuesControllerList).mockReturnValue({
    data: { items: [], nextCursor: null, totalCount: issueCount },
    isError: false,
    isPending: false,
    queryKey: ['/api/v1/issues'],
    refetch: mocks.issuesRefetch,
  } as never);
  vi.mocked(useTeamWorksControllerList).mockReturnValue({
    data: { items: [], nextCursor: null, totalCount: 0 },
    isError: false,
    isPending: false,
  } as never);
}

describe('ProjectDetailScreen actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mockProjectDetail();
    vi.mocked(useProjectsControllerArchive).mockReturnValue({
      isPending: false,
      mutate: mocks.archiveMutate,
    } as never);
    vi.mocked(useProjectsControllerTrash).mockReturnValue({
      isPending: false,
      mutate: mocks.trashMutate,
    } as never);
  });

  afterEach(cleanup);

  it('비어 있는 활성 프로젝트에서 보관과 휴지통 이동을 확인 후 실행한다', async () => {
    const user = userEvent.setup();
    mocks.archiveMutate.mockImplementation((_variables, options) => {
      void options.onSuccess({ ...project, archived: true, version: 3 });
    });
    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    expect(screen.queryByRole('link', { name: '프로젝트 편집' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));
    expect(screen.getByRole('link', { name: '프로젝트 편집' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/edit`,
    );
    expect(screen.getByText('프로젝트', { selector: 'span' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '프로젝트 보관' }));

    const archiveDialog = await screen.findByRole('alertdialog', {
      name: '첫 프로젝트 프로젝트를 보관할까요?',
    });
    await user.click(within(archiveDialog).getByRole('button', { name: '프로젝트 보관' }));
    expect(mocks.archiveMutate).toHaveBeenCalledWith(
      { projectId: project.id, data: { version: 2 } },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(mocks.setQueryData).toHaveBeenCalledWith(
        [`/api/v1/projects/${project.id}`],
        expect.objectContaining({ archived: true, version: 3 }),
      ),
    );

    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));

    const trashDialog = await screen.findByRole('alertdialog', {
      name: '첫 프로젝트 프로젝트를 휴지통으로 이동할까요?',
    });
    await user.click(
      within(trashDialog).getByRole('button', { name: '프로젝트를 휴지통으로 이동' }),
    );
    expect(mocks.trashMutate).toHaveBeenCalledWith(
      { projectId: project.id, data: { version: 2 } },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
  });

  it('보관 중 version 충돌이 발생하면 최신 프로젝트를 다시 읽고 재시도 안내를 남긴다', async () => {
    const user = userEvent.setup();
    mocks.archiveMutate.mockImplementation((_variables, options) => {
      options.onError(new ApiError(409, { code: 'VERSION_CONFLICT' }, null));
    });
    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));
    await user.click(screen.getByRole('button', { name: '프로젝트 보관' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '프로젝트 보관' }));

    expect(mocks.projectRefetch).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '프로젝트가 먼저 변경되었습니다. 최신 정보를 확인한 뒤 다시 보관해 주세요.',
    );
  });

  it('연결된 이슈가 있으면 삭제를 제공하지 않고 보관만 안내한다', async () => {
    const user = userEvent.setup();
    mockProjectDetail({ issueCount: 1 });
    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));

    expect(screen.getByRole('button', { name: '프로젝트 보관' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '휴지통으로 이동' })).not.toBeInTheDocument();
  });

  it('프로젝트 이슈는 프로젝트 문맥을 유지하는 상세 주소로 연결한다', () => {
    vi.mocked(useIssuesControllerList).mockReturnValue({
      data: {
        items: [
          {
            id: 'issue-1',
            identifier: 'F-3',
            labels: [],
            priority: 'MEDIUM',
            progress: { completed: 1, percentage: 20, total: 5 },
            project: { id: project.id, logoFileId: null, name: project.name },
            status: 'IN_PROGRESS',
            title: '이슈 1',
            updatedAt: '2026-07-20T00:00:00.000Z',
            version: 1,
            workflowSummary: { teamWorkCount: 5, unassignedCount: 0 },
          },
        ],
        nextCursor: null,
        totalCount: 1,
      },
      isError: false,
      isPending: false,
      queryKey: ['/api/v1/issues'],
      refetch: mocks.issuesRefetch,
    } as never);

    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    expect(screen.getByRole('link', { name: /F-3.*이슈 1/ })).toHaveAttribute(
      'href',
      `/projects/${project.id}/issues/F-3?tab=work`,
    );
  });

  it('휴지통 이동이 성공하면 프로젝트 캐시를 제거하고 목록으로 이동한다', async () => {
    const user = userEvent.setup();
    mocks.trashMutate.mockImplementation((_variables, options) => {
      void options.onSuccess();
    });
    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: '프로젝트를 휴지통으로 이동',
      }),
    );

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/projects'));
    expect(mocks.removeQueries).toHaveBeenCalledWith({
      queryKey: [`/api/v1/projects/${project.id}`],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/v1/projects'] });
  });

  it('동시 생성된 이슈로 삭제가 거부되면 원인과 연결 이슈 이동 경로를 유지한다', async () => {
    const user = userEvent.setup();
    mocks.trashMutate.mockImplementation((_variables, options) => {
      options.onError(new ApiError(409, { code: 'PROJECT_NOT_EMPTY' }, null));
    });
    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: '프로젝트를 휴지통으로 이동' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '연결된 이슈가 있어 이동할 수 없습니다',
    );
    expect(within(dialog).getByRole('button', { name: '연결된 이슈 확인' })).toBeVisible();
  });

  it('보관된 프로젝트는 읽기 전용으로 표시하고 비어 있으면 휴지통 이동만 제공한다', async () => {
    const user = userEvent.setup();
    mockProjectDetail({ archived: true });
    render(<ProjectDetailScreen projectId={project.id} />, { wrapper: Wrapper });

    expect(screen.getByRole('alert')).toHaveTextContent('보관된 프로젝트입니다');
    expect(screen.queryByRole('link', { name: '프로젝트 편집' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '이슈 만들기' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '프로젝트 더보기' }));
    expect(screen.queryByRole('button', { name: '프로젝트 보관' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '휴지통으로 이동' })).toBeVisible();
  });
});
