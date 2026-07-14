import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IssueStatusDisplay, PriorityDisplay, TeamWorkStatusDisplay } from './issue-attribute-presentation';

describe('이슈 속성 Compact 표현', () => {
  it('고정 이슈 상태에 아이콘과 한국어 상태명을 함께 표시한다', () => {
    render(<IssueStatusDisplay status="PAUSED" />);
    expect(screen.getByText('일시 중지')).toBeVisible();
    expect(document.querySelector('.lucide-circle-pause')).toHaveClass('text-warning');
  });

  it('팀 작업 상태와 우선순위는 색상만이 아닌 아이콘과 이름으로 구분한다', () => {
    render(<><TeamWorkStatusDisplay category="COMPLETED" /><PriorityDisplay priority="URGENT" /></>);
    expect(screen.getByText('완료')).toBeVisible();
    expect(screen.getByText('긴급')).toBeVisible();
    expect(document.querySelector('.lucide-circle-check')).toHaveClass('text-success');
    expect(document.querySelector('.lucide-circle-alert')).toHaveClass('text-destructive');
  });
});
