import { StateCategory } from '@rivet/database';

import { calculateWorkflowStateProgress } from './issue-response.mapper';

describe('calculateWorkflowStateProgress', () => {
  const states = [
    { category: StateCategory.BACKLOG, id: 'backlog', position: 0 },
    { category: StateCategory.STARTED, id: 'started', position: 2 },
    { category: StateCategory.STARTED, id: 'review', position: 3 },
    { category: StateCategory.COMPLETED, id: 'done', position: 4 },
  ];

  it('STARTED 상태의 범주 내 순서에 따라 열린 구간 진행도를 계산한다', () => {
    expect(
      calculateWorkflowStateProgress(
        { category: StateCategory.STARTED, id: 'started' },
        states,
      ),
    ).toBeCloseTo(1 / 3);
    expect(
      calculateWorkflowStateProgress({ category: StateCategory.STARTED, id: 'review' }, states),
    ).toBeCloseTo(2 / 3);
  });

  it('STARTED가 아닌 상태에는 진행도를 제공하지 않는다', () => {
    expect(
      calculateWorkflowStateProgress({ category: StateCategory.BACKLOG, id: 'backlog' }, states),
    ).toBeNull();
  });
});
