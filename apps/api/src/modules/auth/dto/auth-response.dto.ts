import { ApiProperty } from '@nestjs/swagger';

export class AcceptedAuthRequestDto {
  @ApiProperty({ enum: [true], example: true })
  accepted!: true;

  @ApiProperty({ example: 'mi***@example.com' })
  emailMasked!: string;

  @ApiProperty({ enum: ['LOGIN', 'VERIFY_EMAIL'] })
  nextStep!: 'LOGIN' | 'VERIFY_EMAIL';
}

export class VerifiedEmailDto {
  @ApiProperty({ enum: [true], example: true })
  verified!: true;
}

export class ResetPasswordDto {
  @ApiProperty({ enum: [true], example: true })
  reset!: true;
}

export class SessionUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '김민수' })
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  avatarFileId!: string | null;

  @ApiProperty({ example: 'minsu@example.com' })
  email!: string;
}

export class SessionMembershipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ADMIN', 'MEMBER'] })
  role!: 'ADMIN' | 'MEMBER';

  @ApiProperty({ enum: ['ACTIVE'] })
  status!: 'ACTIVE';

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  ledTeamIds!: string[];

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  teamIds!: string[];
}

export class SessionWorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '제품 개발팀' })
  name!: string;

  @ApiProperty({ example: 'product-team' })
  slug!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class AuthenticatedSessionDto {
  @ApiProperty({ enum: [true], example: true })
  authenticated!: true;

  @ApiProperty()
  csrfToken!: string;

  @ApiProperty({ type: SessionUserDto })
  user!: SessionUserDto;

  @ApiProperty({ nullable: true, type: SessionMembershipDto })
  membership!: SessionMembershipDto | null;

  @ApiProperty({ nullable: true, type: SessionWorkspaceDto })
  workspace!: SessionWorkspaceDto | null;

  @ApiProperty({ enum: ['ACCEPT_INVITATION', 'CREATE_WORKSPACE', 'CREATE_TEAM', 'COMPLETE'] })
  onboardingStep!: 'ACCEPT_INVITATION' | 'CREATE_WORKSPACE' | 'CREATE_TEAM' | 'COMPLETE';
}

export class UnauthenticatedSessionDto {
  @ApiProperty({ enum: [false], example: false })
  authenticated!: false;
}
