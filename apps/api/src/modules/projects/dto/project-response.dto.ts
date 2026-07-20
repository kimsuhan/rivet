import { ApiProperty } from '@nestjs/swagger';

import { MembershipRole, MembershipStatus, ProjectStatus } from '@rivet/database';

export class ProjectUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class ProjectMemberSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: ProjectUserSummaryResponseDto })
  user!: ProjectUserSummaryResponseDto;

  @ApiProperty({ enum: MembershipRole })
  role!: MembershipRole;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;
}

export class ProjectTeamSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  archived!: boolean;
}

export class ProjectTeamResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  deactivatedAt!: string | null;

  @ApiProperty({ type: ProjectTeamSummaryResponseDto })
  team!: ProjectTeamSummaryResponseDto;
}

export class ProjectProgressResponseDto {
  @ApiProperty({ minimum: 0 })
  completed!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ maximum: 100, minimum: 0 })
  percentage!: number;
}

export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ enum: ProjectStatus })
  status!: ProjectStatus;

  @ApiProperty({ nullable: true, type: ProjectMemberSummaryResponseDto })
  lead!: ProjectMemberSummaryResponseDto | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  startDate!: string | null;

  @ApiProperty({ format: 'date', nullable: true, type: String })
  targetDate!: string | null;

  @ApiProperty({ isArray: true, type: ProjectTeamResponseDto })
  projectTeams!: ProjectTeamResponseDto[];

  @ApiProperty({ type: ProjectProgressResponseDto })
  progress!: ProjectProgressResponseDto;

  @ApiProperty()
  archived!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class ProjectListResponseDto {
  @ApiProperty({ isArray: true, type: ProjectResponseDto })
  items!: ProjectResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
