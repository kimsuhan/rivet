import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('SavedViewControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = 'view=view-1';
    vi.mocked(useSavedViewsControllerList).mockReturnValue({
      data: { items: [view], nextCursor: null },
      isSuccess: true,
      refetch: mocks.refetch,
    } as never);
    vi.mocked(useSavedViewsControllerCreate).mockReturnValue({ isPending: false, mutate: vi.fn() } as never);
    vi.mocked(useSavedViewsControllerRemove).mockReturnValue({ isPending: false, mutate: vi.fn() } as never);
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

  it('보관되었거나 권한을 잃은 필터 값을 alert로 안내한다', () => {
    render(
      <SavedViewControls
        configuration={{ projectId: view.configuration.projectId }}
        resourceType="ISSUES"
        staleValueMessage="저장된 보기의 프로젝트가 보관되었거나 접근 권한이 없습니다."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('프로젝트가 보관되었거나 접근 권한이 없습니다');
  });

  it('이름 변경 충돌 뒤 최신 보기를 다시 읽어 재시도를 복구한다', async () => {
    const user = userEvent.setup();
    mocks.updateMutate.mockImplementation((_variables, callbacks) => {
      callbacks.onError({ message: '다른 기기에서 변경되었습니다.' });
    });
    render(<SavedViewControls configuration={{ query: '긴급' }} resourceType="ISSUES" />);

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
});
