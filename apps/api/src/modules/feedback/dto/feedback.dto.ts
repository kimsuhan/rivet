import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const FEEDBACK_CATEGORIES = ['BUG', 'USABILITY', 'IDEA', 'OTHER'] as const;
export const FEEDBACK_STATUSES = ['RECEIVED', 'IN_REVIEW', 'IMPLEMENTED', 'DEFERRED'] as const;

function normalize(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export class SubmitFeedbackDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  submissionId!: string;

  @ApiProperty({ enum: FEEDBACK_CATEGORIES })
  @IsIn(FEEDBACK_CATEGORIES)
  category!: (typeof FEEDBACK_CATEGORIES)[number];

  @ApiProperty({ maxLength: 4000, minLength: 10 })
  @Transform(({ value }) => normalize(value))
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  // eslint-disable-next-line no-control-regex -- 피드백 입력에서 C0 제어 문자를 명시적으로 거부한다.
  @Matches(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u, {
    message: '본문에 지원하지 않는 제어 문자가 있습니다.',
  })
  body!: string;

  @ApiProperty({ maxLength: 2048 })
  @Transform(({ value }) => normalize(value))
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  // eslint-disable-next-line no-control-regex -- 경로에 포함될 수 없는 C0 제어 문자를 명시적으로 거부한다.
  @Matches(/^\/(?!\/)[^\u0000-\u001f\u007f?#]*$/u, {
    message: '현재 경로는 query와 fragment가 없는 같은 서비스의 pathname이어야 합니다.',
  })
  currentPath!: string;
}

export class ListFeedbackQueryDto {
  @ApiPropertyOptional({ enum: FEEDBACK_CATEGORIES })
  @IsIn(FEEDBACK_CATEGORIES)
  @IsOptional()
  category?: (typeof FEEDBACK_CATEGORIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsInt()
  @Max(100)
  @Min(1)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ enum: FEEDBACK_STATUSES })
  @IsIn(FEEDBACK_STATUSES)
  @IsOptional()
  status?: (typeof FEEDBACK_STATUSES)[number];
}

export class UpdateFeedbackStatusDto {
  @ApiProperty({ enum: FEEDBACK_STATUSES })
  @IsIn(FEEDBACK_STATUSES)
  status!: (typeof FEEDBACK_STATUSES)[number];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class FeedbackResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  submissionId!: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'uuid' })
  submittedByMembershipId!: string;

  @ApiProperty({ enum: FEEDBACK_CATEGORIES })
  category!: (typeof FEEDBACK_CATEGORIES)[number];

  @ApiProperty()
  body!: string;

  @ApiProperty()
  currentPath!: string;

  @ApiProperty()
  releaseId!: string;

  @ApiProperty({ enum: FEEDBACK_STATUSES })
  status!: (typeof FEEDBACK_STATUSES)[number];

  @ApiProperty({ format: 'date-time' })
  statusChangedAt!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  statusChangedByMembershipId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty()
  version!: number;
}

export class FeedbackSubmissionReceiptDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  submissionId!: string;

  @ApiProperty({ enum: FEEDBACK_STATUSES })
  status!: (typeof FEEDBACK_STATUSES)[number];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class FeedbackListResponseDto {
  @ApiProperty({ type: FeedbackResponseDto, isArray: true })
  items!: FeedbackResponseDto[];

  @ApiProperty({ nullable: true })
  nextCursor!: string | null;
}
