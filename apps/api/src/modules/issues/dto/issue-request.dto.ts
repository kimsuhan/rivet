import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBooleanString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { FeatureIssueStatus, IssuePriority, IssueType, ProjectRole } from '@rivet/database';

const HANDOFF_BODY_DESCRIPTION =
  '고정 순서의 H2 섹션 7개(변경 요약, API 명세 링크, 사용 가능 환경, 추가·변경 API, 요청·응답 변경, 오류·권한, 프론트 주의사항)를 모두 작성해야 합니다. 각 섹션에는 내용 또는 `해당 없음`을 입력하고, API 명세 링크 섹션은 `해당 없음`이 아니면 사용자 정보가 없는 유효한 HTTP(S) URL을 하나 이상 포함해야 합니다.';
const HANDOFF_BODY_EXAMPLE = [
  '## 변경 요약',
  '로그인 응답에 워크스페이스 정보를 추가했습니다.',
  '## API 명세 링크',
  'https://api.example.com/openapi.json',
  '## 사용 가능 환경',
  '개발 환경',
  '## 추가·변경 API',
  'POST /sessions',
  '## 요청·응답 변경',
  '응답에 workspaceId를 추가했습니다.',
  '## 오류·권한',
  '401 응답 계약은 동일합니다.',
  '## 프론트 주의사항',
  '기존 필드는 유지됩니다.',
].join('\n\n');

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
  @ApiPropertyOptional({ enum: IssueType })
  @IsOptional()
  @IsString({ message: '이슈 유형 필터가 올바르지 않습니다.' })
  @MaxLength(20, { message: '이슈 유형 필터가 올바르지 않습니다.' })
  type?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 팀 ID' })
  @IsOptional()
  @IsString({ message: '팀 필터가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '팀 필터가 너무 깁니다.' })
  teamId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 ID' })
  @IsOptional()
  @IsString({ message: '프로젝트 필터가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '프로젝트 필터가 너무 깁니다.' })
  projectId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 역할' })
  @IsOptional()
  @IsString({ message: '프로젝트 역할 필터가 올바르지 않습니다.' })
  @MaxLength(100, { message: '프로젝트 역할 필터가 너무 깁니다.' })
  projectRole?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '상위 이슈 필터가 올바르지 않습니다.' })
  parentIssueId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 기능 이슈 상태' })
  @IsOptional()
  @IsString({ message: '기능 이슈 상태 필터가 올바르지 않습니다.' })
  @MaxLength(200, { message: '기능 이슈 상태 필터가 너무 깁니다.' })
  featureStatus?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 워크플로 상태 ID' })
  @IsOptional()
  @IsString({ message: '워크플로 상태 필터가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '워크플로 상태 필터가 너무 깁니다.' })
  workflowStateId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 상태 범주' })
  @IsOptional()
  @IsString({ message: '상태 범주 필터가 올바르지 않습니다.' })
  @MaxLength(100, { message: '상태 범주 필터가 너무 깁니다.' })
  stateCategory?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 멤버십 ID 또는 me' })
  @IsOptional()
  @IsString({ message: '담당자 필터가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '담당자 필터가 너무 깁니다.' })
  assigneeMembershipId?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 우선순위' })
  @IsOptional()
  @IsString({ message: '우선순위 필터가 올바르지 않습니다.' })
  @MaxLength(100, { message: '우선순위 필터가 너무 깁니다.' })
  priority?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 라벨 ID' })
  @IsOptional()
  @IsString({ message: '라벨 필터가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '라벨 필터가 너무 깁니다.' })
  labelId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsBooleanString({ message: '차단 여부 필터가 올바르지 않습니다.' })
  blocked?: string;

  @ApiPropertyOptional({
    default: 'updatedAt',
    description:
      '이슈 정렬 기준입니다. 생략하면 `updatedAt desc`를 사용합니다. `priority` 오름차순은 `NONE < LOW < MEDIUM < HIGH < URGENT`입니다. `status` 오름차순은 `StateCategory(BACKLOG < UNSTARTED < STARTED < COMPLETED < CANCELED) → 유형별 상태 위치(팀 작업은 workflow position, 기능 이슈는 UNSORTED < PAUSED와 IN_PROGRESS < REVIEW의 범주 내 고정 위치) → IssueType(FEATURE < TEAM_TASK) → id` 순서입니다. 모든 정렬은 불변 `id`를 마지막 동률 해소 값으로 사용합니다.',
    enum: ['createdAt', 'updatedAt', 'status', 'priority'],
  })
  @IsOptional()
  @IsString({ message: '정렬 기준이 올바르지 않습니다.' })
  @MaxLength(20, { message: '정렬 기준이 올바르지 않습니다.' })
  sort?: string;

  @ApiPropertyOptional({
    default: 'desc',
    description:
      '정렬 방향입니다. 주 정렬 값과 상태 정렬 튜플의 모든 값, 마지막 `id` 동률 해소에 같은 방향을 적용합니다.',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsString({ message: '정렬 방향이 올바르지 않습니다.' })
  @MaxLength(4, { message: '정렬 방향이 올바르지 않습니다.' })
  sortDirection?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt({ message: '조회 개수가 올바르지 않습니다.' })
  @Min(1, { message: '조회 개수는 1 이상이어야 합니다.' })
  @Max(100, { message: '조회 개수는 100 이하여야 합니다.' })
  limit = 50;

  @ApiPropertyOptional({
    description:
      '이전 응답에서 받은 불투명 커서입니다. 서버가 정규화한 실제 정렬 값(상태 정렬은 전체 튜플)과 마지막 항목의 `id`를 포함하며 클라이언트는 해석하거나 생성하지 않습니다. 같은 워크스페이스와 sort·sortDirection·필터 조건의 다음 페이지에만 사용하고 조건이 바뀌면 첫 페이지부터 조회합니다.',
  })
  @IsOptional()
  @IsString({ message: '커서가 올바르지 않습니다.' })
  @MaxLength(1024, { message: '커서가 올바르지 않습니다.' })
  cursor?: string;
}

export class TrashIssueDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '이슈 버전이 올바르지 않습니다.' })
  @Min(1, { message: '이슈 버전이 올바르지 않습니다.' })
  version!: number;
}

export class CreateIssueDto {
  @ApiProperty({ enum: IssueType, example: IssueType.TEAM_TASK })
  @IsEnum(IssueType, { message: '이슈 유형이 올바르지 않습니다.' })
  type!: IssueType;

  @ApiProperty({ maxLength: 500, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsString({ message: '이슈 제목을 입력해 주세요.' })
  @IsNotEmpty({ message: '이슈 제목을 입력해 주세요.' })
  @MaxLength(500, { message: '이슈 제목은 500자 이하여야 합니다.' })
  title!: string;

  @ApiPropertyOptional({ maxLength: 100_000, nullable: true, type: String })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '이슈 설명이 올바르지 않습니다.' })
  @MaxLength(100_000, { message: '이슈 설명은 100,000자 이하여야 합니다.' })
  descriptionMarkdown?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '팀 식별자가 올바르지 않습니다.' })
  teamId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '워크플로 상태 식별자가 올바르지 않습니다.' })
  workflowStateId?: string;

  @ApiPropertyOptional({ enum: FeatureIssueStatus })
  @IsOptional()
  @IsEnum(FeatureIssueStatus, { message: '기능 이슈 상태가 올바르지 않습니다.' })
  featureStatus?: FeatureIssueStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '프로젝트 식별자가 올바르지 않습니다.' })
  projectId?: string;

  @ApiPropertyOptional({ enum: ProjectRole })
  @IsOptional()
  @IsEnum(ProjectRole, { message: '프로젝트 역할이 올바르지 않습니다.' })
  projectRole?: ProjectRole;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '상위 이슈 식별자가 올바르지 않습니다.' })
  parentIssueId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '담당자 식별자가 올바르지 않습니다.' })
  assigneeMembershipId?: string | null;

  @ApiPropertyOptional({ default: IssuePriority.NONE, enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority, { message: '우선순위가 올바르지 않습니다.' })
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray({ message: '라벨 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '라벨은 최대 100개까지 선택할 수 있습니다.' })
  @ArrayUnique({ message: '같은 라벨을 중복 선택할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '라벨 식별자가 올바르지 않습니다.' })
  labelIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray({ message: '첨부 파일 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '첨부 파일은 최대 100개까지 선택할 수 있습니다.' })
  @ArrayUnique({ message: '같은 파일을 중복 첨부할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '첨부 파일 식별자가 올바르지 않습니다.' })
  attachmentFileIds?: string[];
}

export class CreateFeatureIssueDto {
  @ApiProperty({ enum: [IssueType.FEATURE], example: IssueType.FEATURE })
  type!: 'FEATURE';

  @ApiProperty({ maxLength: 500, minLength: 1 })
  title!: string;

  @ApiPropertyOptional({ maxLength: 100_000, nullable: true, type: String })
  descriptionMarkdown?: string | null;

  @ApiProperty({ enum: FeatureIssueStatus })
  featureStatus!: FeatureIssueStatus;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiPropertyOptional({ default: IssuePriority.NONE, enum: IssuePriority })
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  labelIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  attachmentFileIds?: string[];
}

export class CreateTeamTaskIssueDto {
  @ApiProperty({ enum: [IssueType.TEAM_TASK], example: IssueType.TEAM_TASK })
  type!: 'TEAM_TASK';

  @ApiProperty({ maxLength: 500, minLength: 1 })
  title!: string;

  @ApiPropertyOptional({ maxLength: 100_000, nullable: true, type: String })
  descriptionMarkdown?: string | null;

  @ApiProperty({ format: 'uuid' })
  teamId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  workflowStateId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  projectId?: string;

  @ApiPropertyOptional({ enum: ProjectRole })
  projectRole?: ProjectRole;

  @ApiPropertyOptional({ format: 'uuid' })
  parentIssueId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  assigneeMembershipId?: string | null;

  @ApiPropertyOptional({ default: IssuePriority.NONE, enum: IssuePriority })
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  labelIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  attachmentFileIds?: string[];
}

export class InlineHandoffDto {
  @ApiProperty({
    description: HANDOFF_BODY_DESCRIPTION,
    example: HANDOFF_BODY_EXAMPLE,
    maxLength: 50_000,
  })
  @Transform(({ value }) => normalizeString(value))
  @IsString({ message: '작업 전달 내용을 입력해 주세요.' })
  @IsNotEmpty({ message: '작업 전달 내용을 입력해 주세요.' })
  @MaxLength(50_000, { message: '작업 전달은 50,000자 이하여야 합니다.' })
  bodyMarkdown!: string;
}

export class UpdateIssueDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '이슈 버전이 올바르지 않습니다.' })
  @Min(1, { message: '이슈 버전이 올바르지 않습니다.' })
  version!: number;

  @ApiPropertyOptional({ maxLength: 500, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '이슈 제목이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '이슈 제목을 입력해 주세요.' })
  @MaxLength(500, { message: '이슈 제목은 500자 이하여야 합니다.' })
  title?: string;

  @ApiPropertyOptional({ maxLength: 100_000, nullable: true, type: String })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '이슈 설명이 올바르지 않습니다.' })
  @MaxLength(100_000, { message: '이슈 설명은 100,000자 이하여야 합니다.' })
  descriptionMarkdown?: string | null;

  @ApiPropertyOptional({
    description: '팀 작업의 팀은 변경할 수 없으며 현재 팀 ID만 허용됩니다.',
    format: 'uuid',
  })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '팀 식별자가 올바르지 않습니다.' })
  teamId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '워크플로 상태 식별자가 올바르지 않습니다.' })
  workflowStateId?: string;

  @ApiPropertyOptional({ enum: FeatureIssueStatus })
  @IsOptional()
  @IsEnum(FeatureIssueStatus, { message: '기능 이슈 상태가 올바르지 않습니다.' })
  featureStatus?: FeatureIssueStatus;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '프로젝트 식별자가 올바르지 않습니다.' })
  projectId?: string | null;

  @ApiPropertyOptional({ enum: ProjectRole, nullable: true })
  @IsOptional()
  @IsEnum(ProjectRole, { message: '프로젝트 역할이 올바르지 않습니다.' })
  projectRole?: ProjectRole | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '상위 이슈 식별자가 올바르지 않습니다.' })
  parentIssueId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '담당자 식별자가 올바르지 않습니다.' })
  assigneeMembershipId?: string | null;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority, { message: '우선순위가 올바르지 않습니다.' })
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, type: String, uniqueItems: true })
  @Transform(({ value }) => normalizeUuidArray(value))
  @IsOptional()
  @IsArray({ message: '라벨 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '라벨은 최대 100개까지 선택할 수 있습니다.' })
  @ArrayUnique({ message: '같은 라벨을 중복 선택할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '라벨 식별자가 올바르지 않습니다.' })
  labelIds?: string[];

  @ApiPropertyOptional({ type: () => InlineHandoffDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineHandoffDto)
  handoff?: InlineHandoffDto;
}
