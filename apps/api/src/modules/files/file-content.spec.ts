import {
  contentDisposition,
  detectMimeType,
  isInlineDisplayable,
  sanitizeOriginalName,
} from './file-content';

describe('file content rules', () => {
  it.each([
    [Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    [Buffer.from('RIFF0000WEBP'), 'image/webp'],
    [Buffer.from('GIF87a'), 'image/gif'],
    [Buffer.from('GIF89a'), 'image/gif'],
    [Buffer.from('<svg></svg>'), 'application/octet-stream'],
  ])('detects trusted magic bytes', (bytes, expected) => {
    expect(detectMimeType(bytes)).toBe(expected);
    expect(isInlineDisplayable(expected)).toBe(expected !== 'application/octet-stream');
  });

  it('sanitizes display-only names and encodes RFC 5987 disposition', () => {
    const name = sanitizeOriginalName('../unsafe\\보고서\u0000.png');

    expect(name).toBe('보고서.png');
    expect(contentDisposition('attachment', name)).toBe(
      'attachment; filename="___.png"; filename*=UTF-8\'\'%EB%B3%B4%EA%B3%A0%EC%84%9C.png',
    );
  });
});
