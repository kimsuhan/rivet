import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsUUID } from 'class-validator';

import { FileScope } from '@rivet/database';

export class UploadFileDto {
  @ApiProperty({ enum: FileScope })
  @IsEnum(FileScope, { message: '파일 범위를 확인해 주세요.' })
  scope!: FileScope;
}

export class FileIdDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID('4', { message: '파일 식별자를 확인해 주세요.' })
  fileId!: string;
}
