import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class LabelListQueryDto {
  @ApiPropertyOptional({ default: false, type: Boolean })
  @Transform(({ value }) => {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: '보관 라벨 전용 조회 여부가 올바르지 않습니다.' })
  archivedOnly = false;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @Transform(({ value }) => {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: '보관 라벨 포함 여부가 올바르지 않습니다.' })
  includeArchived = false;

  @ApiPropertyOptional({ description: '라벨 이름 검색', maxLength: 100 })
  @IsOptional()
  @IsString({ message: '검색어가 올바르지 않습니다.' })
  @MaxLength(100, { message: '검색어는 100자 이하여야 합니다.' })
  query?: string;

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

export class CreateLabelDto {
  @ApiProperty({ example: '버그', maxLength: 50, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.normalize('NFC').trim() : value))
  @IsString({ message: '라벨 이름을 입력해 주세요.' })
  @IsNotEmpty({ message: '라벨 이름을 입력해 주세요.' })
  @MaxLength(50, { message: '라벨 이름은 50자 이하여야 합니다.' })
  name!: string;

  @ApiProperty({ example: '#D84A4A', pattern: '^#[0-9A-Fa-f]{6}$' })
  @IsString({ message: '라벨 색상이 올바르지 않습니다.' })
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: '라벨 색상은 #RRGGBB 형식이어야 합니다.',
  })
  color!: string;
}

export class UpdateLabelDto {
  @ApiPropertyOptional({ example: '결함', maxLength: 50, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.normalize('NFC').trim() : value))
  @IsOptional()
  @IsString({ message: '라벨 이름이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '라벨 이름을 입력해 주세요.' })
  @MaxLength(50, { message: '라벨 이름은 50자 이하여야 합니다.' })
  name?: string;

  @ApiPropertyOptional({ example: '#D84A4A', pattern: '^#[0-9A-Fa-f]{6}$' })
  @IsOptional()
  @IsString({ message: '라벨 색상이 올바르지 않습니다.' })
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: '라벨 색상은 #RRGGBB 형식이어야 합니다.',
  })
  color?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '라벨 버전이 올바르지 않습니다.' })
  @Min(1, { message: '라벨 버전이 올바르지 않습니다.' })
  version!: number;
}

export class ArchiveLabelDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '라벨 버전이 올바르지 않습니다.' })
  @Min(1, { message: '라벨 버전이 올바르지 않습니다.' })
  version!: number;
}

export class LabelResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '버그' })
  name!: string;

  @ApiProperty({ example: '#D84A4A', pattern: '^#[0-9A-F]{6}$' })
  color!: string;

  @ApiProperty({ example: false })
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class LabelListResponseDto {
  @ApiProperty({ isArray: true, type: LabelResponseDto })
  items!: LabelResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
