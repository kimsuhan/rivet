import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORKFLOW_STATE_PRESENTATION } from '@/components/workflow-state-icon';

import {
  CompactAssigneeTrigger,
  IssueStatusDisplay,
  PriorityDisplay,
  PriorityTrigger,
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

  it('진행 중과 배포 대기는 워크플로 파이 아이콘의 단계로 구분한다', () => {
    const { rerender } = render(<IssueStatusDisplay status="IN_PROGRESS" />);

    expect(document.querySelector('[data-workflow-state-category="STARTED"]')).toHaveAttribute(
      'data-workflow-state-progress',
      String(1 / 3),
    );

    rerender(<IssueStatusDisplay status="REVIEW" />);

    expect(screen.getByText('배포 대기')).toBeVisible();
    expect(document.querySelector('[data-workflow-state-category="STARTED"]')).toHaveAttribute(
      'data-workflow-state-progress',
      String(2 / 3),
    );
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

  it('아이콘 전용 우선순위 선택은 텍스트와 화살표를 시각적으로 숨기고 접근성 이름을 유지한다', () => {
    render(
      <PriorityTrigger iconOnly identifier="API-1" onValueChange={vi.fn()} priority="MEDIUM" />,
    );

    const trigger = screen.getByRole('combobox', { name: 'API-1 우선순위: 보통' });
    expect(trigger).toHaveClass('w-7', '[&>svg:last-child]:hidden');
    expect(trigger.querySelector('[data-slot="inline-select-label"]')).toHaveClass('sr-only');
    expect(trigger.querySelector('.lucide-signal-medium')).not.toBeNull();
  });

  it('아이콘 전용 우선순위 표시는 이름을 보조 기술에 남긴다', () => {
    render(<PriorityDisplay iconOnly priority="MEDIUM" />);

    expect(screen.getByText('보통')).toHaveClass('sr-only');
    expect(document.querySelector('.lucide-signal-medium')).not.toBeNull();
  });

  it('담당자 선택값과 메뉴에 프로필 사진을 표시한다', async () => {
    const user = userEvent.setup();
    render(
      <CompactAssigneeTrigger
        assignee={{
          id: 'member-1',
          role: 'MEMBER',
          status: 'ACTIVE',
          user: { avatarFileId: 'avatar-1', displayName: '김리벳', id: 'user-1' },
        }}
        identifier="API-1"
        members={[
          {
            id: 'member-1',
            role: 'MEMBER',
            status: 'ACTIVE',
            user: { avatarFileId: 'avatar-1', displayName: '김리벳', id: 'user-1' },
          },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', {
      name: '팀 작업 담당자 (API-1): 김리벳',
    });
    expect(trigger.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1);
    expect(screen.getByLabelText('김리벳')).toBeVisible();

    await user.click(trigger);
    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
  });

  it('상태 변경 메뉴는 범주 라벨이 아니라 실제 워크플로 상태 이름을 표시하고 같은 범주 중복 이름을 만들지 않는다', async () => {
    const user = userEvent.setup();
    const states = [
      {
        category: 'BACKLOG' as const,
        color: null,
        id: 'state-backlog',
        name: '미분류',
        position: 0,
      },
      {
        category: 'UNSTARTED' as const,
        color: null,
        id: 'state-unstarted',
        name: '할 일',
        position: 1,
      },
      {
        category: 'STARTED' as const,
        color: 'INDIGO' as const,
        id: 'state-started',
        name: '진행 중',
        position: 2,
      },
      {
        category: 'STARTED' as const,
        color: 'TEAL' as const,
        id: 'state-review',
        name: '검토',
        position: 3,
      },
      {
        category: 'COMPLETED' as const,
        color: null,
        id: 'state-completed',
        name: '완료',
        position: 4,
      },
      { category: 'BACKLOG' as const, color: null, id: 'state-paused', name: '보류', position: 5 },
      {
        category: 'CANCELED' as const,
        color: null,
        id: 'state-canceled',
        name: '취소',
        position: 6,
      },
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
