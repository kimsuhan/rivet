import { describe, expect, it } from 'vitest';

import { createProjectPayload, projectFormDefaults, projectFormSchema } from './project-form';

const schema = projectFormSchema({
  dateOrder: 'date',
  descriptionTooLong: 'description',
  nameRequired: 'name-required',
  nameTooLong: 'name-long',
});

describe('project form', () => {
  it('참여 팀이 없어도 허용하고 올바른 날짜 순서를 요구한다', () => {
    const result = schema.safeParse({
      ...projectFormDefaults(),
      name: '프로젝트',
      startDate: '2026-07-12',
      targetDate: '2026-07-11',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(['startDate', 'targetDate']),
      );
    }
  });

  it('실제 참여 팀 식별자를 유지하고 빈 선택은 null로 변환한다', () => {
    const values = {
      ...projectFormDefaults(),
      name: '프로젝트',
      status: 'IN_PROGRESS' as const,
      teamIds: ['7c43f14c-6069-4d97-96a0-adc392914fe5'],
    };

    expect(createProjectPayload(values)).toMatchObject({
      description: null,
      leadMembershipId: null,
      status: 'IN_PROGRESS',
      teamIds: ['7c43f14c-6069-4d97-96a0-adc392914fe5'],
    });
  });
});
