import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  CreateSavedViewDto,
  DeleteSavedViewQueryDto,
  ListSavedViewsQueryDto,
  SavedViewListResponseDto,
  SavedViewResponseDto,
  SetSavedViewDefaultDto,
  UpdateSavedViewDto,
} from './dto/saved-view.dto';
import { SavedViewsService } from './saved-views.service';

function context(authentication: AuthenticatedRequestContext): {
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

@ApiTags('saved-views')
@ApiCookieAuth('sessionCookie')
@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly savedViews: SavedViewsService) {}

  @Get()
  @ApiOperation({ summary: '개인 저장된 보기 목록 조회' })
  @ApiOkResponse({ type: SavedViewListResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: ListSavedViewsQueryDto,
  ): Promise<SavedViewListResponseDto> {
    return this.savedViews
      .list(context(authentication), query.resourceType)
      .then((items) => ({ items }));
  }

  @Post()
  @ApiOperation({ summary: '개인 저장된 보기 생성' })
  @ApiCreatedResponse({ type: SavedViewResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorResponseDto })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateSavedViewDto,
  ): Promise<SavedViewResponseDto> {
    return this.savedViews.create(context(authentication), dto);
  }

  @Get(':savedViewId')
  @ApiOperation({ summary: '개인 저장된 보기 조회' })
  @ApiOkResponse({ type: SavedViewResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  get(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('savedViewId', new ParseUUIDPipe({ version: '4' })) savedViewId: string,
  ): Promise<SavedViewResponseDto> {
    return this.savedViews.get(context(authentication), savedViewId);
  }

  @Patch(':savedViewId')
  @ApiOperation({ summary: '개인 저장된 보기 이름 또는 구성 수정' })
  @ApiOkResponse({ type: SavedViewResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('savedViewId', new ParseUUIDPipe({ version: '4' })) savedViewId: string,
    @Body() dto: UpdateSavedViewDto,
  ): Promise<SavedViewResponseDto> {
    return this.savedViews.update(context(authentication), savedViewId, dto);
  }

  @Delete(':savedViewId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '개인 저장된 보기 삭제' })
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  remove(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('savedViewId', new ParseUUIDPipe({ version: '4' })) savedViewId: string,
    @Query() query: DeleteSavedViewQueryDto,
  ): Promise<void> {
    return this.savedViews.remove(context(authentication), savedViewId, query.version);
  }

  @Post(':savedViewId/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '개인 기본 보기 지정' })
  @ApiOkResponse({ type: SavedViewResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  setDefault(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('savedViewId', new ParseUUIDPipe({ version: '4' })) savedViewId: string,
    @Body() dto: SetSavedViewDefaultDto,
  ): Promise<SavedViewResponseDto> {
    return this.savedViews.setDefault(context(authentication), savedViewId, dto.version);
  }
}
