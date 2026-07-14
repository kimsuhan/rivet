import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { HandoffKind, ProjectRole } from '@rivet/database';

const HANDOFF_BODY_DESCRIPTION =
  '최초 전달은 변경·구현 요약, API 명세 링크, 사용 가능 환경, 추가·변경 API, 요청·응답 변경, 오류·권한, 프론트 주의사항을 필요할 때만 Markdown으로 기록합니다. 추가 전달은 변경 사항과 프론트 조치만 기록합니다. 제목만 있는 빈 섹션은 저장하지 않습니다.';
const HANDOFF_BODY_EXAMPLE = [
  '## 변경 요약',
  '로그인 응답에 워크스페이스 정보를 추가했습니다.',
  '## API 명세 링크',
  'https://api.example.com/openapi.json',
  '## 사용 가능 환경',
  '개발 환경',
  '## 추가·변경 API',
  'POST /sessions',
  '## 요청·응답 변경',
  '응답에 workspaceId를 추가했습니다.',
  '## 오류·권한',
  '401 응답 계약은 동일합니다.',
  '## 프론트 주의사항',
  '기존 필드는 유지됩니다.',
].join('\n\n');

function normalizeUuid(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function normalizeMarkdown(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export class CreateIssueHandoffDto {
  @ApiProperty({ enum: HandoffKind })
  @IsEnum(HandoffKind, { message: '작업 전달 유형이 올바르지 않습니다.' })
  kind!: HandoffKind;

  @ApiProperty({
    description: HANDOFF_BODY_DESCRIPTION,
    example: HANDOFF_BODY_EXAMPLE,
    maxLength: 50_000,
  })
  @Transform(({ value }) => normalizeMarkdown(value))
  @IsString({ message: '작업 전달 내용을 입력해 주세요.' })
  @IsNotEmpty({ message: '작업 전달 내용을 입력해 주세요.' })
  @MaxLength(50_000, { message: '작업 전달은 50,000자 이하여야 합니다.' })
  bodyMarkdown!: string;

  @ApiPropertyOptional({
    description: '최초 전달에서 생성하거나 재사용할 프론트엔드 역할',
    enum: [ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn([ProjectRole.WEB_FRONTEND, ProjectRole.APP_FRONTEND], { each: true })
  destinationRoles?: (typeof ProjectRole.WEB_FRONTEND | typeof ProjectRole.APP_FRONTEND)[];
}

export class CreateCommentDto {
  @ApiPropertyOptional({
    description: '댓글의 선택적인 팀 작업 문맥',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  @Transform(({ value }) => normalizeUuid(value))
  @IsOptional()
  @IsUUID('4', { message: '팀 작업 식별자가 올바르지 않습니다.' })
  teamWorkId?: string | null;

  @ApiProperty({ maxLength: 50_000, minLength: 1 })
  @Transform(({ value }) => normalizeMarkdown(value))
  @IsString({ message: '댓글 내용을 입력해 주세요.' })
  @IsNotEmpty({ message: '댓글 내용을 입력해 주세요.' })
  @MaxLength(50_000, { message: '댓글은 50,000자 이하여야 합니다.' })
  bodyMarkdown!: string;
}

export class UpdateCommentDto extends CreateCommentDto {
  @ApiProperty({ minimum: 1 })
  @IsInt({ message: '댓글 버전이 올바르지 않습니다.' })
  @Min(1, { message: '댓글 버전이 올바르지 않습니다.' })
  version!: number;
}

export class DeleteCommentQueryDto {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt({ message: '댓글 버전이 올바르지 않습니다.' })
  @Min(1, { message: '댓글 버전이 올바르지 않습니다.' })
  version!: number;
}

export class IssueTimelineQueryDto {
  @ApiPropertyOptional({ default: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: '정렬 방향이 올바르지 않습니다.' })
  sortDirection?: 'asc' | 'desc';

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
