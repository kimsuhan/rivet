import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const SAVED_VIEW_RESOURCE_TYPES = ['ISSUES', 'MY_WORK'] as const;

export type SavedViewConfigurationValue =
  boolean | string | string[] | Array<{ direction: 'asc' | 'desc'; field: string }>;

function normalizeString(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export class CreateSavedViewDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }) => normalizeString(value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: SAVED_VIEW_RESOURCE_TYPES })
  @IsIn(SAVED_VIEW_RESOURCE_TYPES)
  resourceType!: (typeof SAVED_VIEW_RESOURCE_TYPES)[number];

  @ApiProperty({ additionalProperties: true, type: 'object' })
  @IsObject()
  configuration!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class ListSavedViewsQueryDto {
  @ApiProperty({ enum: SAVED_VIEW_RESOURCE_TYPES })
  @IsIn(SAVED_VIEW_RESOURCE_TYPES)
  resourceType!: (typeof SAVED_VIEW_RESOURCE_TYPES)[number];
}

export class UpdateSavedViewDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(({ value }) => normalizeString(value))
  @IsNotEmpty()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  @IsObject()
  @IsOptional()
  configuration?: Record<string, unknown>;
}

export class SetSavedViewDefaultDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class DeleteSavedViewQueryDto {
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsInt()
  @Max(2147483647)
  @Min(1)
  version!: number;
}

export class SavedViewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: SAVED_VIEW_RESOURCE_TYPES })
  resourceType!: (typeof SAVED_VIEW_RESOURCE_TYPES)[number];

  @ApiProperty()
  name!: string;

  @ApiProperty({
    additionalProperties: true,
    description: 'ISSUES 보기의 sorts는 { field, direction } 객체 배열입니다.',
    type: 'object',
  })
  configuration!: Record<string, SavedViewConfigurationValue>;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class SavedViewListResponseDto {
  @ApiProperty({ type: SavedViewResponseDto, isArray: true })
  items!: SavedViewResponseDto[];
}
