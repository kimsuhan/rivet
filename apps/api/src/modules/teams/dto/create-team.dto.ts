import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ example: '디자인', maxLength: 100, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '팀 이름을 입력해 주세요.' })
  @IsNotEmpty({ message: '팀 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '팀 이름은 100자 이하여야 합니다.' })
  name!: string;

  @ApiProperty({ example: 'WEB', maxLength: 5, minLength: 2 })
  @Matches(/^[A-Z]{2,5}$/, { message: '팀 키는 영문 대문자 2~5자로 입력해 주세요.' })
  key!: string;

  @ApiProperty({ format: 'uuid', isArray: true, minItems: 1, type: String, uniqueItems: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.toLowerCase() : item))
      : value,
  )
  @IsArray({ message: '초기 팀 멤버를 선택해 주세요.' })
  @ArrayMinSize(1, { message: '초기 팀 멤버가 한 명 이상 필요합니다.' })
  @ArrayUnique({ message: '같은 팀 멤버를 중복 선택할 수 없습니다.' })
  @IsUUID('all', { each: true, message: '팀 멤버 식별자가 올바르지 않습니다.' })
  memberIds!: string[];
}
