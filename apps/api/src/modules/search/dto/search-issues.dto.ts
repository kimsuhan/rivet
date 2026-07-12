import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  FeatureIssueStatus,
  IssuePriority,
  IssueType,
  MembershipRole,
  MembershipStatus,
  ProjectRole,
  ProjectStatus,
  StateCategory,
} from '@rivet/database';

export const SEARCH_ISSUE_MATCH_TYPES = ['IDENTIFIER_EXACT', 'TITLE_PARTIAL'] as const;

export type SearchIssueMatchType = (typeof SEARCH_ISSUE_MATCH_TYPES)[number];

function normalizeQuery(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export class SearchIssuesQueryDto {
  @ApiProperty({ description: '표시 ID 또는 제목 검색어', maxLength: 500 })
  @Transform(({ value }) => normalizeQuery(value))
  @IsOptional()
  @IsString({ message: '검색어가 올바르지 않습니다.' })
  @MaxLength(500, { message: '검색어는 500자 이하여야 합니다.' })
  query?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt({ message: '조회 개수가 올바르지 않습니다.' })
  @Min(1, { message: '조회 개수는 1 이상이어야 합니다.' })
  @Max(50, { message: '조회 개수는 50 이하여야 합니다.' })
  limit = 20;

  @ApiPropertyOptional({ description: '이전 응답에서 받은 불투명 커서' })
  @IsOptional()
  @IsString({ message: '커서가 올바르지 않습니다.' })
  @MaxLength(1024, { message: '커서가 올바르지 않습니다.' })
  cursor?: string;
}

export class SearchIssueUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class SearchIssueMemberSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: SearchIssueUserSummaryResponseDto })
  user!: SearchIssueUserSummaryResponseDto;

  @ApiProperty({ enum: MembershipRole })
  role!: MembershipRole;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;
}

export class SearchIssueTeamSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  archived!: boolean;
}

export class SearchIssueWorkflowStateSummaryResponseDto {
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

export class SearchIssueStatusResponseDto {
  @ApiProperty({ enum: FeatureIssueStatus, nullable: true })
  featureStatus!: FeatureIssueStatus | null;

  @ApiProperty({ nullable: true, type: SearchIssueWorkflowStateSummaryResponseDto })
  workflowState!: SearchIssueWorkflowStateSummaryResponseDto | null;

  @ApiProperty({ enum: StateCategory })
  category!: StateCategory;
}

export class SearchIssueProjectSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProjectStatus })
  status!: ProjectStatus;

  @ApiProperty()
  archived!: boolean;
}

export class SearchIssueParentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  identifier!: string;

  @ApiProperty()
  title!: string;
}

export class SearchIssueProgressResponseDto {
  @ApiProperty({ minimum: 0 })
  completed!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ maximum: 100, minimum: 0 })
  percentage!: number;
}

export class SearchIssueLabelSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ pattern: '^#[0-9A-F]{6}$' })
  color!: string;

  @ApiProperty()
  archived!: boolean;
}

export class SearchIssueSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'API-42' })
  identifier!: string;

  @ApiProperty({ enum: IssueType })
  type!: IssueType;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: SearchIssueStatusResponseDto })
  status!: SearchIssueStatusResponseDto;

  @ApiProperty({ enum: IssuePriority })
  priority!: IssuePriority;

  @ApiProperty({ nullable: true, type: SearchIssueTeamSummaryResponseDto })
  team!: SearchIssueTeamSummaryResponseDto | null;

  @ApiProperty({ nullable: true, type: SearchIssueMemberSummaryResponseDto })
  assignee!: SearchIssueMemberSummaryResponseDto | null;

  @ApiProperty({ nullable: true, type: SearchIssueProjectSummaryResponseDto })
  project!: SearchIssueProjectSummaryResponseDto | null;

  @ApiProperty({ enum: ProjectRole, nullable: true })
  projectRole!: ProjectRole | null;

  @ApiProperty({ nullable: true, type: SearchIssueParentSummaryResponseDto })
  parentIssue!: SearchIssueParentSummaryResponseDto | null;

  @ApiProperty({ isArray: true, type: SearchIssueLabelSummaryResponseDto })
  labels!: SearchIssueLabelSummaryResponseDto[];

  @ApiProperty()
  blocked!: boolean;

  @ApiProperty({ nullable: true, type: SearchIssueProgressResponseDto })
  progress!: SearchIssueProgressResponseDto | null;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class SearchIssueResultResponseDto {
  @ApiProperty({ enum: SEARCH_ISSUE_MATCH_TYPES })
  matchType!: SearchIssueMatchType;

  @ApiProperty({ type: SearchIssueSummaryResponseDto })
  issue!: SearchIssueSummaryResponseDto;
}

export class SearchIssueListResponseDto {
  @ApiProperty({ isArray: true, type: SearchIssueResultResponseDto })
  items!: SearchIssueResultResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
