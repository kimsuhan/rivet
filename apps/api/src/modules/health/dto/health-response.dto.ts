import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'], example: 'ok' })
  status!: 'ok' | 'unavailable';
}
