import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IssueLabelChips } from './issue-label-chips';

const labels = [
  { archived: false, color: '#72A7F2', id: 'label-1', name: '퍼렁퍼렁' },
  { archived: false, color: '#9A8CF2', id: 'label-2', name: '라벤더' },
  { archived: false, color: '#45C46B', id: 'label-3', name: '완료 조건' },
];

describe('IssueLabelChips', () => {
  afterEach(cleanup);

  it('같은 라벨 칩을 제한 개수까지 표시하고 나머지는 +N으로 요약한다', () => {
    render(<IssueLabelChips emptyLabel="라벨 없음" labels={labels} />);

    expect(screen.getByText('퍼렁퍼렁')).toBeVisible();
    expect(screen.getByText('라벤더')).toBeVisible();
    expect(screen.queryByText('완료 조건')).toBeNull();
    expect(screen.getByText('+1')).toBeVisible();
  });

  it('상세의 빈 라벨은 입력처럼 보이지 않는 읽기 값으로 표시한다', () => {
    render(<IssueLabelChips emptyLabel="라벨 없음" labels={[]} showEmpty />);
    expect(screen.getByText('라벨 없음')).toHaveClass('text-muted-foreground', 'text-sm');
  });
});
