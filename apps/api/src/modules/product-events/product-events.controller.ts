import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import {
  CaptureProductEventDto,
  CaptureProductEventResponseDto,
} from './dto/capture-product-event.dto';
import { ProductEventsService } from './product-events.service';

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

@ApiTags('product-events')
@ApiCookieAuth('sessionCookie')
@Controller('product-events')
export class ProductEventsController {
  constructor(private readonly productEvents: ProductEventsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '허용된 클라이언트 제품 이벤트 수집' })
  @ApiAcceptedResponse({ type: CaptureProductEventResponseDto })
  @ApiUnprocessableEntityResponse({
    description: 'PRODUCT_EVENT_INVALID',
    type: ApiErrorResponseDto,
  })
  capture(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: CaptureProductEventDto,
  ): Promise<CaptureProductEventResponseDto> {
    return this.productEvents.capture(context(authentication), dto);
  }
}
