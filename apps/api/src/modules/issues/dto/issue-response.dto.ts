import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  HandoffKind,
  IssuePriority,
  IssueStatus,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';

export class IssueUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) avatarFileId!: string | null;
}

export class IssueMemberSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: IssueUserSummaryResponseDto }) user!: IssueUserSummaryResponseDto;
  @ApiProperty({ enum: MembershipRole }) role!: MembershipRole;
  @ApiProperty({ enum: MembershipStatus }) status!: MembershipStatus;
}

export class IssueTeamSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() key!: string;
  @ApiProperty() archived!: boolean;
}

export class IssueWorkflowStateSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: StateCategory }) category!: StateCategory;
  @ApiProperty({ minimum: 0 }) position!: number;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty({ minimum: 1 }) version!: number;
}

export class IssueProjectSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ProjectStatus }) status!: ProjectStatus;
  @ApiProperty() archived!: boolean;
}

export class IssueProgressResponseDto {
  @ApiProperty({ minimum: 0 }) completed!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ maximum: 100, minimum: 0 }) percentage!: number;
}

export class IssueLabelSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ pattern: '^#[0-9A-F]{6}$' }) color!: string;
  @ApiProperty() archived!: boolean;
}

export class IssueAttachmentFileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['WORKSPACE'] }) scope!: 'WORKSPACE';
  @ApiProperty() originalName!: string;
  @ApiProperty() detectedMimeType!: string;
  @ApiProperty({ maximum: 26_214_400, minimum: 1 }) sizeBytes!: number;
  @ApiProperty() inlineDisplayable!: boolean;
  @ApiProperty() linked!: true;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class IssueDetailAttachmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['ISSUE_ATTACHMENT'] }) kind!: 'ISSUE_ATTACHMENT';
  @ApiProperty({ type: IssueAttachmentFileResponseDto }) file!: IssueAttachmentFileResponseDto;
  @ApiProperty({ type: IssueUserSummaryResponseDto }) uploader!: IssueUserSummaryResponseDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class TeamWorkIssueSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() identifier!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: IssueStatus }) status!: IssueStatus;
  @ApiProperty({ enum: IssuePriority }) priority!: IssuePriority;
  @ApiProperty({ type: IssueProjectSummaryResponseDto }) project!: IssueProjectSummaryResponseDto;
  @ApiProperty({ isArray: true, type: IssueLabelSummaryResponseDto })
  labels!: IssueLabelSummaryResponseDto[];
}

export class TeamWorkReferenceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() identifier!: string;
  @ApiProperty({ enum: ProjectRole }) projectRole!: ProjectRole;
  @ApiProperty({ type: IssueTeamSummaryResponseDto }) team!: IssueTeamSummaryResponseDto;
  @ApiProperty({ type: IssueWorkflowStateSummaryResponseDto })
  workflowState!: IssueWorkflowStateSummaryResponseDto;
}

export class TeamWorkSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'API-42-2' }) identifier!: string;
  @ApiProperty({ type: TeamWorkIssueSummaryResponseDto }) issue!: TeamWorkIssueSummaryResponseDto;
  @ApiProperty({ enum: ProjectRole }) projectRole!: ProjectRole;
  @ApiProperty({ type: IssueTeamSummaryResponseDto }) team!: IssueTeamSummaryResponseDto;
  @ApiProperty({ type: IssueWorkflowStateSummaryResponseDto })
  workflowState!: IssueWorkflowStateSummaryResponseDto;
  @ApiProperty({ enum: StateCategory }) stateCategory!: StateCategory;
  @ApiProperty({ nullable: true, type: IssueMemberSummaryResponseDto })
  assignee!: IssueMemberSummaryResponseDto | null;
  @ApiProperty({ maxLength: 10000, nullable: true, type: String }) workNoteMarkdown!: string | null;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class TeamWorkDetailResponseDto extends TeamWorkSummaryResponseDto {}

export class IssueWorkflowSummaryResponseDto {
  @ApiProperty({ minimum: 0 }) teamWorkCount!: number;
  @ApiProperty({ minimum: 0 }) completedCount!: number;
  @ApiProperty({ minimum: 0 }) canceledCount!: number;
  @ApiProperty({ minimum: 0 }) unassignedCount!: number;
  @ApiProperty({ enum: ProjectRole, isArray: true }) activeRoles!: ProjectRole[];
  @ApiProperty() allTeamWorksCompleted!: boolean;
}

export class IssueSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'ISSUE-42' }) identifier!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: IssueStatus }) status!: IssueStatus;
  @ApiProperty({ enum: IssuePriority }) priority!: IssuePriority;
  @ApiProperty({ type: IssueProjectSummaryResponseDto }) project!: IssueProjectSummaryResponseDto;
  @ApiProperty({ isArray: true, type: IssueLabelSummaryResponseDto })
  labels!: IssueLabelSummaryResponseDto[];
  @ApiProperty({ type: IssueProgressResponseDto }) progress!: IssueProgressResponseDto;
  @ApiProperty({ type: IssueMemberSummaryResponseDto }) createdBy!: IssueMemberSummaryResponseDto;
  @ApiProperty({ type: IssueWorkflowSummaryResponseDto })
  workflowSummary!: IssueWorkflowSummaryResponseDto;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class IssueHandoffTargetResponseDto {
  @ApiProperty({ type: TeamWorkReferenceResponseDto }) teamWork!: TeamWorkReferenceResponseDto;
}

export class IssueHandoffFlowHandoffResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: HandoffKind }) kind!: HandoffKind;
  @ApiProperty({ minimum: 1 }) sequenceNumber!: number;
  @ApiProperty() bodyMarkdown!: string;
  @ApiProperty({ type: IssueMemberSummaryResponseDto }) author!: IssueMemberSummaryResponseDto;
  @ApiProperty({ type: TeamWorkReferenceResponseDto })
  sourceTeamWork!: TeamWorkReferenceResponseDto;
  @ApiProperty({ isArray: true, type: IssueHandoffTargetResponseDto })
  targets!: IssueHandoffTargetResponseDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class IssueDetailResponseDto extends IssueSummaryResponseDto {
  @ApiProperty({ nullable: true, type: String }) descriptionMarkdown!: string | null;
  @ApiProperty({ isArray: true, type: IssueDetailAttachmentResponseDto })
  attachments!: IssueDetailAttachmentResponseDto[];
  @ApiProperty({ isArray: true, type: TeamWorkSummaryResponseDto })
  teamWorks!: TeamWorkSummaryResponseDto[];
  @ApiProperty({ isArray: true, type: IssueHandoffFlowHandoffResponseDto })
  handoffFlows!: IssueHandoffFlowHandoffResponseDto[];
}

export class CreateIssueResponseDto {
  @ApiProperty({ type: IssueDetailResponseDto }) issue!: IssueDetailResponseDto;
  @ApiProperty({ isArray: true, type: TeamWorkSummaryResponseDto })
  createdTeamWorks!: TeamWorkSummaryResponseDto[];
}

export class IssueListResponseDto {
  @ApiProperty({ isArray: true, type: IssueSummaryResponseDto }) items!: IssueSummaryResponseDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
  @ApiProperty({ minimum: 0 }) totalCount!: number;
}

export class StartIssueResponseDto {
  @ApiProperty({ type: IssueSummaryResponseDto }) issue!: IssueSummaryResponseDto;
  @ApiProperty({ isArray: true, type: TeamWorkSummaryResponseDto })
  teamWorks!: TeamWorkSummaryResponseDto[];
}

export class ClaimTeamWorkResponseDto {
  @ApiProperty({ type: IssueSummaryResponseDto }) issue!: IssueSummaryResponseDto;
  @ApiProperty({ type: TeamWorkSummaryResponseDto }) teamWork!: TeamWorkSummaryResponseDto;
  @ApiProperty({ type: IssueWorkflowSummaryResponseDto })
  workflowSummary!: IssueWorkflowSummaryResponseDto;
}

export class AssignTeamWorksResponseDto {
  @ApiProperty({ type: IssueSummaryResponseDto }) issue!: IssueSummaryResponseDto;
  @ApiProperty({ isArray: true, type: TeamWorkSummaryResponseDto })
  teamWorks!: TeamWorkSummaryResponseDto[];
  @ApiProperty({ type: IssueWorkflowSummaryResponseDto })
  workflowSummary!: IssueWorkflowSummaryResponseDto;
}

export class UpdateIssueResponseDto extends IssueDetailResponseDto {}

export class TeamWorkHandoffResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) issueId!: string;
  @ApiProperty({ format: 'uuid' }) sourceTeamWorkId!: string;
  @ApiProperty({ format: 'uuid', isArray: true, type: String }) targetTeamWorkIds!: string[];
  @ApiProperty({ enum: HandoffKind }) kind!: HandoffKind;
  @ApiProperty({ minimum: 1 }) sequenceNumber!: number;
  @ApiProperty() bodyMarkdown!: string;
  @ApiProperty({ type: IssueMemberSummaryResponseDto }) author!: IssueMemberSummaryResponseDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class UpdateTeamWorkResponseDto {
  @ApiProperty({ type: TeamWorkDetailResponseDto }) teamWork!: TeamWorkDetailResponseDto;
  @ApiProperty({ type: IssueSummaryResponseDto }) issue!: IssueSummaryResponseDto;
  @ApiPropertyOptional({ type: TeamWorkHandoffResponseDto }) handoff?: TeamWorkHandoffResponseDto;
  @ApiPropertyOptional({ isArray: true, type: TeamWorkSummaryResponseDto })
  downstreamTeamWorks?: TeamWorkSummaryResponseDto[];
}

export class TeamWorkListResponseDto {
  @ApiProperty({ isArray: true, type: TeamWorkSummaryResponseDto })
  items!: TeamWorkSummaryResponseDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
  @ApiProperty({ minimum: 0 }) totalCount!: number;
}
