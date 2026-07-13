import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleDotDashed,
  CirclePause,
  CircleX,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from 'lucide-react';
import { describe, expect, it } from 'vitest';

import {
  FEATURE_STATUS_PRESENTATION,
  ISSUE_PRIORITY_PRESENTATION,
  WORKFLOW_STATE_PRESENTATION,
} from './issue-attribute-presentation';

describe('issue attribute presentation', () => {
  it('기능 상태의 확정 아이콘과 의미 색을 한 순서로 제공한다', () => {
    expect(Object.keys(FEATURE_STATUS_PRESENTATION)).toEqual([
      'UNSORTED',
      'TODO',
      'IN_PROGRESS',
      'REVIEW',
      'DONE',
      'PAUSED',
      'CANCELED',
    ]);
    expect(Object.values(FEATURE_STATUS_PRESENTATION).map(({ icon }) => icon)).toEqual([
      CircleDashed,
      Circle,
      CircleDotDashed,
      CircleDot,
      CircleCheck,
      CirclePause,
      CircleX,
    ]);
    expect(
      Object.values(FEATURE_STATUS_PRESENTATION).map(({ iconClassName }) => iconClassName),
    ).toEqual([
      'text-muted-foreground',
      'text-foreground',
      'text-info',
      'text-info',
      'text-success',
      'text-warning',
      'text-muted-foreground',
    ]);
  });

  it('우선순위의 확정 아이콘을 없음부터 긴급까지 제공한다', () => {
    expect(Object.keys(ISSUE_PRIORITY_PRESENTATION)).toEqual([
      'NONE',
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
    ]);
    expect(Object.values(ISSUE_PRIORITY_PRESENTATION).map(({ icon }) => icon)).toEqual([
      Minus,
      SignalLow,
      SignalMedium,
      SignalHigh,
      CircleAlert,
    ]);
    expect(
      Object.values(ISSUE_PRIORITY_PRESENTATION).map(({ iconClassName }) => iconClassName),
    ).toEqual([
      'text-muted-foreground',
      'text-muted-foreground',
      'text-muted-foreground',
      'text-warning',
      'text-destructive',
    ]);
  });

  it('사용자 정의 팀 상태 이름은 유지하고 category 아이콘만 공통화할 수 있게 한다', () => {
    expect(WORKFLOW_STATE_PRESENTATION).toEqual({
      BACKLOG: { icon: CircleDashed, iconClassName: 'text-muted-foreground' },
      CANCELED: { icon: CircleX, iconClassName: 'text-muted-foreground' },
      COMPLETED: { icon: CircleCheck, iconClassName: 'text-success' },
      STARTED: { icon: CircleDotDashed, iconClassName: 'text-info' },
      UNSTARTED: { icon: Circle, iconClassName: 'text-foreground' },
    });
  });
});
