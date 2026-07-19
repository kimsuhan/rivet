import { projectValidationError } from '../project.errors';

export function normalizeProjectTeamIds(teamIds: string[] | undefined): string[] {
  if (!teamIds) return [];
  const normalized = teamIds.map((teamId) => teamId.toLowerCase()).sort();
  if (new Set(normalized).size !== normalized.length) {
    return projectValidationError('teamIds', '같은 팀을 프로젝트에 중복 추가할 수 없습니다.');
  }
  return normalized;
}
