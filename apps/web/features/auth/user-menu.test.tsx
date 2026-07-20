import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMenu } from './user-menu';

type LogoutOptions = {
  mutation?: {
    onError?: () => void;
    onSuccess?: () => void;
  };
};

const auth = vi.hoisted(() => ({
  clear: vi.fn(),
  mutate: vi.fn(),
  options: null as LogoutOptions | null,
  replace: vi.fn(),
  setCsrfToken: vi.fn(),
  state: { isPending: false },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: auth.clear }),
}));

vi.mock('@rivet/api-client', () => ({
  setCsrfToken: auth.setCsrfToken,
  useAuthControllerLogout: (options: LogoutOptions) => {
    auth.options = options;
    return { ...auth.state, mutate: auth.mutate };
  },
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: auth.replace }),
}));

const labels = {
  feedback: '피드백 보내기',
  loggingOut: '로그아웃 중',
  logout: '로그아웃',
  logoutError: '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  open: '사용자 메뉴 열기',
  profile: '프로필 설정',
};

const user = { displayName: '김리벳', email: 'kim@example.com' };

function renderMenu(
  props: {
    onOpenChange?: () => void;
    onOpenFeedback?: () => void;
    onOpenProfile?: () => void;
  } = {},
) {
  return render(
    <UserMenu
      labels={labels}
      open
      onOpenChange={props.onOpenChange ?? vi.fn()}
      onOpenFeedback={props.onOpenFeedback ?? vi.fn()}
      onOpenProfile={props.onOpenProfile ?? vi.fn()}
      user={user}
    >
      아바타
    </UserMenu>,
  );
}

describe('UserMenu', () => {
  beforeEach(() => {
    auth.clear.mockClear();
    auth.mutate.mockClear();
    auth.replace.mockClear();
    auth.setCsrfToken.mockClear();
    auth.options = null;
    auth.state.isPending = false;
  });

  afterEach(() => cleanup());

  it('현재 사용자와 메뉴 항목을 보여준다', () => {
    renderMenu();

    expect(screen.getByText('김리벳')).toBeInTheDocument();
    expect(screen.getByText('kim@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.profile })).toBeEnabled();
    expect(screen.getByRole('button', { name: labels.feedback })).toBeEnabled();
    expect(screen.getByRole('button', { name: labels.logout })).toBeEnabled();
  });

  it('피드백 보내기를 누르면 메뉴를 닫고 피드백을 연다', async () => {
    const onOpenChange = vi.fn();
    const onOpenFeedback = vi.fn();
    const interaction = userEvent.setup();
    renderMenu({ onOpenChange, onOpenFeedback });

    await interaction.click(screen.getByRole('button', { name: labels.feedback }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenFeedback).toHaveBeenCalledOnce();
  });

  it('프로필 설정을 누르면 메뉴를 닫고 프로필을 연다', async () => {
    const onOpenChange = vi.fn();
    const onOpenProfile = vi.fn();
    const interaction = userEvent.setup();
    renderMenu({ onOpenChange, onOpenProfile });

    await interaction.click(screen.getByRole('button', { name: labels.profile }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('로그아웃에 성공하면 CSRF 토큰과 캐시를 비우고 로그인으로 보낸다', async () => {
    const onOpenChange = vi.fn();
    const interaction = userEvent.setup();
    renderMenu({ onOpenChange });

    await interaction.click(screen.getByRole('button', { name: labels.logout }));
    expect(auth.mutate).toHaveBeenCalledTimes(1);

    auth.options?.mutation?.onSuccess?.();

    expect(auth.setCsrfToken).toHaveBeenCalledWith(null);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(auth.replace).toHaveBeenCalledWith('/login');
    expect(auth.clear).toHaveBeenCalledTimes(1);
  });

  it('로그아웃에 실패하면 메뉴를 열어 둔 채 오류를 알린다', async () => {
    const onOpenChange = vi.fn();
    const interaction = userEvent.setup();
    renderMenu({ onOpenChange });

    await interaction.click(screen.getByRole('button', { name: labels.logout }));
    auth.options?.mutation?.onError?.();

    expect(await screen.findByRole('alert')).toHaveTextContent(labels.logoutError);
    expect(auth.replace).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('로그아웃하는 동안에는 메뉴를 닫거나 다시 누를 수 없다', () => {
    auth.state.isPending = true;
    renderMenu();

    expect(screen.getByRole('button', { name: labels.loggingOut })).toBeDisabled();
    expect(screen.getByRole('button', { name: labels.profile })).toBeDisabled();
  });
});
