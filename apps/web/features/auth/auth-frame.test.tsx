import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthFrame, AuthLink } from './auth-frame';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('AuthFrame', () => {
  it('제품명과 화면 설명을 하나의 인증 카드에 표시한다', () => {
    render(
      <AuthFrame
        labels={{ productName: 'Rivet', title: '화면 제목', description: '첫 번째 설명\n두 번째 설명' }}
      >
        <AuthLink href="/login">로그인</AuthLink>
      </AuthFrame>,
    );

    expect(screen.getByRole('img', { name: 'Rivet' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '화면 제목' })).toBeVisible();
    expect(
      screen.getByText((_, element) => element?.getAttribute('data-slot') === 'card-description'),
    ).toHaveClass('whitespace-pre-line');
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login');
  });
});
