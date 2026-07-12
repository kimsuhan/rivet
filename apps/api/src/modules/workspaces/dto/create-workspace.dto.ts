import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: '제품 개발팀', maxLength: 100, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '워크스페이스 이름을 입력해 주세요.' })
  @IsNotEmpty({ message: '워크스페이스 이름을 입력해 주세요.' })
  @MaxLength(100, { message: '워크스페이스 이름은 100자 이하여야 합니다.' })
  name!: string;

  @ApiProperty({ example: 'product-team', maxLength: 50, minLength: 3 })
  @IsString({ message: '슬러그를 입력해 주세요.' })
  @MinLength(3, { message: '슬러그는 3자 이상이어야 합니다.' })
  @MaxLength(50, { message: '슬러그는 50자 이하여야 합니다.' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: '슬러그는 영문 소문자, 숫자와 단어 사이 하이픈만 사용할 수 있습니다.',
  })
  slug!: string;
}
