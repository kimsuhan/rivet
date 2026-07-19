import { Injectable } from '@nestjs/common';

import { ExportType, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';

const EXPORT_BATCH_SIZE = 100;

const ISSUE_EXPORT_HEADERS = [
  '표시 ID',
  '프로젝트',
  '제목',
  '설명 Markdown',
  '상태',
  '우선순위',
  '라벨',
  '팀 작업',
  '작업 전달',
  '첨부파일',
  '생성 시각',
  '수정 시각',
] as const;

const PROJECT_EXPORT_HEADERS = [
  '이름',
  '설명',
  '상태',
  '리드',
  '참여 팀',
  '시작일',
  '목표일',
  '생성 시각',
  '수정 시각',
] as const;

const ISSUE_EXPORT_SELECT = {
  createdAt: true,
  descriptionMarkdown: true,
  fileAttachments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      apiHandoffId: true,
      commentId: true,
      createdAt: true,
      file: {
        select: {
          detectedMimeType: true,
          id: true,
          originalName: true,
          sizeBytes: true,
        },
      },
      id: true,
      kind: true,
    },
  },
  handoffs: {
    orderBy: { sequenceNumber: 'asc' },
    select: {
      authorMembership: {
        select: {
          id: true,
          user: { select: { displayName: true } },
        },
      },
      bodyMarkdown: true,
      createdAt: true,
      id: true,
      kind: true,
      sourceTeamWorkId: true,
      targets: { orderBy: { teamWorkId: 'asc' }, select: { teamWorkId: true } },
      sequenceNumber: true,
    },
  },
  id: true,
  identifier: true,
  labels: {
    orderBy: { labelId: 'asc' },
    select: {
      label: { select: { archivedAt: true, color: true, id: true, name: true } },
    },
  },
  priority: true,
  project: { select: { archivedAt: true, id: true, name: true } },
  status: true,
  teamWorks: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      assigneeTeamMember: { select: { membership: { select: { id: true, user: { select: { displayName: true } } } } } },
      identifier: true,
      projectTeam: { select: { id: true, isActive: true } },
      workNoteMarkdown: true,
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
      workflowState: { select: { category: true, id: true, name: true } },
    },
    where: { deletedAt: null },
  },
  title: true,
  updatedAt: true,
} satisfies Prisma.IssueSelect;

const PROJECT_EXPORT_SELECT = {
  createdAt: true,
  description: true,
  id: true,
  leadMembership: {
    select: {
      id: true,
      user: { select: { displayName: true } },
    },
  },
  name: true,
  projectTeams: {
    orderBy: [{ isActive: 'desc' }, { team: { name: 'asc' } }, { id: 'asc' }],
    select: {
      id: true,
      isActive: true,
      team: { select: { archivedAt: true, id: true, key: true, name: true } },
    },
  },
  startDate: true,
  status: true,
  targetDate: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

type IssueExportRow = Prisma.IssueGetPayload<{ select: typeof ISSUE_EXPORT_SELECT }>;
type ProjectExportRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_EXPORT_SELECT }>;

export type ExportContext = {
  membershipId: string;
  workspaceId: string;
};

export type ExportFailureCode =
  | 'EXPORT_GENERATION_FAILED'
  | 'EXPORT_RESPONSE_CLOSED'
  | 'EXPORT_RESPONSE_ERROR'
  | 'EXPORT_STREAM_FAILED';

export type CsvExportRun = {
  auditId: string;
  header: string;
  rows: AsyncGenerator<string, void, void>;
};

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = /^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvRow(values: readonly (string | number | null)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

function jsonCell(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function issueCsvRow(issue: IssueExportRow): string {
  return csvRow([
    issue.identifier,
    jsonCell({ archived: issue.project.archivedAt !== null, id: issue.project.id, name: issue.project.name }),
    issue.title,
    issue.descriptionMarkdown,
    issue.status,
    issue.priority,
    jsonCell(
      issue.labels.map(({ label }) => ({
        archived: label.archivedAt !== null,
        color: label.color,
        id: label.id,
        name: label.name,
      })),
    ),
    jsonCell(issue.teamWorks.map((teamWork) => ({
      assignee: teamWork.assigneeTeamMember ? {
        displayName: teamWork.assigneeTeamMember.membership.user.displayName,
        membershipId: teamWork.assigneeTeamMember.membership.id,
      } : null,
      identifier: teamWork.identifier,
      projectTeam: teamWork.projectTeam
        ? { active: teamWork.projectTeam.isActive, id: teamWork.projectTeam.id }
        : null,
      workNoteMarkdown: teamWork.workNoteMarkdown,
      team: { archived: teamWork.team.archivedAt !== null, id: teamWork.team.id, key: teamWork.team.key, name: teamWork.team.name },
      workflowState: teamWork.workflowState,
    }))),
    jsonCell(
      issue.handoffs.map((handoff) => ({
        author: {
          displayName: handoff.authorMembership.user.displayName,
          membershipId: handoff.authorMembership.id,
        },
        bodyMarkdown: handoff.bodyMarkdown,
        createdAt: handoff.createdAt.toISOString(),
        id: handoff.id,
        kind: handoff.kind,
        sequenceNumber: handoff.sequenceNumber,
        sourceTeamWorkId: handoff.sourceTeamWorkId,
        targetTeamWorkIds: handoff.targets.map(({ teamWorkId }) => teamWorkId),
      })),
    ),
    jsonCell(
      issue.fileAttachments.map((attachment) => ({
        apiHandoffId: attachment.apiHandoffId,
        attachmentId: attachment.id,
        commentId: attachment.commentId,
        contentPath: `/api/v1/files/${attachment.file.id}/content`,
        createdAt: attachment.createdAt.toISOString(),
        fileId: attachment.file.id,
        kind: attachment.kind,
        mimeType: attachment.file.detectedMimeType,
        originalName: attachment.file.originalName,
        sizeBytes: attachment.file.sizeBytes.toString(),
      })),
    ),
    issue.createdAt.toISOString(),
    issue.updatedAt.toISOString(),
  ]);
}

function projectCsvRow(project: ProjectExportRow): string {
  return csvRow([
    project.name,
    project.description,
    project.status,
    project.leadMembership
      ? jsonCell({
          displayName: project.leadMembership.user.displayName,
          membershipId: project.leadMembership.id,
        })
      : null,
    jsonCell(
      project.projectTeams.map(({ id, isActive, team }) => ({
        active: isActive,
        id,
        team: {
          archived: team.archivedAt !== null,
          id: team.id,
          key: team.key,
          name: team.name,
        },
      })),
    ),
    dateOnly(project.startDate),
    dateOnly(project.targetDate),
    project.createdAt.toISOString(),
    project.updatedAt.toISOString(),
  ]);
}

function auditStateConflict(): never {
  throw new Error('EXPORT_AUDIT_STATE_CONFLICT');
}

@Injectable()
export class ExportsService {
  constructor(private readonly database: DatabaseService) {}

  async beginIssues(context: ExportContext): Promise<CsvExportRun> {
    const auditId = await this.createAudit(context, ExportType.ISSUES);

    try {
      const firstBatch = await this.issueBatch(context.workspaceId, null);
      return {
        auditId,
        header: csvRow(ISSUE_EXPORT_HEADERS),
        rows: this.issueRows(context.workspaceId, firstBatch),
      };
    } catch (error) {
      return this.failStartedExport(context, auditId, error);
    }
  }

  async beginProjects(context: ExportContext): Promise<CsvExportRun> {
    const auditId = await this.createAudit(context, ExportType.PROJECTS);

    try {
      const firstBatch = await this.projectBatch(context.workspaceId, null);
      return {
        auditId,
        header: csvRow(PROJECT_EXPORT_HEADERS),
        rows: this.projectRows(context.workspaceId, firstBatch),
      };
    } catch (error) {
      return this.failStartedExport(context, auditId, error);
    }
  }

  async markCompleted(context: ExportContext, auditId: string, itemCount: number): Promise<void> {
    const result = await this.database.client.exportAudit.updateMany({
      data: { completedAt: new Date(), itemCount },
      where: {
        completedAt: null,
        downloadedAt: null,
        failedAt: null,
        id: auditId,
        requestedByMembershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
    if (result.count !== 1) auditStateConflict();
  }

  async markDownloaded(context: ExportContext, auditId: string): Promise<void> {
    const result = await this.database.client.exportAudit.updateMany({
      data: { downloadedAt: new Date() },
      where: {
        completedAt: { not: null },
        downloadedAt: null,
        failedAt: null,
        id: auditId,
        requestedByMembershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
    if (result.count !== 1) auditStateConflict();
  }

  async markFailed(
    context: ExportContext,
    auditId: string,
    lastErrorCode: ExportFailureCode,
  ): Promise<void> {
    const result = await this.database.client.exportAudit.updateMany({
      data: { failedAt: new Date(), lastErrorCode },
      where: {
        downloadedAt: null,
        failedAt: null,
        id: auditId,
        requestedByMembershipId: context.membershipId,
        workspaceId: context.workspaceId,
      },
    });
    if (result.count !== 1) auditStateConflict();
  }

  private async createAudit(context: ExportContext, type: ExportType): Promise<string> {
    const audit = await this.database.client.exportAudit.create({
      data: {
        requestedByMembershipId: context.membershipId,
        type,
        workspaceId: context.workspaceId,
      },
      select: { id: true },
    });
    return audit.id;
  }

  private async failStartedExport(
    context: ExportContext,
    auditId: string,
    error: unknown,
  ): Promise<never> {
    try {
      await this.markFailed(context, auditId, 'EXPORT_GENERATION_FAILED');
    } catch (auditError) {
      throw new AggregateError([error, auditError], 'EXPORT_INITIALIZATION_FAILED', {
        cause: auditError,
      });
    }
    throw error;
  }

  private issueBatch(workspaceId: string, cursorId: string | null): Promise<IssueExportRow[]> {
    return this.database.client.issue.findMany({
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: ISSUE_EXPORT_SELECT,
      take: EXPORT_BATCH_SIZE,
      where: { deletedAt: null, workspaceId },
    });
  }

  private async *issueRows(
    workspaceId: string,
    firstBatch: IssueExportRow[],
  ): AsyncGenerator<string, void, void> {
    let batch = firstBatch;

    try {
      while (batch.length > 0) {
        for (const issue of batch) yield issueCsvRow(issue);
        if (batch.length < EXPORT_BATCH_SIZE) return;

        const last = batch[batch.length - 1];
        if (!last) return;
        batch = await this.issueBatch(workspaceId, last.id);
      }
    } catch (error) {
      throw new Error('EXPORT_GENERATION_FAILED', { cause: error });
    }
  }

  private projectBatch(workspaceId: string, cursorId: string | null): Promise<ProjectExportRow[]> {
    return this.database.client.project.findMany({
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: PROJECT_EXPORT_SELECT,
      take: EXPORT_BATCH_SIZE,
      where: { deletedAt: null, workspaceId },
    });
  }

  private async *projectRows(
    workspaceId: string,
    firstBatch: ProjectExportRow[],
  ): AsyncGenerator<string, void, void> {
    let batch = firstBatch;

    try {
      while (batch.length > 0) {
        for (const project of batch) yield projectCsvRow(project);
        if (batch.length < EXPORT_BATCH_SIZE) return;

        const last = batch[batch.length - 1];
        if (!last) return;
        batch = await this.projectBatch(workspaceId, last.id);
      }
    } catch (error) {
      throw new Error('EXPORT_GENERATION_FAILED', { cause: error });
    }
  }
}
