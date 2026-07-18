import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';

export const CLIENT_PRODUCT_EVENT_NAMES = [
  'saved_view_opened',
  'issue_template_applied',
  'push_permission_result',
  'push_notification_clicked',
  'search_result_selected',
] as const;

export class CaptureProductEventDto {
  @ApiProperty({ enum: CLIENT_PRODUCT_EVENT_NAMES })
  @IsIn(CLIENT_PRODUCT_EVENT_NAMES)
  name!: (typeof CLIENT_PRODUCT_EVENT_NAMES)[number];

  @ApiProperty({ additionalProperties: true, type: 'object' })
  @IsObject()
  properties!: Record<string, unknown>;
}

export class CaptureProductEventResponseDto {
  @ApiProperty({ enum: ['ACCEPTED'] })
  status!: 'ACCEPTED';
}
