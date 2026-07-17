import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthControllerGetSessionQueryKey } from '@rivet/api-client';

import { optimizeProfileImage } from '@/features/files/image-optimizer';

import { ProfileDialog } from './profile-dialog';

vi.mock('@/features/files/image-optimizer', () => ({
  optimizeProfileImage: vi.fn(async (file: File) => file),
}));

const labels = {
  cancel: '취소',
  choose: '사진 선택',
  close: '프로필 닫기',
  description: '프로필 설명',
  discard: '선택 제거',
  emailDescription: '이메일 변경 불가',
  emailLabel: '이메일',
  emptyFile: '빈 파일',
  fileLimit: '파일 제한',
  invalidType: '잘못된 형식',
  nameDescription: '이름 설명',
  nameLabel: '이름',
  nameRequired: '이름 필수',
  nameTooLong: '이름 길이 초과',
  optimizing: '최적화 중',
  photoDescription: '사진 설명',
  photoLabel: '프로필 사진',
  previewAlt: '사진 미리보기',
  remove: '현재 사진 삭제',
  removing: '삭제 중',
  retry: '다시 시도',
  save: '변경 저장',
  saving: '저장 중',
  title: '프로필 설정',
  unexpectedError: '프로필 오류',
  uploading: '업로드 중',
};

const user = {
  avatarFileId: null,
  displayName: '김리벳',
  email: 'kim@example.com',
  id: 'user-1',
};

function Provider({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function seedNoWorkspaceSession(queryClient: QueryClient, avatarFileId: string | null) {
  queryClient.setQueryData(getAuthControllerGetSessionQueryKey(), {
    authenticated: true,
    csrfToken: 'csrf',
    membership: null,
    onboardingStep: 'CREATE_WORKSPACE',
    user: { ...user, avatarFileId },
    workspace: null,
  });
}

describe('ProfileDialog', () => {
  beforeEach(() => {
    const BrowserUrl = URL;
    class MockUrl extends BrowserUrl {
      static override createObjectURL = vi.fn(() => 'blob:preview');
      static override revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', MockUrl);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('사진 관리와 계정 정보를 구분하고 취소 동작을 제공한다', async () => {
    const queryClient = new QueryClient();
    seedNoWorkspaceSession(queryClient, null);
    const onOpenChange = vi.fn();
    const browser = userEvent.setup();

    render(<ProfileDialog open labels={labels} user={user} onOpenChange={onOpenChange} />, {
      wrapper: ({ children }) => <Provider queryClient={queryClient}>{children}</Provider>,
    });

    expect(screen.getByText(labels.photoLabel)).toBeVisible();
    expect(screen.getByText(labels.photoDescription)).toBeVisible();
    expect(screen.getByText(labels.emailLabel)).toBeVisible();
    expect(screen.getByText(labels.emailDescription)).toBeVisible();
    expect(screen.getByText(user.email)).toBeVisible();

    await browser.click(screen.getByRole('button', { name: labels.cancel }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('워크스페이스 없는 사용자도 사진을 업로드·연결하고 세션 캐시를 즉시 갱신한다', async () => {
    const queryClient = new QueryClient();
    seedNoWorkspaceSession(queryClient, null);
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockRejectedValue(new Error('refetch failed'));
    const onOpenChange = vi.fn();
    const setAvatar = vi.fn(async () => ({}));
    const sendFile = vi.fn(async (file: File) => ({
      createdAt: new Date(0).toISOString(),
      detectedMimeType: file.type,
      id: 'file-1',
      inlineDisplayable: true,
      linked: false,
      originalName: file.name,
      scope: 'USER_PROFILE' as const,
      sizeBytes: file.size,
    }));
    const browser = userEvent.setup();

    render(
      <ProfileDialog
        open
        labels={labels}
        user={user}
        onOpenChange={onOpenChange}
        sendFile={sendFile}
        setAvatar={setAvatar}
      />,
      { wrapper: ({ children }) => <Provider queryClient={queryClient}>{children}</Provider> },
    );

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    await browser.upload(screen.getByLabelText(labels.choose), file);
    await waitFor(() => expect(screen.getByRole('button', { name: labels.save })).toBeEnabled());
    await browser.click(screen.getByRole('button', { name: labels.save }));

    expect(optimizeProfileImage).toHaveBeenCalledWith(file);
    expect(sendFile).toHaveBeenCalledWith(file, 'USER_PROFILE');
    expect(setAvatar).toHaveBeenCalledWith('file-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getAuthControllerGetSessionQueryKey(),
      refetchType: 'active',
    });
    expect(
      queryClient.getQueryData<{ user: { avatarFileId: string | null } }>(
        getAuthControllerGetSessionQueryKey(),
      )?.user.avatarFileId,
    ).toBe('file-1');
  });

  it('표시 이름만 변경하고 세션 캐시를 즉시 갱신한다', async () => {
    const queryClient = new QueryClient();
    seedNoWorkspaceSession(queryClient, null);
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'));
    const onOpenChange = vi.fn();
    const updateProfile = vi.fn(async (displayName: string) => ({ ...user, displayName }));
    const browser = userEvent.setup();

    render(
      <ProfileDialog
        open
        labels={labels}
        user={user}
        onOpenChange={onOpenChange}
        updateProfile={updateProfile}
      />,
      { wrapper: ({ children }) => <Provider queryClient={queryClient}>{children}</Provider> },
    );

    const name = screen.getByRole('textbox', { name: labels.nameLabel });
    await browser.clear(name);
    await browser.type(name, '새 이름');
    await browser.click(screen.getByRole('button', { name: labels.save }));

    expect(updateProfile).toHaveBeenCalledWith('새 이름');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(
      queryClient.getQueryData<{ user: { displayName: string } }>(
        getAuthControllerGetSessionQueryKey(),
      )?.user.displayName,
    ).toBe('새 이름');
  });

  it('현재 사진 삭제 성공은 refetch 결과와 무관하게 캐시에 반영하고 닫는다', async () => {
    const queryClient = new QueryClient();
    seedNoWorkspaceSession(queryClient, 'old-file');
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'));
    const clearAvatar = vi.fn(async () => ({}));
    const onOpenChange = vi.fn();
    const browser = userEvent.setup();

    render(
      <ProfileDialog
        open
        labels={labels}
        user={{ ...user, avatarFileId: 'old-file' }}
        onOpenChange={onOpenChange}
        clearAvatar={clearAvatar}
      />,
      { wrapper: ({ children }) => <Provider queryClient={queryClient}>{children}</Provider> },
    );

    await browser.click(screen.getByRole('button', { name: labels.remove }));

    expect(clearAvatar).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(
      queryClient.getQueryData<{ user: { avatarFileId: string | null } }>(
        getAuthControllerGetSessionQueryKey(),
      )?.user.avatarFileId,
    ).toBeNull();
  });
});
