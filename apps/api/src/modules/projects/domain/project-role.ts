import { HttpStatus } from '@nestjs/common';

import { ProjectRole } from '@rivet/database';

import { ApiError } from '../../../common/errors/api-error';
import type { ProjectRoleTeamInputDto } from '../dto/project-request.dto';
import { projectValidationError } from '../project.errors';

export type ProjectRoleTeam = {
  role: ProjectRole;
  teamId: string;
};

export const PROJECT_ROLE_POSITION: Record<ProjectRole, number> = {
  [ProjectRole.BACKEND]: 0,
  [ProjectRole.WEB_FRONTEND]: 1,
  [ProjectRole.APP_FRONTEND]: 2,
};

export function normalizeProjectRoleTeams(roleTeams: ProjectRoleTeamInputDto[]): ProjectRoleTeam[] {
  if (roleTeams.length < 1) {
    throw new ApiError({
      code: 'PROJECT_ROLE_REQUIRED',
      fieldErrors: { roleTeams: ['역할별 담당 팀을 하나 이상 선택해 주세요.'] },
      message: '프로젝트 역할별 담당 팀이 필요합니다.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }

  const roles = new Set<ProjectRole>();
  const normalized = roleTeams.map(({ role, teamId }) => {
    if (!Object.values(ProjectRole).includes(role) || roles.has(role)) {
      return projectValidationError('roleTeams', '같은 프로젝트 역할을 중복 선택할 수 없습니다.');
    }
    roles.add(role);
    return { role, teamId: teamId.toLowerCase() };
  });

  return normalized.sort(
    (left, right) => PROJECT_ROLE_POSITION[left.role] - PROJECT_ROLE_POSITION[right.role],
  );
}
