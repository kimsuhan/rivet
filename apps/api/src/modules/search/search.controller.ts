import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { ObservabilityService } from '../../common/observability/observability.service';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { SearchIssueListResponseDto, SearchIssuesQueryDto } from './dto/search-issues.dto';
import { SearchService } from './search.service';

function activeWorkspace(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  workspaceId: string;
} {
  const { membership, workspace } = authentication.session;

  if (
    !membership ||
    !workspace ||
    membership.status !== 'ACTIVE' ||
    membership.workspaceId !== workspace.id
  ) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: '활성 워크스페이스가 필요합니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }

  return { membershipId: membership.id, workspaceId: workspace.id };
}

@ApiTags('search')
@ApiCookieAuth('sessionCookie')
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly observability: ObservabilityService,
  ) {}

  @Get()
  @ApiOperation({ summary: '이슈 콘텐츠와 팀 작업 표시 ID 검색' })
  @ApiOkResponse({ type: SearchIssueListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  async issues(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: SearchIssuesQueryDto,
  ): Promise<SearchIssueListResponseDto> {
    const context = activeWorkspace(authentication);
    const result = await this.search.issues(context.workspaceId, query);
    if (query.cursor === undefined) {
      this.observability.capture({
        distinctId: context.membershipId,
        name: 'search_performed',
        properties: {
          resultCount: result.items.length,
          searchType: /^(?:F|[A-Z]{2,5})-[1-9][0-9]*$/i.test(query.query?.trim() ?? '')
            ? 'IDENTIFIER'
            : 'TITLE',
          workspaceId: context.workspaceId,
        },
      });
    }
    return result;
  }
}
