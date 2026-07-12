import { ApiProperty } from '@nestjs/swagger';

export class FileResourceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['USER_PROFILE', 'WORKSPACE'] })
  scope!: 'USER_PROFILE' | 'WORKSPACE';

  @ApiProperty({ example: '오류 화면.png' })
  originalName!: string;

  @ApiProperty({ example: 'image/png' })
  detectedMimeType!: string;

  @ApiProperty({ maximum: 26_214_400, minimum: 1 })
  sizeBytes!: number;

  @ApiProperty()
  inlineDisplayable!: boolean;

  @ApiProperty()
  linked!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class FileUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '김민수' })
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class IssueAttachmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ISSUE_ATTACHMENT'] })
  kind!: 'ISSUE_ATTACHMENT';

  @ApiProperty({ type: FileResourceResponseDto })
  file!: FileResourceResponseDto;

  @ApiProperty({ type: FileUserSummaryResponseDto })
  uploader!: FileUserSummaryResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class IssueAttachmentListResponseDto {
  @ApiProperty({ isArray: true, type: IssueAttachmentResponseDto })
  items!: IssueAttachmentResponseDto[];

  @ApiProperty({ example: null, nullable: true, type: String })
  nextCursor!: null;
}
