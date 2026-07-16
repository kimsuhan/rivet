import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownRenderer, safeMarkdownUrl } from './markdown-renderer';

const fileId = '4bfe36e1-2a0f-463c-874b-909b25d0cd8a';

describe('MarkdownRenderer', () => {
  it('멤버 멘션의 접두사 @만 숨기고 일반 텍스트와 코드의 @는 유지한다', () => {
    const { container } = render(
      <MarkdownRenderer
        imageUnavailableLabel="이미지를 불러올 수 없습니다"
        markdown={[
          `@[박명수](rivet-member:${fileId}) 확인`,
          '일반 @문자는 유지',
          `\`@[박명수](rivet-member:${fileId})\``,
        ].join('\n\n')}
      />,
    );

    const mention = container.querySelector(`[data-mention-membership-id="${fileId}"]`);

    expect(mention).toHaveTextContent('박명수');
    expect(mention?.parentElement).toHaveTextContent('박명수 확인');
    expect(mention?.parentElement).not.toHaveTextContent('@박명수');
    expect(screen.getByText('일반 @문자는 유지')).toBeInTheDocument();
    expect(screen.getByText(`@[박명수](rivet-member:${fileId})`)).toBeInTheDocument();
  });

  it('HTTP(S) 링크만 탐색 가능하게 남기고 위험하거나 모호한 href는 제거한다', () => {
    render(
      <MarkdownRenderer
        imageUnavailableLabel="이미지를 불러올 수 없습니다"
        markdown={[
          '[safe](https://example.com/path)',
          '[javascript](javascript:alert(1))',
          '[data](data:text/plain,test)',
          '[mail](mailto:test@example.com)',
          '[relative](/settings)',
          '[protocol-relative](//example.com/path)',
          '[userinfo](https://user:secret@example.com/path)',
        ].join('\n\n')}
      />,
    );

    expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute(
      'href',
      'https://example.com/path',
    );
    for (const label of [
      'javascript',
      'data',
      'mail',
      'relative',
      'protocol-relative',
      'userinfo',
    ]) {
      expect(screen.getByText(label).closest('a')).toBeNull();
    }
  });

  it('정확한 파일 UUID 이미지만 인증 스트리밍 주소로 렌더한다', () => {
    render(
      <MarkdownRenderer
        imageUnavailableLabel="이미지를 불러올 수 없습니다"
        markdown={[
          `![정상 이미지](/files/${fileId})`,
          '![외부 이미지](https://example.com/image.png)',
          '![Data 이미지](data:image/png;base64,AAAA)',
          '![잘못된 파일](/files/not-a-uuid)',
        ].join('\n\n')}
      />,
    );

    expect(screen.getByRole('img', { name: '정상 이미지' }).getAttribute('src')).toContain(
      `/api/v1/files/${fileId}/content`,
    );
    for (const label of ['외부 이미지', 'Data 이미지', '잘못된 파일']) {
      expect(screen.getByRole('img', { name: label })).toHaveTextContent(
        '이미지를 불러올 수 없습니다',
      );
    }
  });

  it('raw HTML은 실행하거나 DOM으로 렌더하지 않는다', () => {
    const { container } = render(
      <MarkdownRenderer
        imageUnavailableLabel="이미지를 불러올 수 없습니다"
        markdown={'<script>window.__unsafe = true</script>\n<img src="x" onerror="alert(1)">'}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).not.toHaveTextContent('window.__unsafe');
  });
});

describe('safeMarkdownUrl', () => {
  it('허용 목록 밖 URL을 null로 정규화한다', () => {
    expect(safeMarkdownUrl('https://example.com', 'href', {} as never)).toBe(
      'https://example.com/',
    );
    expect(safeMarkdownUrl('https://u:p@example.com', 'href', {} as never)).toBeNull();
    expect(safeMarkdownUrl('/relative', 'href', {} as never)).toBeNull();
    expect(safeMarkdownUrl('//example.com', 'href', {} as never)).toBeNull();
    expect(safeMarkdownUrl('mailto:a@example.com', 'href', {} as never)).toBeNull();
    expect(safeMarkdownUrl('javascript:alert(1)', 'href', {} as never)).toBeNull();
    expect(safeMarkdownUrl(`rivet-member:${fileId}`, 'href', {} as never)).toBe(
      `rivet-member:${fileId}`,
    );
    expect(safeMarkdownUrl(`/files/${fileId}`, 'src', {} as never)).toBe(`/files/${fileId}`);
    expect(safeMarkdownUrl('data:image/png;base64,AA', 'src', {} as never)).toBeNull();
  });
});
