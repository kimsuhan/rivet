import { StateCategory } from '@rivet/database';

import { shouldAutoStartOnAssignment } from './team-work-transition';

describe('shouldAutoStartOnAssignment', () => {
  it('기본 BACKLOG 상태에는 자동 시작을 허용한다', () => {
    expect(shouldAutoStartOnAssignment({ category: StateCategory.BACKLOG, isDefault: true })).toBe(
      true,
    );
  });

  it('수동 BACKLOG(보류 등) 상태에는 자동 시작을 허용하지 않는다', () => {
    expect(shouldAutoStartOnAssignment({ category: StateCategory.BACKLOG, isDefault: false })).toBe(
      false,
    );
  });

  it('BACKLOG가 아닌 범주에는 기본값이어도 자동 시작을 허용하지 않는다', () => {
    expect(
      shouldAutoStartOnAssignment({ category: StateCategory.UNSTARTED, isDefault: true }),
    ).toBe(false);
    expect(shouldAutoStartOnAssignment({ category: StateCategory.STARTED, isDefault: false })).toBe(
      false,
    );
  });
});
