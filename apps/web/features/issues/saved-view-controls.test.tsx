import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useSavedViewsControllerCreate,
  useSavedViewsControllerList,
  useSavedViewsControllerRemove,
  useSavedViewsControllerSetDefault,
  useSavedViewsControllerUpdate,
} from '@rivet/api-client';

import { SavedViewControls } from './saved-view-controls';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refetch: vi.fn(),
  search: 'view=view-1',
  updateMutate: vi.fn(),
}));

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSavedViewsControllerCreate: vi.fn(),
  useSavedViewsControllerList: vi.fn(),
  useSavedViewsControllerRemove: vi.fn(),
  useSavedViewsControllerSetDefault: vi.fn(),
  useSavedViewsControllerUpdate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
  usePathname: () => '/issues',
  useRouter: () => ({ push: mocks.push }),
}));

const view = {
  configuration: { projectId: '953685f0-4921-41cd-8422-d8a1ccc3f547', query: '긴급' },
  createdAt: '2026-07-15T00:00:00.000Z',
  id: 'view-1',
  isDefault: false,
  name: '긴급 보기',
  resourceType: 'ISSUES' as const,
  updatedAt: '2026-07-15T00:00:00.000Z',
  version: 1,
};
const defaultView = {
  ...view,
  id: 'view-default',
  isDefault: true,
  name: '기본 보기',
};

describe('SavedViewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = 'view=view-1';
    vi.mocked(useSavedViewsControllerList).mockReturnValue({
      data: { items: [view], nextCursor: null },
      isSuccess: true,
      refetch: mocks.refetch,
    } as never);
    vi.mocked(useSavedViewsControllerCreate).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    } as never);
    vi.mocked(useSavedViewsControllerRemove).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    } as never);
    vi.mocked(useSavedViewsControllerSetDefault).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    } as never);
    vi.mocked(useSavedViewsControllerUpdate).mockReturnValue({
      isPending: false,
      mutate: mocks.updateMutate,
    } as never);
  });

  afterEach(cleanup);

  it('본문 상단에서 현재 보기만 강조하고 접근성 상태를 함께 표시한다', () => {
    render(
      <SavedViewControls
        configuration={view.configuration as Record<string, string>}
        resourceType="ISSUES"
      />,
    );

    const selectedView = screen.getByRole('link', { name: '긴급 보기' });
    expect(selectedView).toHaveAttribute('aria-current', 'page');
    expect(selectedView).toHaveClass('text-foreground', 'after:bottom-0', 'after:bg-primary');
    expect(screen.getByRole('link', { name: '전체' })).toHaveClass('text-muted-foreground');
  });

  it('다른 보기에서 전체로 이동해도 기본 보기를 다시 적용하지 않는다', () => {
    vi.mocked(useSavedViewsControllerList).mockReturnValue({
      data: { items: [defaultView, view], nextCursor: null },
      isSuccess: true,
      refetch: mocks.refetch,
    } as never);
    mocks.search = `view=${view.id}&query=%EA%B8%B4%EA%B8%89&projectId=${view.configuration.projectId}`;
    const { rerender } = render(
      <SavedViewControls
        configuration={view.configuration as Record<string, string>}
        resourceType="ISSUES"
      />,
    );

    mocks.search = '';
    rerender(<SavedViewControls configuration={{}} resourceType="ISSUES" />);

    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '전체' })).toHaveAttribute('aria-current', 'page');
  });

  it('저장된 보기 없이 처음 진입하면 기본 보기를 한 번 적용한다', async () => {
    vi.mocked(useSavedViewsControllerList).mockReturnValue({
      data: { items: [defaultView, view], nextCursor: null },
      isSuccess: true,
      refetch: mocks.refetch,
    } as never);
    mocks.search = '';
    render(<SavedViewControls configuration={{}} resourceType="ISSUES" />);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining(`view=${defaultView.id}`), {
      scroll: false,
    });
  });

  it('기존 단일 정렬 URL은 명시 설정으로 유지해 기본 보기가 덮어쓰지 않는다', () => {
    vi.mocked(useSavedViewsControllerList).mockReturnValue({
      data: { items: [defaultView, view], nextCursor: null },
      isSuccess: true,
      refetch: mocks.refetch,
    } as never);
    mocks.search = 'sort=priority&sortDirection=asc';

    render(
      <SavedViewControls
        configuration={{ sorts: [{ direction: 'asc', field: 'priority' }] }}
        resourceType="ISSUES"
      />,
    );

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('보관되었거나 권한을 잃은 필터 값을 alert로 안내한다', () => {
    render(
      <SavedViewControls
        configuration={{ projectId: view.configuration.projectId }}
        resourceType="ISSUES"
        staleValueMessage="저장된 보기의 프로젝트가 보관되었거나 접근 권한이 없습니다."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '프로젝트가 보관되었거나 접근 권한이 없습니다',
    );
  });

  it('이름 변경 충돌 뒤 최신 보기를 다시 읽어 재시도를 복구한다', async () => {
    const user = userEvent.setup();
    mocks.updateMutate.mockImplementation((_variables, callbacks) => {
      callbacks.onError({ message: '다른 기기에서 변경되었습니다.' });
    });
    render(<SavedViewControls configuration={{ query: '긴급' }} resourceType="ISSUES" />);

    await user.click(screen.getByRole('button', { name: '긴급 보기 보기 관리' }));
    await user.click(screen.getByRole('button', { name: '이름 변경' }));
    const dialog = screen.getByRole('dialog', { name: '저장된 보기 이름 변경' });
    await user.clear(within(dialog).getByLabelText('새 저장된 보기 이름'));
    await user.type(within(dialog).getByLabelText('새 저장된 보기 이름'), '새 이름');
    await user.click(within(dialog).getByRole('button', { name: /^변경$/u }));

    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('다른 기기에서 변경되었습니다.')).toBeVisible();
  });

  it('삭제되었거나 접근할 수 없는 URL 보기를 명시적으로 안내한다', () => {
    vi.mocked(useSavedViewsControllerList).mockReturnValue({
      data: { items: [], nextCursor: null },
      isSuccess: true,
      refetch: mocks.refetch,
    } as never);
    render(<SavedViewControls configuration={{ query: '긴급' }} resourceType="ISSUES" />);

    expect(screen.getByRole('alert')).toHaveTextContent('삭제되었거나 더 이상 접근할 수 없습니다');
  });

  it('선택한 보기 구성이 달라지면 변경됨을 표시하고 같은 보기에 저장한다', async () => {
    const user = userEvent.setup();
    mocks.search = `view=view-1&query=%EB%B3%80%EA%B2%BD&projectId=${view.configuration.projectId}`;
    render(
      <SavedViewControls
        configuration={{ projectId: view.configuration.projectId, query: '변경' }}
        resourceType="ISSUES"
      />,
    );

    expect(screen.getAllByText('변경됨').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '변경 저장' }));

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      {
        data: {
          configuration: { projectId: view.configuration.projectId, query: '변경' },
          version: 1,
        },
        savedViewId: 'view-1',
      },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    );
  });

  it('삭제는 관리 메뉴에서 확인한 뒤 실행한다', async () => {
    const user = userEvent.setup();
    const removeMutate = vi.fn();
    vi.mocked(useSavedViewsControllerRemove).mockReturnValue({
      isPending: false,
      mutate: removeMutate,
    } as never);
    render(
      <SavedViewControls
        configuration={view.configuration as Record<string, string>}
        resourceType="ISSUES"
      />,
    );

    await user.click(screen.getByRole('button', { name: '긴급 보기 보기 관리' }));
    await user.click(screen.getByRole('button', { name: '보기 삭제' }));
    expect(screen.getByRole('alertdialog', { name: '이 보기를 삭제할까요?' })).toBeVisible();
    expect(removeMutate).not.toHaveBeenCalled();
  });
});
