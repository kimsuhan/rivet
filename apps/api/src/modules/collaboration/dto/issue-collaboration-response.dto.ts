import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

import { HandoffKind, MembershipRole, MembershipStatus } from '@rivet/database';

export class CollaborationUserSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  avatarFileId!: string | null;
}

export class CollaborationMemberSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: CollaborationUserSummaryResponseDto })
  user!: CollaborationUserSummaryResponseDto;

  @ApiProperty({ enum: MembershipRole })
  role!: MembershipRole;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;
}

export class HandoffResourceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: HandoffKind })
  kind!: HandoffKind;

  @ApiProperty({ minimum: 1 })
  sequenceNumber!: number;

  @ApiProperty({ format: 'uuid' })
  issueId!: string;

  @ApiProperty({ format: 'uuid' })
  sourceTeamWorkId!: string;

  @ApiProperty({ format: 'uuid', isArray: true, type: String })
  targetTeamWorkIds!: string[];

  @ApiProperty()
  bodyMarkdown!: string;

  @ApiProperty({ type: CollaborationMemberSummaryResponseDto })
  author!: CollaborationMemberSummaryResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ActivityResourceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ nullable: true, type: String })
  fieldName!: string | null;

  @ApiProperty({ nullable: true, type: Object })
  before!: unknown;

  @ApiProperty({ nullable: true, type: Object })
  after!: unknown;

  @ApiProperty({ nullable: true, type: CollaborationMemberSummaryResponseDto })
  actor!: CollaborationMemberSummaryResponseDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  teamWorkId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  teamWorkIdentifier!: string | null;
}

export class CommentResourceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  teamWorkId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  bodyMarkdown!: string | null;

  @ApiProperty({ type: CollaborationMemberSummaryResponseDto })
  author!: CollaborationMemberSummaryResponseDto;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  editedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  deletedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TimelineItemResponseDto {
  @ApiProperty({ enum: ['ACTIVITY', 'COMMENT', 'HANDOFF'] })
  type!: 'ACTIVITY' | 'COMMENT' | 'HANDOFF';

  @ApiProperty({ nullable: true, required: false, type: ActivityResourceResponseDto })
  activity?: ActivityResourceResponseDto;

  @ApiProperty({ nullable: true, required: false, type: CommentResourceResponseDto })
  comment?: CommentResourceResponseDto;

  @ApiProperty({ nullable: true, required: false, type: HandoffResourceResponseDto })
  handoff?: HandoffResourceResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ActivityTimelineItemResponseDto {
  @ApiProperty({ enum: ['ACTIVITY'] })
  type!: 'ACTIVITY';

  @ApiProperty({ type: ActivityResourceResponseDto })
  activity!: ActivityResourceResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class HandoffTimelineItemResponseDto {
  @ApiProperty({ enum: ['HANDOFF'] })
  type!: 'HANDOFF';

  @ApiProperty({ type: HandoffResourceResponseDto })
  handoff!: HandoffResourceResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CommentTimelineItemResponseDto {
  @ApiProperty({ enum: ['COMMENT'] })
  type!: 'COMMENT';

  @ApiProperty({ type: CommentResourceResponseDto })
  comment!: CommentResourceResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TimelineResponseDto {
  @ApiProperty({
    items: {
      discriminator: {
        mapping: {
          ACTIVITY: getSchemaPath(ActivityTimelineItemResponseDto),
          COMMENT: getSchemaPath(CommentTimelineItemResponseDto),
          HANDOFF: getSchemaPath(HandoffTimelineItemResponseDto),
        },
        propertyName: 'type',
      },
      oneOf: [
        { $ref: getSchemaPath(ActivityTimelineItemResponseDto) },
        { $ref: getSchemaPath(CommentTimelineItemResponseDto) },
        { $ref: getSchemaPath(HandoffTimelineItemResponseDto) },
      ],
    },
    type: 'array',
  })
  items!: TimelineItemResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
