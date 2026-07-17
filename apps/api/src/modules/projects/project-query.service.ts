import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { ProjectStatus } from '@rivet/database';

import type { ProjectListQueryDto } from './dto/project-request.dto';
import type { ProjectListResponseDto, ProjectResponseDto } from './dto/project-response.dto';
import { invalidProjectQuery } from './project.errors';
import { ProjectRepository } from './project.repository';
import {
  encodeProjectCursor,
  parseProjectCsvFilter,
  parseProjectCursor,
  type ProjectSortDirection,
  type ProjectSortField,
} from './project-list.cursor';
import { projectProgress, toProjectResponse } from './project-response.mapper';

@Injectable()
export class ProjectQueryService {
  constructor(private readonly projects: ProjectRepository) {}

  async list(workspaceId: string, dto: ProjectListQueryDto): Promise<ProjectListResponseDto> {
    const statuses = parseProjectCsvFilter(
      dto.status,
      (item) => Object.values(ProjectStatus).includes(item as ProjectStatus),
      '프로젝트 상태 필터를 확인해 주세요.',
    ) as ProjectStatus[] | undefined;
    const leadMembershipIds = parseProjectCsvFilter(
      dto.leadMembershipId,
      (item) => isUUID(item, '4'),
      '프로젝트 리드 필터를 확인해 주세요.',
    )?.map((item) => item.toLowerCase());
    const sort: ProjectSortField =
      dto.sort === undefined || dto.sort === 'updatedAt'
        ? 'updatedAt'
        : dto.sort === 'targetDate'
          ? 'targetDate'
          : invalidProjectQuery('정렬 기준을 확인해 주세요.');
    const direction: ProjectSortDirection =
      dto.sortDirection === undefined || dto.sortDirection === 'desc'
        ? 'desc'
        : dto.sortDirection === 'asc'
          ? 'asc'
          : invalidProjectQuery('정렬 방향을 확인해 주세요.');
    const cursor = parseProjectCursor(dto.cursor, sort, direction);
    const limit = dto.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      invalidProjectQuery('조회 개수를 확인해 주세요.');
    }

    const rows = await this.projects.findPage({
      ...(cursor ? { cursor } : {}),
      direction,
      includeArchived: dto.includeArchived,
      ...(leadMembershipIds ? { leadMembershipIds } : {}),
      limit,
      sort,
      ...(statuses ? { statuses } : {}),
      workspaceId,
    });
    const page = rows.slice(0, limit);
    const progressByProject = await this.projects.progressForRead(
      workspaceId,
      page.map(({ id }) => id),
    );
    const last = page.at(-1);

    return {
      items: page.map((row) =>
        toProjectResponse(row, progressByProject.get(row.id) ?? projectProgress(0, 0)),
      ),
      nextCursor: rows.length > limit && last ? encodeProjectCursor(last, sort, direction) : null,
    };
  }

  async get(workspaceId: string, projectId: string): Promise<ProjectResponseDto> {
    const row = await this.projects.findById(workspaceId, projectId);
    const progressByProject = await this.projects.progressForRead(workspaceId, [projectId]);
    return toProjectResponse(row, progressByProject.get(projectId) ?? projectProgress(0, 0));
  }
}
