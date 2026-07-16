import type { AuthenticatedSessionDto, UnauthenticatedSessionDto } from '@rivet/api-client';

export type RequiredSessionStep = AuthenticatedSessionDto['onboardingStep'];

const stepPath: Record<RequiredSessionStep, string> = {
  ACCEPT_INVITATION: '/invite',
  COMPLETE: '/my-issues',
  CREATE_TEAM: '/onboarding/team',
  CREATE_WORKSPACE: '/onboarding/workspace',
};

export function getSessionRedirect(
  session: AuthenticatedSessionDto | UnauthenticatedSessionDto,
  expectedStep: RequiredSessionStep,
): string | null {
  if (!session.authenticated) {
    return '/login';
  }

  return session.onboardingStep === expectedStep ? null : stepPath[session.onboardingStep];
}
