import { ApiError } from '../errors/api-error';
import { parseMarkdown, parseOptionalMarkdown } from './markdown';

const MEMBERSHIP_ID = '10a5e9fc-9645-4ae0-b7dc-735801c5724d';
const FILE_ID = 'f43fac31-16ca-4ec7-939f-1c91e922abf1';

describe('Markdown 경계', () => {
  it('NFC와 바깥 공백을 정리하고 멘션과 파일을 중복 없이 추출한다', () => {
    expect(
      parseMarkdown(
        `  e\u0301 @[Kim](rivet-member:${MEMBERSHIP_ID}) @[Kim](rivet-member:${MEMBERSHIP_ID})\n` +
          `![one](/files/${FILE_ID}) ![two](/files/${FILE_ID})  `,
        100_000,
      ),
    ).toEqual({
      bodyMarkdown:
        `é @[Kim](rivet-member:${MEMBERSHIP_ID}) @[Kim](rivet-member:${MEMBERSHIP_ID})\n` +
        `![one](/files/${FILE_ID}) ![two](/files/${FILE_ID})`,
      fileIds: [FILE_ID],
      mentionedMembershipIds: [MEMBERSHIP_ID],
    });
  });

  it('HTTP(S) 링크만 허용하고 URL 사용자 정보를 거부한다', () => {
    expect(parseMarkdown('[docs](https://example.com/path?q=1)', 100).bodyMarkdown).toContain(
      'https://example.com',
    );
    expect(() => parseMarkdown('[local](/docs)', 100)).toThrow(ApiError);
    expect(() => parseMarkdown('[secret](https://user:pass@example.com)', 100)).toThrow(ApiError);
  });

  it.each([
    '<script>alert(1)</script>',
    '[x](javascript:alert(1))',
    '[x](vbscript:msgbox(1))',
    '![x](data:image/png;base64,AA)',
    '![x](https://example.com/a.png)',
    '![x][remote]',
    '[x][r]\n[r]: /relative "title"',
    '[x][r]\n[r]: jav&#x61;script:alert(1) "title"',
    '![x](/files/10a5e9fc-9645-1ae0-b7dc-735801c5724d)',
    `[Kim](rivet-member:${MEMBERSHIP_ID})`,
    '@[](rivet-member:10a5e9fc-9645-4ae0-b7dc-735801c5724d)',
    'bad\u0000control',
    'bad\u0085control',
  ])('위험하거나 계약에 맞지 않는 Markdown을 거부한다: %s', (value) => {
    expect(() => parseMarkdown(value, 100_000)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'MARKDOWN_INVALID' }),
        status: 422,
      }),
    );
  });

  it('Unicode code point 길이로 제한한다', () => {
    expect(parseMarkdown('😀😀', 2).bodyMarkdown).toBe('😀😀');
    expect(() => parseMarkdown('😀😀', 1)).toThrow(ApiError);
  });

  it('빈 선택 설명을 null 참조로 정규화한다', () => {
    expect(parseOptionalMarkdown('  ', 100_000)).toEqual({
      bodyMarkdown: null,
      fileIds: [],
      mentionedMembershipIds: [],
    });
  });
});
