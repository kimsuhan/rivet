import {
  createEmailVerificationTemplate,
  createPasswordResetTemplate,
  createWorkspaceInvitationTemplate,
} from './account-email-templates';

describe('account email templates', () => {
  const link = 'https://rivet.example.com/verify-email#token=test-token';

  it('renders the Korean email verification message and lifetime', () => {
    expect(createEmailVerificationTemplate(link)).toMatchObject({
      html: expect.stringContaining(`<a href="${link}">이메일 인증하기</a>`),
      subject: '[Rivet] 이메일 주소를 인증해 주세요',
      text: expect.stringContaining('24시간'),
    });
  });

  it('renders the Korean password reset message and lifetime', () => {
    expect(createPasswordResetTemplate(link)).toMatchObject({
      html: expect.stringContaining('비밀번호 재설정하기'),
      subject: '[Rivet] 비밀번호를 재설정해 주세요',
      text: expect.stringContaining('30분'),
    });
  });

  it('renders an escaped Korean workspace invitation and lifetime', () => {
    expect(
      createWorkspaceInvitationTemplate({
        inviterDisplayName: '<관리자>',
        link: 'https://rivet.example.com/invite#token=test-token',
        workspaceName: 'Rivet & 팀',
      }),
    ).toMatchObject({
      html: expect.stringContaining('&lt;관리자&gt; 님이 Rivet &amp; 팀'),
      subject: '[Rivet] 워크스페이스 초대를 확인해 주세요',
      text: expect.stringContaining('7일'),
    });
  });
});
