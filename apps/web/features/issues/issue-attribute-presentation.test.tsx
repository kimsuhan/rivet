import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORKFLOW_STATE_PRESENTATION } from '@/components/workflow-state-icon';

import {
  IssueStatusDisplay,
  PriorityDisplay,
  StatusTrigger,
  TEAM_WORK_STATUS_PRESENTATION,
  TeamWorkStatusDisplay,
} from './issue-attribute-presentation';

describe('이슈 속성 Compact 표현', () => {
  afterEach(cleanup);

  it('고정 이슈 상태에 아이콘과 한국어 상태명을 함께 표시한다', () => {
    render(<IssueStatusDisplay status="PAUSED" />);
    expect(screen.getByText('일시 중지')).toBeVisible();
    expect(document.querySelector('.lucide-circle-pause')).toHaveClass('text-warning');
  });

  it('팀 작업 상태와 우선순위는 색상만이 아닌 아이콘과 이름으로 구분한다', () => {
    render(
      <>
        <TeamWorkStatusDisplay category="BACKLOG" name="미분류" />
        <PriorityDisplay priority="URGENT" />
      </>,
    );
    expect(screen.getByText('미분류')).toBeVisible();
    expect(screen.getByText('긴급')).toBeVisible();
    expect(document.querySelector('[data-workflow-state-category="BACKLOG"]')).toHaveAttribute(
      'data-workflow-state-color',
      'GRAY',
    );
    expect(document.querySelector('.lucide-circle-alert')).toHaveClass('text-destructive');
  });

  it('팀 작업 상태 표현은 워크플로 상태 아이콘 정본을 그대로 사용한다', () => {
    expect(TEAM_WORK_STATUS_PRESENTATION).toBe(WORKFLOW_STATE_PRESENTATION);
  });

  it('상태 변경 메뉴는 범주 라벨이 아니라 실제 워크플로 상태 이름을 표시하고 같은 범주 중복 이름을 만들지 않는다', async () => {
    const user = userEvent.setup();
    const states = [
      { category: 'BACKLOG' as const, color: null, id: 'state-backlog', name: '미분류', position: 0 },
      { category: 'UNSTARTED' as const, color: null, id: 'state-unstarted', name: '할 일', position: 1 },
      { category: 'STARTED' as const, color: 'INDIGO' as const, id: 'state-started', name: '진행 중', position: 2 },
      { category: 'STARTED' as const, color: 'TEAL' as const, id: 'state-review', name: '검토', position: 3 },
      { category: 'COMPLETED' as const, color: null, id: 'state-completed', name: '완료', position: 4 },
      { category: 'BACKLOG' as const, color: null, id: 'state-paused', name: '보류', position: 5 },
      { category: 'CANCELED' as const, color: null, id: 'state-canceled', name: '취소', position: 6 },
    ];
    render(
      <StatusTrigger
        identifier="API-1"
        onValueChange={vi.fn()}
        states={states}
        value="state-started"
      />,
    );

    const trigger = screen.getByRole('combobox', {
      name: '팀 작업 상태 변경 (API-1): 현재 진행 중',
    });
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute('data-popup-open'));

    for (const state of states) {
      expect(screen.getByRole('option', { name: state.name })).toBeVisible();
    }
    // "진행 중"과 "백로그" 범주 라벨이 두 상태(할 일→진행 중 범주, 검토→진행 중 범주 등)에 중복 표시되지 않는다.
    expect(screen.getAllByRole('option', { name: '진행 중' })).toHaveLength(1);
    expect(screen.queryAllByRole('option', { name: '백로그' })).toHaveLength(0);
    expect(screen.getByRole('option', { name: '보류' })).toBeVisible();
  });
});
