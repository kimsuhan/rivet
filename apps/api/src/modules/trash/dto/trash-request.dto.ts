import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

function normalizeQuery(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export class TrashListQueryDto {
  @ApiPropertyOptional({ description: '쉼표로 구분한 ISSUE,PROJECT' })
  @IsOptional()
  @IsString({ message: '휴지통 리소스 유형을 확인해 주세요.' })
  @MaxLength(30, { message: '휴지통 리소스 유형을 확인해 주세요.' })
  resourceType?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }) => normalizeQuery(value))
  @IsOptional()
  @IsString({ message: '검색어를 확인해 주세요.' })
  @MaxLength(500, { message: '검색어는 500자 이하여야 합니다.' })
  query?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: '삭제자 식별자를 확인해 주세요.' })
  deletedByMembershipId?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt({ message: '조회 개수를 확인해 주세요.' })
  @Min(1, { message: '조회 개수는 1 이상이어야 합니다.' })
  @Max(100, { message: '조회 개수는 100 이하여야 합니다.' })
  limit = 50;

  @ApiPropertyOptional({ description: '이전 응답에서 받은 불투명 커서' })
  @IsOptional()
  @IsString({ message: '커서를 확인해 주세요.' })
  @MaxLength(1024, { message: '커서를 확인해 주세요.' })
  cursor?: string;
}

export class RestoreTrashResourceDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '리소스 버전이 올바르지 않습니다.' })
  @Min(1, { message: '리소스 버전이 올바르지 않습니다.' })
  version!: number;
}
