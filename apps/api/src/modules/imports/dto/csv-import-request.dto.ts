import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function normalizeUuid(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function parseBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined) return false;
  return value;
}

export class InspectCsvImportDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4', { message: '실행 식별자가 올바르지 않습니다.' })
  executionId!: string;
}

export class ValidateCsvImportDto extends InspectCsvImportDto {
  @ApiProperty({ description: '컬럼·값 매핑 JSON', maxLength: 200_000 })
  @IsString({ message: '가져오기 매핑이 올바르지 않습니다.' })
  @MaxLength(200_000, { message: '가져오기 매핑이 너무 큽니다.' })
  mapping!: string;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean({ message: '새 실행 선택 여부가 올바르지 않습니다.' })
  allowDuplicateFile = false;
}

export class ExecuteCsvImportDto extends ValidateCsvImportDto {
  @ApiProperty({ maxLength: 64, minLength: 64 })
  @IsString({ message: '검증 서명이 올바르지 않습니다.' })
  @Matches(/^[0-9a-f]{64}$/u, { message: '검증 서명이 올바르지 않습니다.' })
  validationSignature!: string;
}

export class CsvImportRunListQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 50, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(({ value }) => normalizeUuid(value))
  @IsUUID('4')
  cursor?: string;
}
