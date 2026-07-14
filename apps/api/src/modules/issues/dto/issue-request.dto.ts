import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

import { IssuePriority, IssueStatus, ProjectRole, StateCategory } from '@rivet/database';

export const ISSUE_STATUS_ACTIONS = ['PAUSE', 'RESUME', 'CANCEL', 'COMPLETE', 'REOPEN'] as const;
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

export class InitialRoleAssignmentDto {
  @ApiProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  projectRole!: ProjectRole;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @ValidateIf((_dto, value: unknown) => value !== null && value !== undefined)
  @IsUUID('4')
  assigneeMembershipId?: string | null;
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
    description: '생성과 함께 시작할 프로젝트 역할',
    isArray: true,
    maxItems: 3,
    type: InitialRoleAssignmentDto,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique((assignment: InitialRoleAssignmentDto) => assignment.projectRole)
  @ValidateNested({ each: true })
  @Type(() => InitialRoleAssignmentDto)
  initialRoles?: InitialRoleAssignmentDto[];
}

export class StartIssueDto {
  @ApiProperty({ isArray: true, maxItems: 3, minItems: 1, type: InitialRoleAssignmentDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique((assignment: InitialRoleAssignmentDto) => assignment.projectRole)
  @ValidateNested({ each: true })
  @Type(() => InitialRoleAssignmentDto)
  roleAssignments!: InitialRoleAssignmentDto[];

  @ApiPropertyOptional({ description: '선택 역할 팀에 현재 사용자가 활성 멤버인지 확인' })
  @IsOptional()
  @IsBoolean()
  requireCurrentUserTeamMembership?: boolean;
}

export class ClaimTeamWorkDto {
  @ApiProperty({ enum: ProjectRole })
  @IsEnum(ProjectRole)
  projectRole!: ProjectRole;

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
  @ApiPropertyOptional({ description: '표시 ID 또는 상위 이슈 제목 검색', maxLength: 500 })
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

  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 역할' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  projectRole?: string;

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

  @ApiPropertyOptional({ description: '쉼표로 구분한 멤버십 ID 또는 me' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  assigneeMembershipId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsBooleanString()
  unassigned?: string;

  @ApiPropertyOptional({ default: 'updatedAt', enum: ['createdAt', 'updatedAt', 'status'] })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'status'])
  sort?: 'createdAt' | 'updatedAt' | 'status';

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

export class InlineHandoffDto {
  @ApiProperty({ maxLength: 50_000 })
  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  bodyMarkdown!: string;

  @ApiPropertyOptional({
    enum: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn([ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND], { each: true })
  destinationRoles?: (typeof ProjectRole.WEB_FRONTEND | typeof ProjectRole.APP_FRONTEND)[];
}

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

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @ValidateIf((_dto, value: unknown) => value !== null)
  @IsUUID('4')
  assigneeMembershipId?: string | null;

  @ApiPropertyOptional({
    description: '멘션, 이미지와 파일을 제외한 팀 작업 전용 Markdown 노트',
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
