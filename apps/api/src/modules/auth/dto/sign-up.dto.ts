import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class SignUpDto {
  @ApiProperty({ example: '김민수', maxLength: 50 })
  @IsString({ message: '표시 이름을 입력해 주세요.' })
  @MaxLength(50, { message: '표시 이름은 50자 이하여야 합니다.' })
  displayName!: string;

  @ApiProperty({ example: 'minsu@example.com', maxLength: 254 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: '올바른 이메일 주소를 입력해 주세요.' })
  @MaxLength(254, { message: '이메일 주소는 254자 이하여야 합니다.' })
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 128, minLength: 12 })
  @IsString({ message: '비밀번호를 입력해 주세요.' })
  password!: string;
}
