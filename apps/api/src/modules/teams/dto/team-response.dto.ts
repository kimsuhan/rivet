import { ApiProperty } from '@nestjs/swagger';

export class WorkflowStateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '미분류' })
  name!: string;

  @ApiProperty({ enum: ['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED'] })
  category!: 'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'COMPLETED' | 'CANCELED';

  @ApiProperty({ minimum: 0 })
  position!: number;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class TeamResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '디자인' })
  name!: string;

  @ApiProperty({ example: 'WEB' })
  key!: string;

  @ApiProperty({ example: false })
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  memberIds!: string[];

  @ApiProperty({ isArray: true, type: WorkflowStateResponseDto })
  workflowStates!: WorkflowStateResponseDto[];
}

export class TeamSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '디자인' })
  name!: string;

  @ApiProperty({ example: 'WEB' })
  key!: string;

  @ApiProperty({ example: false })
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ minimum: 0 })
  memberCount!: number;
}

export class TeamListResponseDto {
  @ApiProperty({ isArray: true, type: TeamSummaryResponseDto })
  items!: TeamSummaryResponseDto[];

  @ApiProperty({ example: null, nullable: true, type: String })
  nextCursor!: string | null;
}

export class WorkflowStateListResponseDto {
  @ApiProperty({ isArray: true, type: WorkflowStateResponseDto })
  items!: WorkflowStateResponseDto[];

  @ApiProperty({ example: null, nullable: true, type: String })
  nextCursor!: string | null;
}
