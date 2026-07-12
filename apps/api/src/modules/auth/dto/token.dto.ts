import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class TokenDto {
  @ApiProperty({
    description: '이메일 링크의 fragment에서 읽은 일회용 토큰',
    maxLength: 256,
  })
  @IsString({ message: '토큰을 입력해 주세요.' })
  @MaxLength(256, { message: '토큰 형식이 올바르지 않습니다.' })
  token!: string;
}

export class ConfirmPasswordResetDto extends TokenDto {
  @ApiProperty({ format: 'password', maxLength: 128, minLength: 12 })
  @IsString({ message: '새 비밀번호를 입력해 주세요.' })
  password!: string;
}
