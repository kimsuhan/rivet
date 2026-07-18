import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  FeedbackListResponseDto,
  FeedbackResponseDto,
  FeedbackSubmissionReceiptDto,
  ListFeedbackQueryDto,
  SubmitFeedbackDto,
  UpdateFeedbackStatusDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

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

@ApiTags('feedback')
@ApiCookieAuth('sessionCookie')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '현재 워크스페이스에 제품 피드백 제출' })
  @ApiCreatedResponse({ type: FeedbackSubmissionReceiptDto })
  @ApiConflictResponse({ description: 'FEEDBACK_SUBMISSION_CONFLICT', type: ApiErrorResponseDto })
  submit(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: SubmitFeedbackDto,
  ): Promise<FeedbackSubmissionReceiptDto> {
    return this.feedback.submit(context(authentication), dto);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '관리자용 현재 워크스페이스 피드백 목록' })
  @ApiOkResponse({ type: FeedbackListResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: ListFeedbackQueryDto,
  ): Promise<FeedbackListResponseDto> {
    return this.feedback.list(context(authentication), query);
  }

  @Patch(':feedbackId/status')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '관리자용 피드백 상태 변경' })
  @ApiOkResponse({ type: FeedbackResponseDto })
  @ApiConflictResponse({ description: 'FEEDBACK_VERSION_CONFLICT', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  updateStatus(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('feedbackId', new ParseUUIDPipe({ version: '4' })) feedbackId: string,
    @Body() dto: UpdateFeedbackStatusDto,
  ): Promise<FeedbackResponseDto> {
    return this.feedback.updateStatus(context(authentication), feedbackId, dto);
  }
}
