import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RivetSymbol, RivetWordmark } from './brand';

describe('Rivet 브랜드 이미지', () => {
  it('교체된 로고를 새 이미지 최적화 캐시 키로 요청한다', () => {
    render(
      <>
        <RivetWordmark alt="Rivet 워드마크" />
        <RivetSymbol alt="Rivet 심볼" />
      </>,
    );

    expect(screen.getByRole('img', { name: 'Rivet 워드마크' })).toHaveAttribute(
      'src',
      '/_next/image?url=%2Fbrand%2Flogo.png%3Fv%3D20260715&w=3840&q=75',
    );
    expect(screen.getByRole('img', { name: 'Rivet 심볼' })).toHaveAttribute(
      'src',
      '/_next/image?url=%2Fbrand%2Fsymbol.png%3Fv%3D20260715&w=1920&q=75',
    );
  });
});
