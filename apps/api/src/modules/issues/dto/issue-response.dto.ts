import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  FeatureIssueStatus,
  HandoffKind,
  IssuePriority,
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';

export class IssueUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class IssueMemberSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: IssueUserSummaryResponseDto })
  user!: IssueUserSummaryResponseDto;

  @ApiProperty({ enum: MembershipRole })
  role!: MembershipRole;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;
}

export class IssueTeamSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  archived!: boolean;
}

export class IssueWorkflowStateSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: StateCategory })
  category!: StateCategory;

  @ApiProperty({ minimum: 0 })
  position!: number;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class IssueStatusResponseDto {
  @ApiProperty({ enum: FeatureIssueStatus, nullable: true })
  featureStatus!: FeatureIssueStatus | null;

  @ApiProperty({ nullable: true, type: IssueWorkflowStateSummaryResponseDto })
  workflowState!: IssueWorkflowStateSummaryResponseDto | null;

  @ApiProperty({ enum: StateCategory })
  category!: StateCategory;
}

export class IssueProjectSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProjectStatus })
  status!: ProjectStatus;

  @ApiProperty()
  archived!: boolean;
}

export class IssueParentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  identifier!: string;

  @ApiProperty()
  title!: string;
}

export class IssueProgressResponseDto {
  @ApiProperty({ minimum: 0 })
  completed!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ maximum: 100, minimum: 0 })
  percentage!: number;
}

export class IssueLabelSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ pattern: '^#[0-9A-F]{6}$' })
  color!: string;

  @ApiProperty()
  archived!: boolean;
}

export class IssueWorkflowWaitingOnResponseDto {
  @ApiProperty({ format: 'uuid' })
  issueId!: string;

  @ApiProperty()
  identifier!: string;

  @ApiProperty()
  title!: string;
}

export class IssueActiveRoleTeamResponseDto {
  @ApiProperty({ enum: ProjectRole })
  projectRole!: ProjectRole;

  @ApiProperty({ type: IssueTeamSummaryResponseDto })
  team!: IssueTeamSummaryResponseDto;

  @ApiProperty({ minimum: 0 })
  unassignedCount!: number;
}

export class CurrentUserAssignedTeamTaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  identifier!: string;

  @ApiProperty({ enum: ProjectRole })
  projectRole!: ProjectRole;
}

export class FeatureWorkflowSummaryResponseDto {
  @ApiProperty({ minimum: 0 })
  teamTaskCount!: number;

  @ApiProperty({ minimum: 0 })
  completedCount!: number;

  @ApiProperty({ minimum: 0 })
  canceledCount!: number;

  @ApiProperty({ minimum: 0 })
  unassignedCount!: number;

  @ApiProperty({ enum: ProjectRole, isArray: true })
  activeRoles!: ProjectRole[];

  @ApiProperty({ isArray: true, type: IssueActiveRoleTeamResponseDto })
  activeRoleTeams!: IssueActiveRoleTeamResponseDto[];

  @ApiProperty({ isArray: true, type: IssueWorkflowWaitingOnResponseDto })
  waitingOn!: IssueWorkflowWaitingOnResponseDto[];

  @ApiProperty()
  allTargetTasksCompleted!: boolean;

  @ApiProperty({ enum: ProjectRole, isArray: true })
  currentUserTeamRoles!: ProjectRole[];

  @ApiProperty({ isArray: true, type: CurrentUserAssignedTeamTaskResponseDto })
  currentUserAssignedTeamTasks!: CurrentUserAssignedTeamTaskResponseDto[];
}

export class IssueSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'API-42' })
  identifier!: string;

  @ApiProperty({ enum: IssueType })
  type!: IssueType;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: IssueStatusResponseDto })
  status!: IssueStatusResponseDto;

  @ApiProperty({ enum: IssuePriority })
  priority!: IssuePriority;

  @ApiProperty({ nullable: true, type: IssueTeamSummaryResponseDto })
  team!: IssueTeamSummaryResponseDto | null;

  @ApiProperty({ nullable: true, type: IssueMemberSummaryResponseDto })
  assignee!: IssueMemberSummaryResponseDto | null;

  @ApiProperty({ nullable: true, type: IssueProjectSummaryResponseDto })
  project!: IssueProjectSummaryResponseDto | null;

  @ApiProperty({ enum: ProjectRole, nullable: true })
  projectRole!: ProjectRole | null;

  @ApiProperty({ nullable: true, type: IssueParentSummaryResponseDto })
  parentIssue!: IssueParentSummaryResponseDto | null;

  @ApiProperty({ isArray: true, type: IssueLabelSummaryResponseDto })
  labels!: IssueLabelSummaryResponseDto[];

  @ApiProperty()
  blocked!: boolean;

  @ApiProperty({ nullable: true, type: IssueProgressResponseDto })
  progress!: IssueProgressResponseDto | null;

  @ApiProperty({ type: IssueMemberSummaryResponseDto })
  createdBy!: IssueMemberSummaryResponseDto;

  @ApiProperty({ nullable: true, type: FeatureWorkflowSummaryResponseDto })
  workflowSummary!: FeatureWorkflowSummaryResponseDto | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class IssueRelationIssueResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  identifier!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ProjectRole, nullable: true })
  projectRole!: ProjectRole | null;

  @ApiProperty({ enum: StateCategory })
  category!: StateCategory;

  @ApiProperty({ enum: FeatureIssueStatus, nullable: true })
  featureStatus!: FeatureIssueStatus | null;
}

export class IssueBlockRelationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: IssueRelationIssueResponseDto })
  issue!: IssueRelationIssueResponseDto;

  @ApiProperty()
  resolved!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueHandoffSummaryResponseDto {
  @ApiProperty()
  hasInitial!: boolean;

  @ApiProperty({ minimum: 0 })
  count!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  latestCreatedAt!: string | null;
}

export class IssueAttachmentFileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['WORKSPACE'] })
  scope!: 'WORKSPACE';

  @ApiProperty()
  originalName!: string;

  @ApiProperty()
  detectedMimeType!: string;

  @ApiProperty({ maximum: 26_214_400, minimum: 1 })
  sizeBytes!: number;

  @ApiProperty()
  inlineDisplayable!: boolean;

  @ApiProperty()
  linked!: true;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueDetailAttachmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ISSUE_ATTACHMENT'] })
  kind!: 'ISSUE_ATTACHMENT';

  @ApiProperty({ type: IssueAttachmentFileResponseDto })
  file!: IssueAttachmentFileResponseDto;

  @ApiProperty({ type: IssueUserSummaryResponseDto })
  uploader!: IssueUserSummaryResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueHandoffFlowHandoffResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: HandoffKind })
  kind!: HandoffKind;

  @ApiProperty({ minimum: 1 })
  sequenceNumber!: number;

  @ApiProperty()
  changeSummary!: string;

  @ApiProperty()
  bodyMarkdown!: string;

  @ApiProperty({ type: IssueMemberSummaryResponseDto })
  author!: IssueMemberSummaryResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueHandoffFlowResponseDto {
  @ApiProperty({ type: IssueRelationIssueResponseDto })
  sourceIssue!: IssueRelationIssueResponseDto;

  @ApiProperty({ isArray: true, type: IssueRelationIssueResponseDto })
  downstreamIssues!: IssueRelationIssueResponseDto[];

  @ApiProperty({ isArray: true, type: IssueHandoffFlowHandoffResponseDto })
  handoffs!: IssueHandoffFlowHandoffResponseDto[];
}

export class IssueWorkflowRelationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  blockingIssueId!: string;

  @ApiProperty({ format: 'uuid' })
  blockedIssueId!: string;

  @ApiProperty()
  resolved!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueDetailResponseDto extends IssueSummaryResponseDto {
  @ApiProperty({ nullable: true, type: String })
  descriptionMarkdown!: string | null;

  @ApiProperty({ isArray: true, type: IssueBlockRelationResponseDto })
  blockers!: IssueBlockRelationResponseDto[];

  @ApiProperty({ isArray: true, type: IssueBlockRelationResponseDto })
  blocking!: IssueBlockRelationResponseDto[];

  @ApiProperty({ isArray: true, type: IssueDetailAttachmentResponseDto })
  attachments!: IssueDetailAttachmentResponseDto[];

  @ApiProperty({ nullable: true, type: IssueHandoffSummaryResponseDto })
  handoffSummary!: IssueHandoffSummaryResponseDto | null;

  @ApiPropertyOptional({ isArray: true, type: IssueHandoffFlowResponseDto })
  handoffFlows?: IssueHandoffFlowResponseDto[];

  @ApiPropertyOptional({ isArray: true, type: IssueWorkflowRelationResponseDto })
  workflowRelations?: IssueWorkflowRelationResponseDto[];
}

export class CreateIssueResponseDto {
  @ApiProperty({ type: IssueDetailResponseDto })
  issue!: IssueDetailResponseDto;

  @ApiProperty({ isArray: true, type: IssueSummaryResponseDto })
  createdTeamTasks!: IssueSummaryResponseDto[];
}

export class IssueCompletionHandoffResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: HandoffKind })
  kind!: HandoffKind;

  @ApiProperty({ minimum: 1 })
  sequenceNumber!: number;

  @ApiProperty()
  bodyMarkdown!: string;

  @ApiProperty({ type: IssueMemberSummaryResponseDto })
  author!: IssueMemberSummaryResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueCompletionBlockRelationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  blockingIssueId!: string;

  @ApiProperty({ format: 'uuid' })
  blockedIssueId!: string;

  @ApiProperty()
  resolved!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class UpdateIssueResponseDto extends IssueDetailResponseDto {
  @ApiPropertyOptional({ type: IssueCompletionHandoffResponseDto })
  handoff?: IssueCompletionHandoffResponseDto;

  @ApiPropertyOptional({ isArray: true, type: IssueSummaryResponseDto })
  downstreamTeamTasks?: IssueSummaryResponseDto[];

  @ApiPropertyOptional({ isArray: true, type: IssueCompletionBlockRelationResponseDto })
  blockRelations?: IssueCompletionBlockRelationResponseDto[];

  @ApiPropertyOptional({ type: IssueSummaryResponseDto })
  updatedParentIssue?: IssueSummaryResponseDto;
}

export class FeatureWorkQueueCountsResponseDto {
  @ApiProperty({ minimum: 0 })
  ALL!: number;

  @ApiProperty({ minimum: 0 })
  REVIEW_REQUIRED!: number;

  @ApiProperty({ minimum: 0 })
  ASSIGNMENT_REQUIRED!: number;

  @ApiProperty({ minimum: 0 })
  IN_PROGRESS!: number;

  @ApiProperty({ minimum: 0 })
  COMPLETION_REQUIRED!: number;

  @ApiProperty({ minimum: 0 })
  COMPLETED!: number;
}

export class IssueListResponseDto {
  @ApiProperty({ isArray: true, type: IssueSummaryResponseDto })
  items!: IssueSummaryResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({ minimum: 0 })
  totalCount!: number;

  @ApiPropertyOptional({ type: FeatureWorkQueueCountsResponseDto })
  workQueueCounts?: FeatureWorkQueueCountsResponseDto;
}

export class ClaimIssueResponseDto {
  @ApiProperty({ type: IssueSummaryResponseDto })
  issue!: IssueSummaryResponseDto;

  @ApiProperty({ type: IssueSummaryResponseDto })
  teamTask!: IssueSummaryResponseDto;

  @ApiProperty({ type: FeatureWorkflowSummaryResponseDto })
  workflowSummary!: FeatureWorkflowSummaryResponseDto;
}

export class AssignTeamTasksResponseDto {
  @ApiProperty({ type: IssueSummaryResponseDto })
  issue!: IssueSummaryResponseDto;

  @ApiProperty({ isArray: true, type: IssueSummaryResponseDto })
  teamTasks!: IssueSummaryResponseDto[];

  @ApiProperty({ type: FeatureWorkflowSummaryResponseDto })
  workflowSummary!: FeatureWorkflowSummaryResponseDto;
}
