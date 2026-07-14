import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  IssueSummaryResponseDto,
  TeamWorkSummaryResponseDto,
} from '../../issues/dto/issue-response.dto';

export const SEARCH_ISSUE_MATCH_TYPES = ['IDENTIFIER_EXACT', 'TITLE_PARTIAL'] as const;
export type SearchIssueMatchType = (typeof SEARCH_ISSUE_MATCH_TYPES)[number];

export class SearchIssuesQueryDto {
  @ApiProperty({ description: '이슈 또는 팀 작업 표시 ID, 이슈 제목 검색어', maxLength: 500 })
  @Transform(({ value }) => typeof value === 'string' ? value.normalize('NFC').trim() : value)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  query?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50, minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ description: '이전 응답의 불투명 커서' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}

export class SearchIssueResultResponseDto {
  @ApiProperty({ enum: ['ISSUE', 'TEAM_WORK'] })
  resourceType!: 'ISSUE' | 'TEAM_WORK';

  @ApiProperty({ enum: SEARCH_ISSUE_MATCH_TYPES })
  matchType!: SearchIssueMatchType;

  @ApiProperty({ type: IssueSummaryResponseDto })
  issue!: IssueSummaryResponseDto;

  @ApiPropertyOptional({ type: TeamWorkSummaryResponseDto })
  teamWork?: TeamWorkSummaryResponseDto;
}

export class SearchIssueListResponseDto {
  @ApiProperty({ isArray: true, type: SearchIssueResultResponseDto })
  items!: SearchIssueResultResponseDto[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
