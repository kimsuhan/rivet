import { describe, expect, it } from 'vitest';

import { createProjectPayload, projectFormDefaults, projectFormSchema } from './project-form';

const schema = projectFormSchema({
  dateOrder: 'date',
  descriptionTooLong: 'description',
  nameRequired: 'name-required',
  nameTooLong: 'name-long',
  roleRequired: 'role',
});

describe('project form', () => {
  it('최소 한 역할과 올바른 날짜 순서를 요구한다', () => {
    const result = schema.safeParse({
      ...projectFormDefaults(),
      name: '프로젝트',
      startDate: '2026-07-12',
      targetDate: '2026-07-11',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(['BACKEND', 'startDate', 'targetDate']),
      );
    }
  });

  it('같은 팀을 여러 역할에 유지하고 빈 선택은 null로 변환한다', () => {
    const values = {
      ...projectFormDefaults(),
      BACKEND: 'team-1',
      WEB_FRONTEND: 'team-1',
      name: '프로젝트',
      status: 'IN_PROGRESS' as const,
    };

    expect(createProjectPayload(values)).toMatchObject({
      description: null,
      leadMembershipId: null,
      status: 'IN_PROGRESS',
      roleTeams: [
        { role: 'BACKEND', teamId: 'team-1' },
        { role: 'WEB_FRONTEND', teamId: 'team-1' },
      ],
    });
  });
});
