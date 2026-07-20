import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { IssuePriority } from '@rivet/database';

export const ISSUE_TEMPLATE_UNAVAILABLE_REASONS = [
  'ARCHIVED',
  'LABEL_UNAVAILABLE',
  'PROJECT_UNAVAILABLE',
  'PROJECT_TEAM_UNAVAILABLE',
  'TEAM_UNAVAILABLE',
] as const;

export type IssueTemplateUnavailableReason = (typeof ISSUE_TEMPLATE_UNAVAILABLE_REASONS)[number];

function normalizeString(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

function normalizeUuid(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function normalizeUuidArray(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalizeUuid) : value;
}

export class IssueTemplateListQueryDto {
  @ApiPropertyOptional({ default: false, type: Boolean })
  @Transform(({ value }) => {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: '보관 템플릿 포함 여부가 올바르지 않습니다.' })
  includeArchived = false;
}

export class CreateIssueTemplateDto {
  @ApiProperty({ maxLength: 100, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsString({ message: '템플릿 이름을 입력해 주세요.' })
  @IsNotEmpty({ message: '템플릿 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '템플릿 이름은 100자 이하여야 합니다.' })
  name!: string;

  @ApiProperty({ maxLength: 100_000, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsString({ message: '템플릿 설명을 입력해 주세요.' })
  @IsNotEmpty({ message: '템플릿 설명을 입력해 주세요.' })
  @MaxLength(100_000, { message: '템플릿 설명은 100,000자 이하여야 합니다.' })
  descriptionMarkdown!: string;

  @ApiPropertyOptional({ default: IssuePriority.NONE, enum: IssuePriority })
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsEnum(IssuePriority, { message: '기본 우선순위가 올바르지 않습니다.' })
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, maxItems: 100, type: String })
  @Transform(({ value }) => normalizeUuidArray(value))
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsArray({ message: '기본 라벨 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '기본 라벨은 최대 100개까지 선택할 수 있습니다.' })
  @ArrayUnique({ message: '같은 기본 라벨을 중복해서 선택할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '기본 라벨 ID가 올바르지 않습니다.' })
  labelIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @ValidateIf((_dto, value: unknown) => value !== null && value !== undefined)
  @IsUUID('4', { message: '기본 프로젝트 ID가 올바르지 않습니다.' })
  projectId?: string | null;

  @ApiPropertyOptional({ description: '기본 프로젝트의 활성 참여 팀 ID', format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @ValidateIf((_dto, value: unknown) => value !== null && value !== undefined)
  @IsUUID('4', { message: '최초 팀 ID가 올바르지 않습니다.' })
  initialProjectTeamId?: string | null;
}

export class UpdateIssueTemplateDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '템플릿 버전이 올바르지 않습니다.' })
  @Min(1, { message: '템플릿 버전이 올바르지 않습니다.' })
  version!: number;

  @ApiPropertyOptional({ maxLength: 100, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsString({ message: '템플릿 이름이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '템플릿 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '템플릿 이름은 100자 이하여야 합니다.' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 100_000, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsString({ message: '템플릿 설명이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '템플릿 설명을 입력해 주세요.' })
  @MaxLength(100_000, { message: '템플릿 설명은 100,000자 이하여야 합니다.' })
  descriptionMarkdown?: string;

  @ApiPropertyOptional({ enum: IssuePriority })
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsEnum(IssuePriority, { message: '기본 우선순위가 올바르지 않습니다.' })
  priority?: IssuePriority;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, maxItems: 100, type: String })
  @Transform(({ value }) => normalizeUuidArray(value))
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @IsArray({ message: '기본 라벨 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '기본 라벨은 최대 100개까지 선택할 수 있습니다.' })
  @ArrayUnique({ message: '같은 기본 라벨을 중복해서 선택할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '기본 라벨 ID가 올바르지 않습니다.' })
  labelIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @ValidateIf((_dto, value: unknown) => value !== null && value !== undefined)
  @IsUUID('4', { message: '기본 프로젝트 ID가 올바르지 않습니다.' })
  projectId?: string | null;

  @ApiPropertyOptional({ description: '기본 프로젝트의 활성 참여 팀 ID', format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @ValidateIf((_dto, value: unknown) => value !== null && value !== undefined)
  @IsUUID('4', { message: '최초 팀 ID가 올바르지 않습니다.' })
  initialProjectTeamId?: string | null;
}

export class ArchiveIssueTemplateDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '템플릿 버전이 올바르지 않습니다.' })
  @Min(1, { message: '템플릿 버전이 올바르지 않습니다.' })
  version!: number;
}

export class RestoreIssueTemplateDto extends ArchiveIssueTemplateDto {}

export class ApplyIssueTemplateDto extends ArchiveIssueTemplateDto {}

export class IssueTemplateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  descriptionMarkdown!: string;

  @ApiProperty({ enum: IssuePriority })
  priority!: IssuePriority;

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  labelIds!: string[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  projectId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  initialProjectTeamId!: string | null;

  @ApiProperty()
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty()
  available!: boolean;

  @ApiProperty({ enum: ISSUE_TEMPLATE_UNAVAILABLE_REASONS, nullable: true })
  unavailableReason!: IssueTemplateUnavailableReason | null;
}

export class IssueTemplateListResponseDto {
  @ApiProperty({ isArray: true, type: IssueTemplateResponseDto })
  items!: IssueTemplateResponseDto[];
}
