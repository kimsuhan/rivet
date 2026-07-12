import { describe, expect, it } from 'vitest';

import { getSessionRedirect } from './session-routing';

const authenticatedSession = {
  authenticated: true as const,
  csrfToken: 'csrf',
  membership: null,
  onboardingStep: 'CREATE_WORKSPACE' as const,
  user: { avatarFileId: null, displayName: '사용자', email: 'user@example.com', id: 'user-id' },
  workspace: null,
};

describe('getSessionRedirect', () => {
  it('비로그인 사용자를 로그인으로 보낸다', () => {
    expect(getSessionRedirect({ authenticated: false }, 'COMPLETE')).toBe('/login');
  });

  it('현재 단계가 기대 단계와 같으면 화면을 연다', () => {
    expect(getSessionRedirect(authenticatedSession, 'CREATE_WORKSPACE')).toBeNull();
  });

  it.each([
    ['CREATE_WORKSPACE', '/onboarding/workspace'],
    ['CREATE_TEAM', '/onboarding/team'],
    ['COMPLETE', '/my-issues'],
  ] as const)('%s 단계의 정식 경로로 이동시킨다', (onboardingStep, path) => {
    expect(
      getSessionRedirect(
        { ...authenticatedSession, onboardingStep },
        onboardingStep === 'COMPLETE' ? 'CREATE_TEAM' : 'COMPLETE',
      ),
    ).toBe(path);
  });
});
