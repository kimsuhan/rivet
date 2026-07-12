import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthControllerGetSession } from '@rivet/api-client';

import { AdminSettingsBoundary } from './admin-settings-boundary';

vi.mock('@rivet/api-client', () => ({
  useAuthControllerGetSession: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

const labels = {
  backToWork: '내 이슈로 돌아가기',
  errorDescription: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
  errorTitle: '설정 권한을 확인하지 못했습니다',
  loading: '관리자 권한을 확인하는 중입니다.',
  permissionDescription: '워크스페이스 관리자에게 필요한 변경을 요청해 주세요.',
  permissionTitle: '관리자만 설정을 변경할 수 있습니다',
  retry: '다시 시도',
};

function mockSession(value: Record<string, unknown>) {
  vi.mocked(useAuthControllerGetSession).mockReturnValue(value as never);
}

describe('AdminSettingsBoundary', () => {
  afterEach(cleanup);

  beforeEach(() => vi.clearAllMocks());

  it('세션 확인 중에는 설정 내용을 노출하지 않는다', () => {
    mockSession({ data: undefined, isPending: true });

    render(
      <AdminSettingsBoundary labels={labels}>
        <div>설정 내용</div>
      </AdminSettingsBoundary>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(labels.loading);
    expect(screen.queryByText('설정 내용')).not.toBeInTheDocument();
  });

  it('일반 멤버에게 권한 부족 상태와 업무 복귀 링크를 표시한다', () => {
    mockSession({
      data: {
        authenticated: true,
        membership: { role: 'MEMBER', status: 'ACTIVE' },
      },
      isPending: false,
    });

    render(
      <AdminSettingsBoundary labels={labels}>
        <div>설정 내용</div>
      </AdminSettingsBoundary>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: labels.permissionTitle }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: labels.backToWork })).toHaveAttribute(
      'href',
      '/my-issues',
    );
    expect(screen.queryByText('설정 내용')).not.toBeInTheDocument();
  });

  it('세션 조회 실패를 권한 부족으로 오분류하지 않고 다시 시도한다', async () => {
    const refetch = vi.fn();
    mockSession({ data: undefined, isError: true, isPending: false, refetch });
    const user = userEvent.setup();

    render(
      <AdminSettingsBoundary labels={labels}>
        <div>설정 내용</div>
      </AdminSettingsBoundary>,
    );

    expect(screen.getByRole('heading', { level: 1, name: labels.errorTitle })).toBeVisible();
    expect(screen.queryByText(labels.permissionTitle)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: labels.retry }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('활성 관리자에게 설정 내용을 표시한다', () => {
    mockSession({
      data: {
        authenticated: true,
        membership: { role: 'ADMIN', status: 'ACTIVE' },
      },
      isPending: false,
    });

    render(
      <AdminSettingsBoundary labels={labels}>
        <div>설정 내용</div>
      </AdminSettingsBoundary>,
    );

    expect(screen.getByText('설정 내용')).toBeInTheDocument();
  });
});
