import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '제품 개발팀' })
  name!: string;

  @ApiProperty({ example: 'product-team' })
  slug!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  version!: number;
}
