import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { IssueFileKind, Prisma, StateCategory } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { issueResourceNotFound } from './issue.errors';

const MEMBER_SELECT = {
  id: true,
  role: true,
  status: true,
  user: { select: { avatarFileId: true, displayName: true, id: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const TEAM_WORK_SELECT = {
  assigneeTeamMember: { select: { membership: { select: MEMBER_SELECT } } },
  createdAt: true,
  id: true,
  identifier: true,
  issue: {
    select: {
      id: true,
      identifier: true,
      labels: {
        orderBy: { labelId: 'asc' },
        select: { label: { select: { archivedAt: true, color: true, id: true, name: true } } },
      },
      priority: true,
      project: { select: { archivedAt: true, id: true, name: true, status: true } },
      status: true,
      teamWorks: {
        select: { projectTeamId: true },
        where: { deletedAt: null },
      },
      title: true,
    },
  },
  projectTeam: {
    select: {
      id: true,
      isActive: true,
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
    },
  },
  workNoteMarkdown: true,
  team: {
    select: {
      archivedAt: true,
      id: true,
      key: true,
      name: true,
      workflowStates: {
        orderBy: { position: 'asc' },
        select: { category: true, id: true, position: true },
      },
    },
  },
  updatedAt: true,
  version: true,
  workflowState: {
    select: {
      category: true,
      color: true,
      id: true,
      isDefault: true,
      name: true,
      position: true,
      version: true,
    },
  },
} satisfies Prisma.TeamWorkSelect;

const ISSUE_SELECT = {
  createdAt: true,
  createdByMembership: { select: MEMBER_SELECT },
  descriptionMarkdown: true,
  fileAttachments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      createdAt: true,
      createdByMembership: {
        select: { user: { select: { avatarFileId: true, displayName: true, id: true } } },
      },
      file: {
        select: {
          createdAt: true,
          detectedMimeType: true,
          id: true,
          originalName: true,
          sizeBytes: true,
        },
      },
      id: true,
      kind: true,
    },
    where: { kind: IssueFileKind.ISSUE_ATTACHMENT },
  },
  handoffs: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      authorMembership: { select: MEMBER_SELECT },
      bodyMarkdown: true,
      createdAt: true,
      id: true,
      kind: true,
      sequenceNumber: true,
      sourceTeamWork: {
        select: {
          id: true,
          identifier: true,
          projectTeam: {
            select: {
              id: true,
              isActive: true,
              team: { select: { archivedAt: true, id: true, key: true, name: true } },
            },
          },
          workflowState: {
            select: {
              category: true,
              color: true,
              id: true,
              isDefault: true,
              name: true,
              position: true,
              version: true,
            },
          },
        },
      },
      targets: {
        orderBy: { teamWorkId: 'asc' },
        select: {
          teamWork: {
            select: {
              id: true,
              identifier: true,
              projectTeam: {
                select: {
                  id: true,
                  isActive: true,
                  team: { select: { archivedAt: true, id: true, key: true, name: true } },
                },
              },
              workflowState: {
                select: {
                  category: true,
                  color: true,
                  id: true,
                  isDefault: true,
                  name: true,
                  position: true,
                  version: true,
                },
              },
            },
          },
        },
      },
    },
  },
  id: true,
  identifier: true,
  labels: {
    orderBy: { labelId: 'asc' },
    select: { label: { select: { archivedAt: true, color: true, id: true, name: true } } },
  },
  priority: true,
  project: { select: { archivedAt: true, id: true, name: true, status: true } },
  status: true,
  teamWorks: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: TEAM_WORK_SELECT,
    where: { deletedAt: null },
  },
  title: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.IssueSelect;

const TEAM_WORK_ORDER_SELECT = {
  createdAt: true,
  id: true,
  issue: { select: { priority: true } },
  updatedAt: true,
  workflowState: { select: { category: true, position: true } },
} satisfies Prisma.TeamWorkSelect;

export type IssueRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_SELECT }>;
export type TeamWorkRow = Prisma.TeamWorkGetPayload<{ select: typeof TEAM_WORK_SELECT }>;
export type TeamWorkOrderRow = Prisma.TeamWorkGetPayload<{
  select: typeof TEAM_WORK_ORDER_SELECT;
}>;

@Injectable()
export class IssueRepository {
  constructor(private readonly database: DatabaseService) {}

  listTeamWorkOrderRows(where: Prisma.TeamWorkWhereInput): Promise<TeamWorkOrderRow[]> {
    return this.database.client.teamWork.findMany({ select: TEAM_WORK_ORDER_SELECT, where });
  }

  countTeamWorks(where: Prisma.TeamWorkWhereInput): Promise<number> {
    return this.database.client.teamWork.count({ where });
  }

  async findIssue(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    issueId: string,
  ): Promise<IssueRow> {
    const row = await transaction.issue.findFirst({
      select: ISSUE_SELECT,
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!row) issueResourceNotFound();
    return row;
  }

  async findIssues(workspaceId: string, issueIds: string[]): Promise<IssueRow[]> {
    if (issueIds.length === 0) return [];
    return this.database.client.issue.findMany({
      select: ISSUE_SELECT,
      where: { deletedAt: null, id: { in: issueIds }, workspaceId },
    });
  }

  async findIssueById(workspaceId: string, issueId: string): Promise<IssueRow> {
    const row = await this.database.client.issue.findFirst({
      select: ISSUE_SELECT,
      where: { deletedAt: null, id: issueId, workspaceId },
    });
    if (!row) issueResourceNotFound();
    return row;
  }

  async findIssueByRef(workspaceId: string, issueRef: string): Promise<IssueRow> {
    const row = await this.database.client.issue.findFirst({
      select: ISSUE_SELECT,
      where: {
        deletedAt: null,
        workspaceId,
        ...(isUUID(issueRef, '4') ? { id: issueRef } : { identifier: issueRef.toUpperCase() }),
      },
    });
    if (!row) issueResourceNotFound();
    return row;
  }

  async findTeamWork(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    teamWorkId: string,
  ): Promise<TeamWorkRow> {
    const row = await transaction.teamWork.findFirst({
      select: TEAM_WORK_SELECT,
      where: { deletedAt: null, id: teamWorkId, workspaceId },
    });
    if (!row) issueResourceNotFound('팀 작업을 찾을 수 없습니다.');
    return row;
  }

  async findTeamWorks(workspaceId: string, teamWorkIds: string[]): Promise<TeamWorkRow[]> {
    if (teamWorkIds.length === 0) return [];
    return this.database.client.teamWork.findMany({
      select: TEAM_WORK_SELECT,
      where: { deletedAt: null, id: { in: teamWorkIds }, workspaceId },
    });
  }

  async findTeamWorkByRef(workspaceId: string, teamWorkRef: string): Promise<TeamWorkRow> {
    const row = await this.database.client.teamWork.findFirst({
      select: TEAM_WORK_SELECT,
      where: {
        deletedAt: null,
        workspaceId,
        ...(isUUID(teamWorkRef, '4')
          ? { id: teamWorkRef }
          : { identifier: teamWorkRef.toUpperCase() }),
      },
    });
    if (!row) issueResourceNotFound('팀 작업을 찾을 수 없습니다.');
    return row;
  }

  findClaimCandidates(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    issueId: string,
    projectTeamId: string,
    teamWorkId?: string | null,
  ): Promise<TeamWorkRow[]> {
    return transaction.teamWork.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: TEAM_WORK_SELECT,
      where: {
        assigneeMembershipId: null,
        deletedAt: null,
        issueId,
        projectTeamId,
        workspaceId,
        ...(teamWorkId ? { id: teamWorkId } : {}),
      },
    });
  }

  async firstUnstartedStateId(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    teamId: string,
  ): Promise<string> {
    const state = await transaction.workflowState.findFirst({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
      where: { category: StateCategory.UNSTARTED, teamId, workspaceId },
    });
    if (!state) issueResourceNotFound('팀의 시작 전 상태를 찾을 수 없습니다.');
    return state.id;
  }
}
