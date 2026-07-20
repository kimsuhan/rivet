import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InvitationListQueryDto {
  @ApiPropertyOptional({
    description: '쉼표로 구분한 초대 상태',
    example: 'PENDING,EXPIRED',
    type: String,
  })
  @IsOptional()
  @IsString({ message: '초대 상태가 올바르지 않습니다.' })
  @MaxLength(100, { message: '초대 상태가 올바르지 않습니다.' })
  status?: string;

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

export class CreateInvitationsDto {
  @ApiProperty({
    example: ['web@example.com', 'app@example.com'],
    isArray: true,
    maxItems: 50,
    minItems: 1,
    type: String,
  })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((email) => (typeof email === 'string' ? email.trim() : email))
      : value,
  )
  @IsArray({ message: '초대할 이메일을 입력해 주세요.' })
  @ArrayMinSize(1, { message: '초대할 이메일을 한 개 이상 입력해 주세요.' })
  @ArrayMaxSize(50, { message: '초대는 한 번에 최대 50개까지 보낼 수 있습니다.' })
  @IsEmail({}, { each: true, message: '올바른 이메일 주소를 입력해 주세요.' })
  @MaxLength(254, { each: true, message: '이메일 주소는 254자 이하여야 합니다.' })
  emails!: string[];
}

export class InvitationTokenDto {
  @ApiProperty({ description: '이메일 링크의 URL fragment에서 읽은 일회용 토큰' })
  @IsString({ message: '초대 토큰을 입력해 주세요.' })
  @MaxLength(256, { message: '초대 토큰이 올바르지 않습니다.' })
  token!: string;
}

export class InvitationResponseDto {
  @ApiProperty({
    description:
      '초대 이력 행 ID. 재발송 성공 응답은 실제 재발급 대상 행 ID이며 종료 이력 재발송에서는 요청 경로의 ID와 다르다.',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'CANCELED' | 'EXPIRED';

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  acceptedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  canceledAt!: string | null;

  @ApiProperty({ format: 'uuid' })
  invitedByMembershipId!: string;

  @ApiProperty({ example: '김관리' })
  invitedByDisplayName!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class InvitationListResponseDto {
  @ApiProperty({ isArray: true, type: InvitationResponseDto })
  items!: InvitationResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class InvitationResultItemDto {
  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['INVITED', 'TEAM_ADDED', 'ALREADY_MEMBER', 'ALREADY_INVITED', 'FAILED'] })
  result!: 'INVITED' | 'TEAM_ADDED' | 'ALREADY_MEMBER' | 'ALREADY_INVITED' | 'FAILED';

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  invitationId!: string | null;
}

export class CreateInvitationsResponseDto {
  @ApiProperty({ isArray: true, type: InvitationResultItemDto })
  items!: InvitationResultItemDto[];
}

export class InvitationPreviewResponseDto {
  @ApiProperty({ example: '제품 개발팀' })
  workspaceName!: string;

  @ApiProperty({ example: 'we***@example.com' })
  emailMasked!: string;

  @ApiProperty({ example: '김관리' })
  invitedByDisplayName!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class InvitationContinuationResponseDto extends InvitationPreviewResponseDto {
  @ApiProperty({
    description: '유효한 초대 진행 상태에서 가입·로그인 계정을 고정하는 원문 이메일',
    format: 'email',
  })
  email!: string;
}

export class AcceptedInvitationMembershipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['MEMBER'] })
  role!: 'MEMBER';

  @ApiProperty({ enum: ['ACTIVE'] })
  status!: 'ACTIVE';
}

export class AcceptedInvitationWorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '제품 개발팀' })
  name!: string;

  @ApiProperty({ example: 'product-team' })
  slug!: string;
}

export class AcceptInvitationResponseDto {
  @ApiProperty({ example: true })
  accepted!: true;

  @ApiProperty({ type: AcceptedInvitationMembershipDto })
  membership!: AcceptedInvitationMembershipDto;

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  joinedTeamIds!: string[];

  @ApiProperty({ type: AcceptedInvitationWorkspaceDto })
  workspace!: AcceptedInvitationWorkspaceDto;
}
