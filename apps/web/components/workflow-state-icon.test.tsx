import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  workflowStateColorKey,
  WorkflowStateIcon,
  workflowStateProgress,
} from './workflow-state-icon';

const states = [
  { category: 'STARTED' as const, id: 'doing', position: 3 },
  { category: 'STARTED' as const, id: 'review', position: 4 },
  { category: 'COMPLETED' as const, id: 'done', position: 5 },
];

describe('WorkflowStateIcon', () => {
  it('진행 중 상태의 범주 내 순서로 파이 진행도를 계산한다', () => {
    expect(workflowStateProgress(states, states[0]!)).toBeCloseTo(1 / 3);
    expect(workflowStateProgress(states, states[1]!)).toBeCloseTo(2 / 3);
    expect(workflowStateProgress(states, states[2]!)).toBeNull();
  });

  it('커스텀 색을 사용하고 잘못된 값은 범주 기본색으로 대체한다', () => {
    expect(workflowStateColorKey('STARTED', 'TEAL')).toBe('TEAL');
    expect(workflowStateColorKey('STARTED', null)).toBe('INDIGO');
    expect(workflowStateColorKey('COMPLETED', 'UNKNOWN')).toBe('GREEN');
  });

  it('Started 파이의 진행도와 색을 SVG에 반영한다', () => {
    const { container, rerender } = render(
      <WorkflowStateIcon category="STARTED" color="ORANGE" progress={1 / 3} />,
    );
    const firstIcon = container.querySelector('svg');
    const firstPath = container.querySelector('path')?.getAttribute('d');

    expect(firstIcon).toHaveAttribute('aria-hidden', 'true');
    expect(firstIcon).toHaveAttribute('data-workflow-state-color', 'ORANGE');
    expect(Number(firstIcon?.getAttribute('data-workflow-state-progress'))).toBeCloseTo(1 / 3);

    rerender(<WorkflowStateIcon category="STARTED" color="ORANGE" progress={2 / 3} />);
    expect(container.querySelector('path')?.getAttribute('d')).not.toBe(firstPath);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
