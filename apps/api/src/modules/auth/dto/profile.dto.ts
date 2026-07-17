import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ example: '김민수', maxLength: 50, minLength: 1 })
  @IsString({ message: '표시 이름을 입력해 주세요.' })
  @MaxLength(50, { message: '표시 이름은 50자 이하여야 합니다.' })
  displayName!: string;
}
