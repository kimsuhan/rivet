import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingProfile } from './onboarding-profile';

vi.mock('@rivet/api-client', () => ({
  useAuthControllerGetSession: () => ({
    data: {
      authenticated: true,
      membership: null,
      onboardingStep: 'CREATE_WORKSPACE',
      user: {
        avatarFileId: null,
        displayName: '김리벳',
        email: 'kim@example.com',
        id: 'user-1',
      },
      workspace: null,
    },
  }),
}));

vi.mock('./profile-dialog', () => ({
  ProfileDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="프로필 설정" /> : null,
}));

const dialog = {
  cancel: '취소',
  choose: '사진 선택',
  close: '닫기',
  description: '설명',
  discard: '선택 제거',
  emailDescription: '이메일 변경 불가',
  emailLabel: '이메일',
  emptyFile: '빈 파일',
  fileLimit: '파일 제한',
  invalidType: '형식 오류',
  nameDescription: '이름 설명',
  nameLabel: '이름',
  nameRequired: '이름 필수',
  nameTooLong: '이름 길이 초과',
  optimizing: '최적화 중',
  photoDescription: '사진 설명',
  photoLabel: '프로필 사진',
  previewAlt: '미리보기',
  remove: '삭제',
  removing: '삭제 중',
  retry: '다시 시도',
  save: '저장',
  saving: '저장 중',
  title: '프로필 설정',
  unexpectedError: '오류',
  uploading: '업로드 중',
};

describe('OnboardingProfile', () => {
  it('워크스페이스를 만들기 전에도 현재 사용자 프로필 설정을 연다', async () => {
    const browser = userEvent.setup();
    render(<OnboardingProfile labels={{ dialog, open: '프로필 설정 열기' }} />);

    await browser.click(screen.getByRole('button', { name: '프로필 설정 열기' }));
    expect(screen.getByRole('dialog', { name: '프로필 설정' })).toBeVisible();
  });
});
