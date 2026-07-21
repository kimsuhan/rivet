import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamWorkSummaryResponseDto, WorkflowStateResponseDto } from '@rivet/api-client';

import { TeamWorkPrimaryAction } from './team-work-primary-action';

const STATES: WorkflowStateResponseDto[] = [
  {
    category: 'BACKLOG',
    color: null,
    disabledAt: null,
    id: 'state-backlog',
    isDefault: true,
    name: '미분류',
    position: 0,
    version: 1,
  },
  {
    category: 'UNSTARTED',
    color: null,
    disabledAt: null,
    id: 'state-unstarted',
    isDefault: false,
    name: '할 일',
    position: 1,
    version: 1,
  },
  {
    category: 'STARTED',
    color: null,
    disabledAt: null,
    id: 'state-started',
    isDefault: false,
    name: '진행 중',
    position: 2,
    version: 1,
  },
  {
    category: 'STARTED',
    color: null,
    disabledAt: null,
    id: 'state-review',
    isDefault: false,
    name: '검토',
    position: 3,
    version: 1,
  },
  {
    category: 'COMPLETED',
    color: null,
    disabledAt: null,
    id: 'state-completed',
    isDefault: false,
    name: '완료',
    position: 4,
    version: 1,
  },
];

function work(overrides: Partial<TeamWorkSummaryResponseDto> = {}): TeamWorkSummaryResponseDto {
  return {
    assignee: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    id: 'team-work-1',
    identifier: 'API-1',
    issue: {
      id: 'issue-1',
      identifier: 'F-1',
      labels: [],
      priority: 'NONE',
      project: {
        archived: false,
        id: 'project-1',
        logoFileId: null,
        name: '프로젝트',
        status: 'PLANNED',
      },
      status: 'TODO',
      title: '이슈 제목',
    },
    projectTeam: {
      active: true,
      id: 'project-team-1',
      team: { archived: false, id: 'team-1', key: 'PLAN', name: '기획' },
    },
    stateCategory: 'BACKLOG',
    stateProgress: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    version: 1,
    workNoteMarkdown: null,
    workflowState: STATES[0]!,
    ...overrides,
  };
}

describe('TeamWorkPrimaryAction', () => {
  afterEach(cleanup);

  it('실행 가능한 행동이 없는 BACKLOG 작업에는 대체 버튼을 표시하지 않는다', () => {
    render(
      <TeamWorkPrimaryAction
        onOpenCompletion={vi.fn()}
        onStart={vi.fn()}
        states={STATES}
        work={work()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('UNSTARTED에서 작업 시작을 누르면 해당 팀의 첫 STARTED 상태 id로 전이한다', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <TeamWorkPrimaryAction
        onOpenCompletion={vi.fn()}
        onStart={onStart}
        states={STATES}
        work={work({ stateCategory: 'UNSTARTED', workflowState: STATES[1]! })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'API-1: 작업 시작' }));
    expect(onStart).toHaveBeenCalledWith('state-started');
  });

  it('STARTED에서 완료를 누르면 완료 열기 콜백을 실행한다', async () => {
    const user = userEvent.setup();
    const onOpenCompletion = vi.fn();
    render(
      <TeamWorkPrimaryAction
        onOpenCompletion={onOpenCompletion}
        onStart={vi.fn()}
        states={STATES}
        work={work({ stateCategory: 'STARTED', workflowState: STATES[2]! })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'API-1: 완료' }));
    expect(onOpenCompletion).toHaveBeenCalledTimes(1);
  });

  it('COMPLETED에는 비활성 완료 버튼을 남기지 않는다', () => {
    render(
      <TeamWorkPrimaryAction
        onOpenCompletion={vi.fn()}
        onStart={vi.fn()}
        states={STATES}
        work={work({ stateCategory: 'COMPLETED', workflowState: STATES[4]! })}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('담당자가 지정된 BACKLOG(수동)이나 CANCELED에는 주요 행동을 표시하지 않는다', () => {
    const { rerender } = render(
      <TeamWorkPrimaryAction
        onOpenCompletion={vi.fn()}
        onStart={vi.fn()}
        states={STATES}
        work={work({
          assignee: {
            id: 'membership-1',
            role: 'MEMBER',
            status: 'ACTIVE',
            user: { avatarFileId: null, displayName: '담당자', id: 'user-1' },
          },
          stateCategory: 'BACKLOG',
          workflowState: { ...STATES[0]!, isDefault: false, name: '보류' },
        })}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <TeamWorkPrimaryAction
        onOpenCompletion={vi.fn()}
        onStart={vi.fn()}
        states={STATES}
        work={work({
          stateCategory: 'CANCELED',
          workflowState: { ...STATES[0]!, category: 'CANCELED', isDefault: false, name: '취소' },
        })}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
