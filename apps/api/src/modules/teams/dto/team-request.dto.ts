import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class TeamListQueryDto {
  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) => {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: '보관 팀 포함 여부가 올바르지 않습니다.' })
  includeArchived = false;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ example: '디자인', maxLength: 100, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString({ message: '팀 이름이 올바르지 않습니다.' })
  @IsNotEmpty({ message: '팀 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '팀 이름은 100자 이하여야 합니다.' })
  name?: string;

  @ApiPropertyOptional({ example: 'WEB', maxLength: 5, minLength: 2 })
  @IsOptional()
  @Matches(/^[A-Z]{2,5}$/, { message: '팀 키는 영문 대문자 2~5자로 입력해 주세요.' })
  key?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '팀 버전이 올바르지 않습니다.' })
  @Min(1, { message: '팀 버전이 올바르지 않습니다.' })
  version!: number;
}

export class VersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '리소스 버전이 올바르지 않습니다.' })
  @Min(1, { message: '리소스 버전이 올바르지 않습니다.' })
  version!: number;
}
