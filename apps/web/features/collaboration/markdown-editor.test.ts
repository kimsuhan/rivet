import { describe, expect, it } from 'vitest';

import { markdownCharacterCount, normalizeSafeHttpUrl, serializeMention } from './markdown-editor';

const membershipId = '4bfe36e1-2a0f-463c-874b-909b25d0cd8a';

describe('Markdown editor contract', () => {
  it('멘션을 서버 계약 형식으로 직렬화하고 닫는 대괄호를 이스케이프한다', () => {
    expect(serializeMention('김리벳', membershipId)).toBe(
      `@[김리벳](rivet-member:${membershipId})`,
    );
    expect(serializeMention('김]리벳', membershipId)).toBe(
      `@[김\\]리벳](rivet-member:${membershipId})`,
    );
  });

  it('글자 수를 UTF-16 코드 유닛이 아니라 code point로 계산한다', () => {
    expect(markdownCharacterCount('가A😀')).toBe(3);
  });

  it('에디터 링크도 안전한 HTTP(S)와 자격 정보 없는 URL만 허용한다', () => {
    expect(normalizeSafeHttpUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(normalizeSafeHttpUrl('https://u:p@example.com')).toBeNull();
    expect(normalizeSafeHttpUrl('/relative')).toBeNull();
    expect(normalizeSafeHttpUrl('mailto:a@example.com')).toBeNull();
  });
});
