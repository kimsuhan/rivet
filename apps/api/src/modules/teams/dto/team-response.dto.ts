import { ApiProperty } from '@nestjs/swagger';

import { WorkflowStateColor } from '@rivet/database';

export class WorkflowStateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '미분류' })
  name!: string;

  @ApiProperty({ enum: ['BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED'] })
  category!: 'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'COMPLETED' | 'CANCELED';

  @ApiProperty({ enum: WorkflowStateColor, nullable: true })
  color!: WorkflowStateColor | null;

  @ApiProperty({ minimum: 0 })
  position!: number;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  disabledAt!: Date | null;

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

  @ApiProperty({ example: '제품 웹 화면을 담당합니다.', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: false })
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  memberIds!: string[];

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  leaderIds!: string[];

  @ApiProperty()
  canManage!: boolean;

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

  @ApiProperty({ example: '제품 웹 화면을 담당합니다.', nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: false })
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ minimum: 0 })
  memberCount!: number;

  @ApiProperty({ minimum: 0 })
  leaderCount!: number;

  @ApiProperty()
  canManage!: boolean;
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
