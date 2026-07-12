import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

export class EmailDto {
  @ApiProperty({ example: 'minsu@example.com', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: '올바른 이메일 주소를 입력해 주세요.' })
  @MaxLength(254, { message: '이메일 주소는 254자 이하여야 합니다.' })
  email!: string;
}
