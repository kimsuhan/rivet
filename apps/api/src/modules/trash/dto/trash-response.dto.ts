import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrashDeleterResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;

  @ApiProperty()
  displayName!: string;
}

export class TrashConnectionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class TrashProjectRoleTeamResponseDto {
  @ApiProperty({ enum: ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] })
  role!: 'BACKEND' | 'WEB_FRONTEND' | 'APP_FRONTEND';

  @ApiProperty({ format: 'uuid' })
  teamId!: string;

  @ApiProperty()
  teamName!: string;

  @ApiProperty()
  teamArchived!: boolean;
}

export class TrashItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ISSUE', 'PROJECT'] })
  resourceType!: 'ISSUE' | 'PROJECT';

  @ApiPropertyOptional({ nullable: true, type: String })
  identifier!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: TrashDeleterResponseDto })
  deletedBy!: TrashDeleterResponseDto;

  @ApiProperty({ format: 'date-time' })
  deletedAt!: string;

  @ApiProperty({ format: 'date-time' })
  purgeAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty()
  version!: number;

  @ApiPropertyOptional({ nullable: true, type: TrashConnectionResponseDto })
  project!: TrashConnectionResponseDto | null;

  @ApiProperty({ isArray: true, type: TrashProjectRoleTeamResponseDto })
  roleTeams!: TrashProjectRoleTeamResponseDto[];
}

export class TrashListResponseDto {
  @ApiProperty({ isArray: true, type: TrashItemResponseDto })
  items!: TrashItemResponseDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class TrashRestoreResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ISSUE', 'PROJECT'] })
  resourceType!: 'ISSUE' | 'PROJECT';

  @ApiProperty()
  version!: number;

  @ApiProperty({ isArray: true, type: String })
  warnings!: string[];
}
