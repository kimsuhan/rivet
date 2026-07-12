export function createEmailVerificationTemplate(link: string): {
  html: string;
  subject: string;
  text: string;
} {
  return {
    html: `<!doctype html><html lang="ko"><body><p>Rivet 가입을 완료하려면 아래 링크에서 이메일 주소를 인증해 주세요.</p><p><a href="${link}">이메일 인증하기</a></p><p>이 링크는 24시간 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요.</p></body></html>`,
    subject: '[Rivet] 이메일 주소를 인증해 주세요',
    text: `Rivet 가입을 완료하려면 아래 링크에서 이메일 주소를 인증해 주세요.\n\n${link}\n\n이 링크는 24시간 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요.`,
  };
}

export function createPasswordResetTemplate(link: string): {
  html: string;
  subject: string;
  text: string;
} {
  return {
    html: `<!doctype html><html lang="ko"><body><p>아래 링크에서 Rivet 비밀번호를 새로 설정해 주세요.</p><p><a href="${link}">비밀번호 재설정하기</a></p><p>이 링크는 30분 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요.</p></body></html>`,
    subject: '[Rivet] 비밀번호를 재설정해 주세요',
    text: `아래 링크에서 Rivet 비밀번호를 새로 설정해 주세요.\n\n${link}\n\n이 링크는 30분 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요.`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createWorkspaceInvitationTemplate(input: {
  inviterDisplayName: string;
  link: string;
  workspaceName: string;
}): { html: string; subject: string; text: string } {
  const inviterDisplayName = escapeHtml(input.inviterDisplayName);
  const workspaceName = escapeHtml(input.workspaceName);

  return {
    html: `<!doctype html><html lang="ko"><body><p>${inviterDisplayName} 님이 ${workspaceName} 워크스페이스에 초대했습니다.</p><p><a href="${input.link}">초대 확인하기</a></p><p>이 링크는 7일 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요.</p></body></html>`,
    subject: '[Rivet] 워크스페이스 초대를 확인해 주세요',
    text: `${input.inviterDisplayName} 님이 ${input.workspaceName} 워크스페이스에 초대했습니다.\n\n${input.link}\n\n이 링크는 7일 동안 유효합니다. 요청하지 않았다면 이 메일을 무시해 주세요.`,
  };
}
