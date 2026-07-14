export const HANDOFF_SECTION_TITLES = [
  '변경 요약',
  'API 명세 링크',
  '사용 가능 환경',
  '추가·변경 API',
  '요청·응답 변경',
  '오류·권한',
  '프론트 주의사항',
] as const;

export const HANDOFF_TEMPLATE = HANDOFF_SECTION_TITLES.map(
  (heading) => `## ${heading}`,
).join('\n\n');

export const FOLLOW_UP_HANDOFF_TEMPLATE = [
  '## 변경 요약',
  '## 변경된 API 또는 요청·응답',
  '## 프론트에서 필요한 조치',
].join('\n\n');

function safeHttpUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function extractHandoffApiSpecificationUrl(body: string): string | null {
  const bodyMarkdown = body.normalize('NFC').trim();
  const headings = [...bodyMarkdown.matchAll(/^##[ \t]+(.+?)[ \t]*$/gmu)];
  const apiHeadingIndex = headings.findIndex((heading) => heading[1] === 'API 명세 링크');
  const apiHeading = headings[apiHeadingIndex];
  if (!apiHeading) return null;

  const contentStart = (apiHeading.index ?? 0) + apiHeading[0].length;
  const contentEnd = headings[apiHeadingIndex + 1]?.index ?? bodyMarkdown.length;
  const content = bodyMarkdown.slice(contentStart, contentEnd).trim();
  const candidates = content.match(/https?:\/\/[^\s<>\])]+/giu) ?? [];

  for (const candidate of candidates) {
    const url = safeHttpUrl(candidate);
    if (url) return url;
  }
  return null;
}

export function handoffBodyError(body: string): 'content' | 'link' | null {
  const bodyMarkdown = body.normalize('NFC').trim();
  if ([...bodyMarkdown].length > 50_000) return 'content';

  const unsafeControlCharacter = [...bodyMarkdown].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
  if (
    unsafeControlCharacter ||
    /<\/?[a-z][^>]*>/iu.test(bodyMarkdown) ||
    /\b(?:javascript|vbscript|data)\s*:/iu.test(bodyMarkdown)
  ) {
    return 'content';
  }

  if (bodyMarkdown.replace(/^#{1,6}[ \t].*$/gmu, '').trim().length === 0) return 'content';

  return null;
}
