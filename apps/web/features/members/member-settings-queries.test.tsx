import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  invitationsControllerList,
  membersControllerList,
  type MemberSummaryResponseDto,
} from '@rivet/api-client';

import { useInvitationPages, useMemberPages } from './member-settings-queries';

vi.mock('@rivet/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invitationsControllerList: vi.fn(),
  membersControllerList: vi.fn(),
}));

const firstMember = {
  deactivatedAt: null,
  email: 'first@example.com',
  id: 'membership-first',
  joinedAt: '2026-07-01T00:00:00.000Z',
  role: 'MEMBER',
  status: 'ACTIVE',
  user: { avatarFileId: null, displayName: '첫 페이지 멤버', id: 'user-first' },
} satisfies MemberSummaryResponseDto;
const nextMember = {
  ...firstMember,
  email: 'next@example.com',
  id: 'membership-next',
  user: { ...firstMember.user, displayName: '다음 페이지 멤버', id: 'user-next' },
} satisfies MemberSummaryResponseDto;

let queryClient: QueryClient;

function QueryWrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('member settings infinite queries', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('멤버 다음 커서를 전달하고 기존 페이지 뒤에 결과를 누적한다', async () => {
    vi.mocked(membersControllerList)
      .mockResolvedValueOnce({ items: [firstMember], nextCursor: 'member-cursor' })
      .mockResolvedValueOnce({ items: [nextMember], nextCursor: null });

    const { result } = renderHook(() => useMemberPages('ACTIVE'), { wrapper: QueryWrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(membersControllerList).toHaveBeenNthCalledWith(
      1,
      { limit: 100, status: 'ACTIVE' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    let nextResult: Awaited<ReturnType<typeof result.current.fetchNextPage>> | undefined;
    await act(async () => {
      nextResult = await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(membersControllerList).toHaveBeenNthCalledWith(
      2,
      { cursor: 'member-cursor', limit: 100, status: 'ACTIVE' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(nextResult?.data?.pages.flatMap((page) => page.items)).toEqual([
      firstMember,
      nextMember,
    ]);
    expect(nextResult?.hasNextPage).toBe(false);
  });

  it('초대 다음 커서를 전달하고 기존 기록 뒤에 결과를 누적한다', async () => {
    const firstInvitation = {
      acceptedAt: null,
      canceledAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      email: 'first@example.com',
      expiresAt: '2026-07-18T00:00:00.000Z',
      id: 'invitation-first',
      invitedByDisplayName: '관리자',
      invitedByMembershipId: 'membership-admin',
      status: 'PENDING' as const,
    };
    const nextInvitation = {
      ...firstInvitation,
      email: 'next@example.com',
      id: 'invitation-next',
    };
    vi.mocked(invitationsControllerList)
      .mockResolvedValueOnce({ items: [firstInvitation], nextCursor: 'invitation-cursor' })
      .mockResolvedValueOnce({ items: [nextInvitation], nextCursor: null });

    const { result } = renderHook(() => useInvitationPages('PENDING'), { wrapper: QueryWrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(invitationsControllerList).toHaveBeenNthCalledWith(
      1,
      { limit: 100, status: 'PENDING' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    let nextResult: Awaited<ReturnType<typeof result.current.fetchNextPage>> | undefined;
    await act(async () => {
      nextResult = await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(invitationsControllerList).toHaveBeenNthCalledWith(
      2,
      { cursor: 'invitation-cursor', limit: 100, status: 'PENDING' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(nextResult?.data?.pages.flatMap((page) => page.items)).toEqual([
      firstInvitation,
      nextInvitation,
    ]);
  });
});
