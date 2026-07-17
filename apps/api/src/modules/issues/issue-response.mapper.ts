import { ProjectRole, StateCategory } from '@rivet/database';

import { isInlineDisplayable } from '../files/file-content.policy';
import type {
  IssueDetailResponseDto,
  IssueMemberSummaryResponseDto,
  IssueSummaryResponseDto,
  IssueWorkflowSummaryResponseDto,
  TeamWorkDetailResponseDto,
  TeamWorkSummaryResponseDto,
} from './dto/issue-response.dto';
import type { IssueRow, TeamWorkRow } from './issue.repository';

function memberResponse(member: IssueRow['createdByMembership']): IssueMemberSummaryResponseDto {
  return { id: member.id, role: member.role, status: member.status, user: member.user };
}

function teamResponse(team: { archivedAt: Date | null; id: string; key: string; name: string }) {
  return { archived: team.archivedAt !== null, id: team.id, key: team.key, name: team.name };
}

function workflowStateResponse(state: TeamWorkRow['workflowState']) {
  return { ...state };
}

function teamWorkReference(teamWork: {
  id: string;
  identifier: string;
  projectRole: ProjectRole;
  team: { archivedAt: Date | null; id: string; key: string; name: string };
  workflowState: TeamWorkRow['workflowState'];
}) {
  return {
    id: teamWork.id,
    identifier: teamWork.identifier,
    projectRole: teamWork.projectRole,
    team: teamResponse(teamWork.team),
    workflowState: workflowStateResponse(teamWork.workflowState),
  };
}

export function toTeamWorkSummary(row: TeamWorkRow): TeamWorkSummaryResponseDto {
  return {
    assignee: row.assigneeTeamMember ? memberResponse(row.assigneeTeamMember.membership) : null,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    identifier: row.identifier,
    issue: {
      id: row.issue.id,
      identifier: row.issue.identifier,
      labels: row.issue.labels.map(({ label }) => ({
        archived: label.archivedAt !== null,
        color: label.color,
        id: label.id,
        name: label.name,
      })),
      priority: row.issue.priority,
      project: {
        archived: row.issue.project.archivedAt !== null,
        id: row.issue.project.id,
        name: row.issue.project.name,
        status: row.issue.project.status,
      },
      status: row.issue.status,
      title: row.issue.title,
    },
    projectRole: row.projectRole,
    workNoteMarkdown: row.workNoteMarkdown,
    stateCategory: row.workflowState.category,
    team: teamResponse(row.team),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    workflowState: workflowStateResponse(row.workflowState),
  };
}

export function toTeamWorkDetail(row: TeamWorkRow): TeamWorkDetailResponseDto {
  return toTeamWorkSummary(row);
}

export function toIssueWorkflowSummary(teamWorks: TeamWorkRow[]): IssueWorkflowSummaryResponseDto {
  const completedCount = teamWorks.filter(
    ({ workflowState }) => workflowState.category === StateCategory.COMPLETED,
  ).length;
  const canceledCount = teamWorks.filter(
    ({ workflowState }) => workflowState.category === StateCategory.CANCELED,
  ).length;
  const validCount = teamWorks.length - canceledCount;
  return {
    activeRoles: [
      ...new Set(
        teamWorks
          .filter(
            ({ workflowState }) =>
              workflowState.category !== StateCategory.COMPLETED &&
              workflowState.category !== StateCategory.CANCELED,
          )
          .map(({ projectRole }) => projectRole),
      ),
    ].sort(),
    allTeamWorksCompleted: validCount > 0 && completedCount === validCount,
    canceledCount,
    completedCount,
    teamWorkCount: teamWorks.length,
    unassignedCount: teamWorks.filter(
      ({ assigneeTeamMember, workflowState }) =>
        assigneeTeamMember === null &&
        workflowState.category !== StateCategory.COMPLETED &&
        workflowState.category !== StateCategory.CANCELED,
    ).length,
  };
}

export function toIssueSummary(row: IssueRow): IssueSummaryResponseDto {
  const completed = row.teamWorks.filter(
    ({ workflowState }) => workflowState.category === StateCategory.COMPLETED,
  ).length;
  const valid = row.teamWorks.filter(
    ({ workflowState }) => workflowState.category !== StateCategory.CANCELED,
  ).length;
  return {
    createdAt: row.createdAt.toISOString(),
    createdBy: memberResponse(row.createdByMembership),
    id: row.id,
    identifier: row.identifier,
    labels: row.labels.map(({ label }) => ({
      archived: label.archivedAt !== null,
      color: label.color,
      id: label.id,
      name: label.name,
    })),
    priority: row.priority,
    progress: {
      completed,
      percentage: valid === 0 ? 0 : Math.round((completed / valid) * 100),
      total: valid,
    },
    project: {
      archived: row.project.archivedAt !== null,
      id: row.project.id,
      name: row.project.name,
      status: row.project.status,
    },
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    workflowSummary: toIssueWorkflowSummary(row.teamWorks),
  };
}

export function toIssueDetail(row: IssueRow): IssueDetailResponseDto {
  return {
    ...toIssueSummary(row),
    attachments: row.fileAttachments.map((attachment) => ({
      createdAt: attachment.createdAt.toISOString(),
      file: {
        createdAt: attachment.file.createdAt.toISOString(),
        detectedMimeType: attachment.file.detectedMimeType,
        id: attachment.file.id,
        inlineDisplayable: isInlineDisplayable(attachment.file.detectedMimeType),
        linked: true,
        originalName: attachment.file.originalName,
        scope: 'WORKSPACE',
        sizeBytes: Number(attachment.file.sizeBytes),
      },
      id: attachment.id,
      kind: 'ISSUE_ATTACHMENT',
      uploader: attachment.createdByMembership.user,
    })),
    descriptionMarkdown: row.descriptionMarkdown,
    handoffFlows: row.handoffs.map((handoff) => ({
      author: memberResponse(handoff.authorMembership),
      bodyMarkdown: handoff.bodyMarkdown,
      createdAt: handoff.createdAt.toISOString(),
      id: handoff.id,
      kind: handoff.kind,
      sequenceNumber: handoff.sequenceNumber,
      sourceTeamWork: teamWorkReference(handoff.sourceTeamWork),
      targets: handoff.targets.map(({ teamWork }) => ({ teamWork: teamWorkReference(teamWork) })),
    })),
    teamWorks: row.teamWorks.map(toTeamWorkSummary),
  };
}
