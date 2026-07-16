import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { WebPushBrowser, WebPushSubscriptionStatus } from '@rivet/database';

export class WebPushSubscriptionKeysDto {
  @ApiProperty({ description: '브라우저가 발급한 URL-safe Base64 공개 키' })
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  p256dh!: string;

  @ApiProperty({ description: '브라우저가 발급한 URL-safe Base64 인증 값' })
  @IsString()
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9_-]+$/)
  auth!: string;
}

export class RegisterWebPushSubscriptionDto {
  @ApiProperty({ enum: WebPushBrowser })
  @IsEnum(WebPushBrowser)
  browser!: WebPushBrowser;

  @ApiProperty({ description: '브라우저 Push 서비스 HTTPS endpoint' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(4096)
  endpoint!: string;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8_640_000_000_000_000)
  expirationTime?: number | null;

  @ApiProperty({ type: WebPushSubscriptionKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebPushSubscriptionKeysDto)
  keys!: WebPushSubscriptionKeysDto;
}

export class WebPushConfigResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ nullable: true, type: String })
  publicKey!: string | null;
}

export class WebPushSubscriptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: WebPushBrowser })
  browser!: WebPushBrowser;

  @ApiProperty({ enum: WebPushSubscriptionStatus })
  status!: WebPushSubscriptionStatus;

  @ApiProperty()
  isCurrentSession!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  expirationTime!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  lastSucceededAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  lastFailedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class WebPushSubscriptionListResponseDto {
  @ApiProperty({ isArray: true, type: WebPushSubscriptionResponseDto })
  items!: WebPushSubscriptionResponseDto[];
}

export class WebPushTestAcceptedResponseDto {
  @ApiProperty()
  accepted!: true;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;
}
