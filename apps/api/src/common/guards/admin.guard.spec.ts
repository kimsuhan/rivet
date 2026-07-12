import type { ExecutionContext } from '@nestjs/common';

import type { RequestWithAuthentication } from '../../modules/auth/authenticated-request';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const membership = {
    id: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const workspace = {
    id: membership.workspaceId,
    name: '제품 개발팀',
    slug: 'product-team',
    version: 1,
  };

  function executionContext(request: RequestWithAuthentication): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  }

  it('allows an active admin in the authenticated workspace', () => {
    const guard = new AdminGuard();

    expect(
      guard.canActivate(
        executionContext({
          authentication: {
            session: {
              membership,
              sessionId: '1f584d67-740d-470b-b354-e3c33a905dea',
              user: {
                displayName: '관리자',
                email: 'admin@example.com',
                emailVerifiedAt: new Date(),
                id: '0f2a23cc-196f-4e6e-88a0-71e1272841e0',
              },
              workspace,
            },
            sessionToken: 'session-token',
          },
        } as RequestWithAuthentication),
      ),
    ).toBe(true);
  });

  it.each([
    undefined,
    { ...membership, role: 'MEMBER' as const },
    { ...membership, status: 'INACTIVE' as const },
    { ...membership, workspaceId: 'dd151af4-f97e-4cf2-ab03-43be72bb2782' },
  ])('rejects a missing or unsafe admin membership', (unsafeMembership) => {
    const guard = new AdminGuard();
    const request = {
      authentication: unsafeMembership
        ? {
            session: {
              membership: unsafeMembership,
              sessionId: '1f584d67-740d-470b-b354-e3c33a905dea',
              user: {
                displayName: '사용자',
                email: 'user@example.com',
                emailVerifiedAt: new Date(),
                id: '0f2a23cc-196f-4e6e-88a0-71e1272841e0',
              },
              workspace,
            },
            sessionToken: 'session-token',
          }
        : undefined,
    } as RequestWithAuthentication;

    expect(() => guard.canActivate(executionContext(request))).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });
});
