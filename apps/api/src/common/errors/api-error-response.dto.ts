import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: '입력값을 확인해 주세요.' })
  message!: string;

  @ApiProperty({
    additionalProperties: { items: { type: 'string' }, type: 'array' },
    example: { email: ['올바른 이메일 주소를 입력해 주세요.'] },
    type: 'object',
  })
  fieldErrors!: Record<string, string[]>;

  @ApiProperty({ example: 'req_550e8400-e29b-41d4-a716-446655440000' })
  requestId!: string;

  @ApiPropertyOptional({ minimum: 1 })
  currentVersion?: number;

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  details?: Record<string, unknown>;
}
