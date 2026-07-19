import { describe, expect, it } from 'vitest';

import {
  extractHandoffApiSpecificationUrl,
  FOLLOW_UP_HANDOFF_TEMPLATE,
  HANDOFF_TEMPLATE,
  handoffBodyError,
  stripEmptyHandoffSections,
} from './issue-handoff-validation';

describe('handoffBodyError', () => {
  it('필요한 섹션만 채운 최초 전달과 안전한 결과물 링크를 허용한다', () => {
    const body = HANDOFF_TEMPLATE.replace(
      '## 작업 결과 요약',
      '## 작업 결과 요약\n\n변경된 응답에 workspaceId를 추가했습니다.',
    ).replace('## 결과물 링크', '## 결과물 링크\n\nhttps://api.example.com/openapi.json');

    expect(handoffBodyError(body)).toBeNull();
    expect(extractHandoffApiSpecificationUrl(body)).toBe('https://api.example.com/openapi.json');
  });

  it('제목만 있는 빈 전달을 거부하고 추가 전달 템플릿을 허용한다', () => {
    expect(handoffBodyError(HANDOFF_TEMPLATE)).toBe('content');
    expect(
      handoffBodyError(`${FOLLOW_UP_HANDOFF_TEMPLATE}\n\n클라이언트 캐시를 갱신해 주세요.`),
    ).toBeNull();
  });

  it('userinfo가 포함된 링크는 결과물 링크로 해석하지 않는다', () => {
    expect(
      extractHandoffApiSpecificationUrl(
        `${HANDOFF_TEMPLATE}\n\nhttps://user:secret@api.example.com/openapi.json`,
      ),
    ).toBeNull();
  });
});

describe('stripEmptyHandoffSections', () => {
  it('값이 있는 섹션만 남기고 빈 섹션 제목은 제거한다', () => {
    const body = HANDOFF_TEMPLATE.replace(
      '## 작업 결과 요약',
      '## 작업 결과 요약\n\nteamWorkId로 조회 방식을 바꿨습니다.',
    );

    const stripped = stripEmptyHandoffSections(body);

    expect(stripped).toContain('## 작업 결과 요약');
    expect(stripped).not.toContain('## 결과물 링크');
    expect(stripped).not.toContain('## 사용 가능 환경');
  });

  it('모든 섹션이 비어 있으면 빈 문자열을 반환한다', () => {
    expect(stripEmptyHandoffSections(HANDOFF_TEMPLATE)).toBe('');
  });

  it('섹션 헤딩 없는 자유 서식 본문은 그대로 보존한다', () => {
    const freeform = 'API 응답에 workspaceId 필드가 추가되었습니다.';
    expect(stripEmptyHandoffSections(freeform)).toBe(freeform);
  });
});
