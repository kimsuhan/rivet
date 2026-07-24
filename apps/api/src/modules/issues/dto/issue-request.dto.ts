import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsBooleanString,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { IssuePriority, IssueStatus, StateCategory } from '@rivet/database';

import { ISSUE_GROUP_FIELDS, TEAM_WORK_GROUP_FIELDS } from '../issue-list.policy';

export const ISSUE_STATUS_ACTIONS = ['PAUSE', 'RESUME', 'CANCEL', 'REOPEN'] as const;
export type IssueStatusAction = (typeof ISSUE_STATUS_ACTIONS)[number];

function normalizeString(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

function normalizeUuid(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function normalizeUuidArray(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalizeUuid) : value;
}

export class IssueListQueryDto {
  @ApiPropertyOptional({ description: '표시 ID 또는 제목 검색', maxLength: 500 })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '검색어가 올바르지 않습니다.' })
  @MaxLength(500, { message: '검색어는 500자 이하여야 합니다.' })
  query?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 ID' })
  @IsOptional()
  @IsString({ message: '프로젝트 필터가 올바르지 않습니다.' })
  @MaxLength(2048)
  projectId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 이슈 상태', enum: IssueStatus })
  @IsOptional()
  @IsString({ message: '이슈 상태 필터가 올바르지 않습니다.' })
  @MaxLength(200)
  status?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 우선순위' })
  @IsOptional()
  @IsString({ message: '우선순위 필터가 올바르지 않습니다.' })
  @MaxLength(100)
  priority?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 라벨 ID' })
  @IsOptional()
  @IsString({ message: '라벨 필터가 올바르지 않습니다.' })
  @MaxLength(2048)
  labelId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 만든 사람 멤버십 ID' })
  @IsOptional()
  @IsString({ message: '만든 사람 필터가 올바르지 않습니다.' })
  @MaxLength(2048)
  createdByMembershipId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 팀 작업 담당자 멤버십 ID' })
  @IsOptional()
  @IsString({ message: '담당자 필터가 올바르지 않습니다.' })
  @MaxLength(2048)
  assigneeMembershipId?: string;

  @ApiPropertyOptional({
    description: '팀 작업이 없거나 담당자가 없는 팀 작업이 있는 이슈 포함 여부',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsBooleanString()
  unassigned?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdTo?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  updatedFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  updatedTo?: string;

  @ApiPropertyOptional({
    default: 'updatedAt',
    enum: ['createdAt', 'updatedAt', 'status', 'priority', 'progress'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'status', 'priority', 'progress'])
  sort?: 'createdAt' | 'updatedAt' | 'status' | 'priority' | 'progress';

  @ApiPropertyOptional({ default: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description:
      '쉼표로 구분한 정렬 조건(field:direction). 최대 3개이며 sort/sortDirection과 함께 사용할 수 없습니다.',
    example: 'priority:desc,status:asc,updatedAt:desc',
  })
  @IsOptional()
  @IsString({ message: '다중 정렬 조건이 올바르지 않습니다.' })
  @MaxLength(200)
  sorts?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({ description: '같은 정렬·필터 조건에서만 사용하는 불투명 커서' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}

export class IssueGroupQueryDto extends OmitType(IssueListQueryDto, [
  'cursor',
  'limit',
  'sort',
  'sortDirection',
  'sorts',
] as const) {
  @ApiProperty({ enum: ISSUE_GROUP_FIELDS })
  @IsIn(ISSUE_GROUP_FIELDS)
  groupBy!: (typeof ISSUE_GROUP_FIELDS)[number];

  @ApiPropertyOptional({ enum: ISSUE_GROUP_FIELDS })
  @IsIn(ISSUE_GROUP_FIELDS)
  @IsOptional()
  subGroupBy?: (typeof ISSUE_GROUP_FIELDS)[number];
}

export class InitialTeamAssignmentDto {
  @ApiProperty({ description: '프로젝트 참여 팀 ID', format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  projectTeamId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @ValidateIf((_dto, value: unknown) => value !== null && value !== undefined)
  @IsUUID('4')
  assigneeMembershipId?: string | null;
}

export class AppliedIssueTemplateDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  id!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreateIssueDto {
  @ApiProperty({ maxLength: 500, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ maxLength: 100_000, nullable: true, type: String })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  descriptionMarkdown?: string | null;

  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  projectId!: string;

  @ApiPropertyOptional({ default: IssuePriority.NONE, enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labelIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attachmentFileIds?: string[];

  @ApiPropertyOptional({
    description: '생성과 함께 시작할 프로젝트 참여 팀',
    isArray: true,
    maxItems: 100,
    type: InitialTeamAssignmentDto,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((assignment: InitialTeamAssignmentDto) => assignment.projectTeamId)
  @ValidateNested({ each: true })
  @Type(() => InitialTeamAssignmentDto)
  initialTeams?: InitialTeamAssignmentDto[];

  @ApiPropertyOptional({
    description: '생성 입력을 채운 이슈 템플릿과 적용 당시 version',
    type: AppliedIssueTemplateDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppliedIssueTemplateDto)
  appliedTemplate?: AppliedIssueTemplateDto;
}

export class StartIssueDto {
  @ApiProperty({ isArray: true, maxItems: 100, minItems: 1, type: InitialTeamAssignmentDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((assignment: InitialTeamAssignmentDto) => assignment.projectTeamId)
  @ValidateNested({ each: true })
  @Type(() => InitialTeamAssignmentDto)
  teamAssignments!: InitialTeamAssignmentDto[];

  @ApiPropertyOptional({ description: '선택 팀에 현재 사용자가 활성 멤버인지 확인' })
  @IsOptional()
  @IsBoolean()
  requireCurrentUserTeamMembership?: boolean;
}

export class ClaimTeamWorkDto {
  @ApiProperty({ description: '프로젝트 참여 팀 ID', format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  projectTeamId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4')
  teamWorkId?: string | null;
}

export class TeamWorkAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  teamWorkId!: string;

  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  assigneeMembershipId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class AssignTeamWorksDto {
  @ApiProperty({ isArray: true, minItems: 1, type: TeamWorkAssignmentDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((assignment: TeamWorkAssignmentDto) => assignment.teamWorkId)
  @ValidateNested({ each: true })
  @Type(() => TeamWorkAssignmentDto)
  assignments!: TeamWorkAssignmentDto[];
}

export class UpdateIssueDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 500, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ maxLength: 100_000, nullable: true, type: String })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  descriptionMarkdown?: string | null;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labelIds?: string[];

  @ApiPropertyOptional({ enum: ISSUE_STATUS_ACTIONS })
  @IsOptional()
  @IsIn(ISSUE_STATUS_ACTIONS)
  statusAction?: IssueStatusAction;
}

export class TrashIssueDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class TeamWorkListQueryDto {
  @ApiPropertyOptional({
    description: '팀 작업 표시 ID, 상위 이슈 표시 ID·제목 또는 프로젝트 이름 검색',
    maxLength: 500,
  })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  query?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 팀 ID' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  teamId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 ID' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  projectId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 참여 팀 ID' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  projectTeamId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 워크플로 상태 ID' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  workflowStateId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 상태 범주', enum: StateCategory })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  stateCategory?: string;

  @ApiPropertyOptional({
    description: '쉼표로 구분한 상위 이슈 우선순위',
    example: 'HIGH,URGENT',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  priority?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 멤버십 ID 또는 me' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  assigneeMembershipId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsBooleanString()
  unassigned?: string;

  @ApiPropertyOptional({
    default: 'updatedAt',
    enum: ['executionOrder', 'priority', 'createdAt', 'updatedAt', 'status'],
  })
  @IsOptional()
  @IsIn(['executionOrder', 'priority', 'createdAt', 'updatedAt', 'status'])
  sort?: 'executionOrder' | 'priority' | 'createdAt' | 'updatedAt' | 'status';

  @ApiPropertyOptional({ default: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}

export class TeamWorkGroupQueryDto extends OmitType(TeamWorkListQueryDto, [
  'cursor',
  'limit',
  'sort',
  'sortDirection',
] as const) {
  @ApiProperty({ enum: TEAM_WORK_GROUP_FIELDS })
  @IsIn(TEAM_WORK_GROUP_FIELDS)
  groupBy!: (typeof TEAM_WORK_GROUP_FIELDS)[number];

  @ApiPropertyOptional({ enum: TEAM_WORK_GROUP_FIELDS })
  @IsIn(TEAM_WORK_GROUP_FIELDS)
  @IsOptional()
  subGroupBy?: (typeof TEAM_WORK_GROUP_FIELDS)[number];
}

export class InlineHandoffDto {
  @ApiProperty({ maxLength: 50_000 })
  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  bodyMarkdown!: string;

  @ApiPropertyOptional({
    description: '같은 프로젝트에서 전달할 활성 참여 팀 ID',
    format: 'uuid',
    isArray: true,
    type: String,
    uniqueItems: true,
  })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  destinationProjectTeamIds?: string[];
}

export const TEAM_WORK_COMPLETION_MODES = ['COMPLETE_ONLY', 'HANDOFF_AND_COMPLETE'] as const;
export type TeamWorkCompletionMode = (typeof TEAM_WORK_COMPLETION_MODES)[number];

export class UpdateTeamWorkDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4')
  workflowStateId?: string;

  @ApiPropertyOptional({
    description: '완료 범주로 전이할 때만 사용하는 명시적 완료 방식',
    enum: TEAM_WORK_COMPLETION_MODES,
  })
  @IsOptional()
  @IsIn(TEAM_WORK_COMPLETION_MODES)
  completionMode?: TeamWorkCompletionMode;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @ValidateIf((_dto, value: unknown) => value !== null)
  @IsUUID('4')
  assigneeMembershipId?: string | null;

  @ApiPropertyOptional({
    description: '멤버 멘션을 지원하고 이미지와 파일은 제외한 팀 작업 전용 Markdown 노트',
    maxLength: 10000,
    nullable: true,
    type: String,
  })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  workNoteMarkdown?: string | null;

  @ApiPropertyOptional({ type: InlineHandoffDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineHandoffDto)
  handoff?: InlineHandoffDto;
}

export class RemoveTeamWorkDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
