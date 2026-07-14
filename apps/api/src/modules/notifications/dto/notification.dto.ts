import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { NotificationType } from '@rivet/database';

export class NotificationListQueryDto {
  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsOptional()
  @IsBoolean({ message: '읽음 상태가 올바르지 않습니다.' })
  read?: boolean;

  @ApiPropertyOptional({
    description: '쉼표로 구분한 알림 유형',
    enum: NotificationType,
    example: 'MENTIONED,COMMENT_ADDED',
    type: String,
  })
  @IsOptional()
  @IsString({ message: '알림 유형이 올바르지 않습니다.' })
  @MaxLength(500, { message: '알림 유형이 올바르지 않습니다.' })
  type?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt({ message: '조회 개수가 올바르지 않습니다.' })
  @Min(1, { message: '조회 개수는 1 이상이어야 합니다.' })
  @Max(100, { message: '조회 개수는 100 이하여야 합니다.' })
  limit: number = 50;

  @ApiPropertyOptional({ description: '이전 응답에서 받은 불투명 커서' })
  @IsOptional()
  @IsString({ message: '커서가 올바르지 않습니다.' })
  @MaxLength(1024, { message: '커서가 올바르지 않습니다.' })
  cursor?: string;
}

export class UpdateNotificationReadDto {
  @ApiProperty()
  @IsBoolean({ message: '읽음 상태가 올바르지 않습니다.' })
  read!: boolean;
}

export class NotificationActorResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class NotificationIssueResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'API-42' })
  identifier!: string;

  @ApiProperty()
  title!: string;
}

export class NotificationTeamWorkResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'WEB-42' })
  identifier!: string;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ nullable: true, type: NotificationActorResponseDto })
  actor!: NotificationActorResponseDto | null;

  @ApiProperty({ type: NotificationIssueResponseDto })
  issue!: NotificationIssueResponseDto;

  @ApiProperty({ nullable: true, type: NotificationTeamWorkResponseDto })
  teamWork!: NotificationTeamWorkResponseDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  commentId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  handoffId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  readAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationListResponseDto {
  @ApiProperty({ isArray: true, type: NotificationResponseDto })
  items!: NotificationResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class NotificationUnreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  count!: number;
}

export class NotificationReadAllResponseDto {
  @ApiProperty({ minimum: 0 })
  updatedCount!: number;
}
