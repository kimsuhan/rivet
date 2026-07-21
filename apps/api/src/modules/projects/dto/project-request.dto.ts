import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ProjectStatus } from '@rivet/database';

function normalizeString(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

function normalizeUuid(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

export class ProjectListQueryDto {
  @ApiPropertyOptional({ description: '쉼표로 구분한 프로젝트 상태' })
  @IsOptional()
  @IsString({ message: '프로젝트 상태 필터가 올바르지 않습니다.' })
  @MaxLength(100, { message: '프로젝트 상태 필터가 너무 깁니다.' })
  status?: string;

  @ApiPropertyOptional({ description: '쉼표로 구분한 리드 멤버십 ID' })
  @IsOptional()
  @IsString({ message: '프로젝트 리드 필터가 올바르지 않습니다.' })
  @MaxLength(2048, { message: '프로젝트 리드 필터가 너무 깁니다.' })
  leadMembershipId?: string;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @Transform(({ value }) => {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: '보관 프로젝트 포함 여부가 올바르지 않습니다.' })
  includeArchived = false;

  @ApiPropertyOptional({ default: 'updatedAt', enum: ['updatedAt', 'targetDate'] })
  @IsOptional()
  @IsString({ message: '정렬 기준이 올바르지 않습니다.' })
  @MaxLength(20, { message: '정렬 기준이 올바르지 않습니다.' })
  sort?: string;

  @ApiPropertyOptional({ default: 'desc', enum: ['asc', 'desc'] })
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

  @ApiPropertyOptional({ description: '이전 응답에서 받은 불투명 커서' })
  @IsOptional()
  @IsString({ message: '커서가 올바르지 않습니다.' })
  @MaxLength(1024, { message: '커서가 올바르지 않습니다.' })
  cursor?: string;
}

export class CreateProjectDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '프로젝트 로고 파일 식별자가 올바르지 않습니다.' })
  logoFileId?: string | null;

  @ApiProperty({ maxLength: 200, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsString({ message: '프로젝트 이름을 입력해 주세요.' })
  @IsNotEmpty({ message: '프로젝트 이름을 입력해 주세요.' })
  @MaxLength(200, { message: '프로젝트 이름은 200자 이하여야 합니다.' })
  name!: string;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true, type: String })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '프로젝트 설명이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '프로젝트 설명은 비워 둘 수 없습니다.' })
  @MaxLength(5000, { message: '프로젝트 설명은 5,000자 이하여야 합니다.' })
  description?: string | null;

  @ApiPropertyOptional({ default: ProjectStatus.PLANNED, enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus, { message: '프로젝트 상태가 올바르지 않습니다.' })
  status?: ProjectStatus;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '프로젝트 리드 식별자가 올바르지 않습니다.' })
  leadMembershipId?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '시작일은 YYYY-MM-DD 형식이어야 합니다.' })
  startDate?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '목표일은 YYYY-MM-DD 형식이어야 합니다.' })
  targetDate?: string | null;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, maxItems: 100, type: String })
  @Transform(({ value }) => (Array.isArray(value) ? value.map(normalizeUuid) : value))
  @IsOptional()
  @IsArray({ message: '프로젝트 참여 팀 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '프로젝트 참여 팀은 최대 100개입니다.' })
  @ArrayUnique({ message: '같은 팀을 프로젝트에 중복 추가할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '참여 팀 식별자가 올바르지 않습니다.' })
  teamIds?: string[];
}

export class UpdateProjectDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '프로젝트 버전이 올바르지 않습니다.' })
  @Min(1, { message: '프로젝트 버전이 올바르지 않습니다.' })
  version!: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '프로젝트 로고 파일 식별자가 올바르지 않습니다.' })
  logoFileId?: string | null;

  @ApiPropertyOptional({ maxLength: 200, minLength: 1 })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '프로젝트 이름이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '프로젝트 이름을 입력해 주세요.' })
  @MaxLength(200, { message: '프로젝트 이름은 200자 이하여야 합니다.' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true, type: String })
  @Transform(({ value }) => normalizeString(value))
  @IsOptional()
  @IsString({ message: '프로젝트 설명이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '프로젝트 설명은 비워 둘 수 없습니다.' })
  @MaxLength(5000, { message: '프로젝트 설명은 5,000자 이하여야 합니다.' })
  description?: string | null;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus, { message: '프로젝트 상태가 올바르지 않습니다.' })
  status?: ProjectStatus;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '프로젝트 리드 식별자가 올바르지 않습니다.' })
  leadMembershipId?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '시작일은 YYYY-MM-DD 형식이어야 합니다.' })
  startDate?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '목표일은 YYYY-MM-DD 형식이어야 합니다.' })
  targetDate?: string | null;

  @ApiPropertyOptional({ format: 'uuid', isArray: true, maxItems: 100, type: String })
  @Transform(({ value }) => (Array.isArray(value) ? value.map(normalizeUuid) : value))
  @IsOptional()
  @IsArray({ message: '프로젝트 참여 팀 목록이 올바르지 않습니다.' })
  @ArrayMaxSize(100, { message: '프로젝트 참여 팀은 최대 100개입니다.' })
  @ArrayUnique({ message: '같은 팀을 프로젝트에 중복 추가할 수 없습니다.' })
  @IsUUID('4', { each: true, message: '참여 팀 식별자가 올바르지 않습니다.' })
  teamIds?: string[];
}

export class ArchiveProjectDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '프로젝트 버전이 올바르지 않습니다.' })
  @Min(1, { message: '프로젝트 버전이 올바르지 않습니다.' })
  version!: number;
}
