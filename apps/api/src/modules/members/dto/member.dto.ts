import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class MemberListQueryDto {
  @ApiPropertyOptional({
    description: '쉼표로 구분한 멤버 상태. 생략하면 활성·비활성 멤버를 모두 조회합니다.',
    example: 'ACTIVE,INACTIVE',
  })
  @IsOptional()
  @IsString({ message: '멤버 상태 필터가 올바르지 않습니다.' })
  @MaxLength(32, { message: '멤버 상태 필터가 너무 깁니다.' })
  status?: string;

  @ApiPropertyOptional({ description: '현재 소속 멤버만 조회할 팀 ID', format: 'uuid' })
  @IsOptional()
  @IsString({ message: '팀 필터가 올바르지 않습니다.' })
  @MaxLength(36, { message: '팀 필터가 올바르지 않습니다.' })
  teamId?: string;

  @ApiPropertyOptional({ description: '표시 이름 검색. 관리자는 이메일도 검색할 수 있습니다.' })
  @IsOptional()
  @IsString({ message: '검색어가 올바르지 않습니다.' })
  @MaxLength(100, { message: '검색어는 100자 이하여야 합니다.' })
  query?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt({ message: '조회 개수가 올바르지 않습니다.' })
  @Min(1, { message: '조회 개수는 1 이상이어야 합니다.' })
  @Max(100, { message: '조회 개수는 100 이하여야 합니다.' })
  limit = 50;

  @ApiPropertyOptional({ description: '이전 응답에서 받은 불투명 커서' })
  @IsOptional()
  @IsString({ message: '커서가 올바르지 않습니다.' })
  @MaxLength(1024, { message: '커서가 올바르지 않습니다.' })
  cursor?: string;
}

export class MemberUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '김민수' })
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class MemberSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: MemberUserSummaryResponseDto })
  user!: MemberUserSummaryResponseDto;

  @ApiPropertyOptional({
    description: '관리자 멤버 설정 응답에만 포함됩니다.',
    format: 'email',
  })
  email?: string;

  @ApiProperty({ enum: ['ADMIN', 'MEMBER'] })
  role!: 'ADMIN' | 'MEMBER';

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: 'ACTIVE' | 'INACTIVE';

  @ApiProperty({ format: 'date-time' })
  joinedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  deactivatedAt!: string | null;
}

export class MemberTeamSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '프론트 웹' })
  name!: string;

  @ApiProperty({ example: 'WEB' })
  key!: string;

  @ApiProperty()
  archived!: boolean;
}

export class MemberDetailResponseDto extends MemberSummaryResponseDto {
  @ApiProperty({ isArray: true, type: MemberTeamSummaryResponseDto })
  teams!: MemberTeamSummaryResponseDto[];
}

export class MemberListResponseDto {
  @ApiProperty({ isArray: true, type: MemberSummaryResponseDto })
  items!: MemberSummaryResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
