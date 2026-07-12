import { describe, expect, it } from 'vitest';

import {
  extractHandoffApiSpecificationUrl,
  HANDOFF_TEMPLATE,
  handoffBodyError,
} from './issue-handoff-validation';

describe('handoffBodyError', () => {
  it('정확한 일곱 H2 섹션과 본문 안의 안전한 HTTP(S) 링크를 허용한다', () => {
    const body = HANDOFF_TEMPLATE.replace(
      '## API 명세 링크\n\n해당 없음',
      '## API 명세 링크\n\nOpenAPI: https://api.example.com/openapi.json',
    );

    expect(handoffBodyError(body)).toBeNull();
    expect(extractHandoffApiSpecificationUrl(body)).toBe('https://api.example.com/openapi.json');
  });

  it('추가 H2, 빈 의미 내용과 잘못된 순서를 거부한다', () => {
    expect(handoffBodyError(`${HANDOFF_TEMPLATE}\n\n## 추가 항목\n\n내용`)).toBe('content');
    expect(handoffBodyError(HANDOFF_TEMPLATE.replace('해당 없음', '** **'))).toBe('content');
    expect(
      handoffBodyError(
        HANDOFF_TEMPLATE.replace('## 변경 요약', '## 임의 항목').replace(
          '## API 명세 링크',
          '## 변경 요약',
        ),
      ),
    ).toBe('content');
  });

  it('URL 후보가 없거나 userinfo가 포함된 API 명세 링크를 거부한다', () => {
    expect(
      handoffBodyError(
        HANDOFF_TEMPLATE.replace(
          '## API 명세 링크\n\n해당 없음',
          '## API 명세 링크\n\nftp://api.example.com',
        ),
      ),
    ).toBe('link');
    expect(
      handoffBodyError(
        HANDOFF_TEMPLATE.replace(
          '## API 명세 링크\n\n해당 없음',
          '## API 명세 링크\n\nhttps://user:secret@api.example.com/openapi.json',
        ),
      ),
    ).toBe('link');
    expect(
      extractHandoffApiSpecificationUrl(
        HANDOFF_TEMPLATE.replace(
          '## API 명세 링크\n\n해당 없음',
          '## API 명세 링크\n\nhttps://user:secret@api.example.com/openapi.json',
        ),
      ),
    ).toBeNull();
  });
});
