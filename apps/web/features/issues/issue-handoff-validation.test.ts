import { describe, expect, it } from 'vitest';

import {
  extractHandoffApiSpecificationUrl,
  FOLLOW_UP_HANDOFF_TEMPLATE,
  HANDOFF_TEMPLATE,
  handoffBodyError,
} from './issue-handoff-validation';

describe('handoffBodyError', () => {
  it('필요한 섹션만 채운 최초 전달과 안전한 API 링크를 허용한다', () => {
    const body = HANDOFF_TEMPLATE.replace(
      '## 변경 요약',
      '## 변경 요약\n\n변경된 응답에 workspaceId를 추가했습니다.',
    ).replace('## API 명세 링크', '## API 명세 링크\n\nhttps://api.example.com/openapi.json');

    expect(handoffBodyError(body)).toBeNull();
    expect(extractHandoffApiSpecificationUrl(body)).toBe('https://api.example.com/openapi.json');
  });

  it('제목만 있는 빈 전달을 거부하고 추가 전달 템플릿을 허용한다', () => {
    expect(handoffBodyError(HANDOFF_TEMPLATE)).toBe('content');
    expect(handoffBodyError(`${FOLLOW_UP_HANDOFF_TEMPLATE}\n\n클라이언트 캐시를 갱신해 주세요.`)).toBeNull();
  });

  it('userinfo가 포함된 링크는 API 명세 링크로 해석하지 않는다', () => {
    expect(
      extractHandoffApiSpecificationUrl(
        `${HANDOFF_TEMPLATE}\n\nhttps://user:secret@api.example.com/openapi.json`,
      ),
    ).toBeNull();
  });
});
