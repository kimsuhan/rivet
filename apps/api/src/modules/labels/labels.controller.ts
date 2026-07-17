import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  ArchiveLabelDto,
  CreateLabelDto,
  LabelListQueryDto,
  LabelListResponseDto,
  LabelResponseDto,
  UpdateLabelDto,
} from './dto/label.dto';
import { LabelsService } from './labels.service';

function workspaceId(authentication: AuthenticatedRequestContext): string {
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

  return workspace.id;
}

@ApiTags('labels')
@ApiCookieAuth('sessionCookie')
@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get()
  @ApiOperation({ summary: '현재 워크스페이스 라벨 목록' })
  @ApiOkResponse({ type: LabelListResponseDto })
  @ApiBadRequestResponse({ description: 'INVALID_QUERY', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: LabelListQueryDto,
  ): Promise<LabelListResponseDto> {
    return this.labels.list(workspaceId(authentication), query);
  }

  @Post()
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '워크스페이스 공용 라벨 생성' })
  @ApiCreatedResponse({ type: LabelResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'LABEL_NAME_IN_USE', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CreateLabelDto,
  ): Promise<LabelResponseDto> {
    return this.labels.create(workspaceId(authentication), dto);
  }

  @Patch(':labelId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '라벨 이름과 색상 수정' })
  @ApiParam({ format: 'uuid', name: 'labelId' })
  @ApiOkResponse({ type: LabelResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'VERSION_CONFLICT 또는 LABEL_NAME_IN_USE',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  update(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('labelId', new ParseUUIDPipe({ version: '4' })) labelId: string,
    @Body() dto: UpdateLabelDto,
  ): Promise<LabelResponseDto> {
    return this.labels.update(workspaceId(authentication), labelId, dto);
  }

  @Post(':labelId/archive')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '라벨 보관' })
  @ApiParam({ format: 'uuid', name: 'labelId' })
  @ApiOkResponse({ type: LabelResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'EMAIL_NOT_VERIFIED, MEMBERSHIP_INACTIVE, CSRF_INVALID 또는 FORBIDDEN',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  archive(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('labelId', new ParseUUIDPipe({ version: '4' })) labelId: string,
    @Body() dto: ArchiveLabelDto,
  ): Promise<LabelResponseDto> {
    return this.labels.archive(workspaceId(authentication), labelId, dto);
  }
}
