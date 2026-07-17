import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { readInvitationContinuationCookie } from '../../common/auth/invitation-continuation-cookie';
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from '../../common/auth/session-cookie';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { apiConfig } from '../../config/api.config';
import { AuthService } from './auth.service';
import { AuthAccountTokenService } from './auth-account-token.service';
import { AuthProfileService } from './auth-profile.service';
import type { AuthenticatedRequestContext } from './authentication.context';
import { CurrentAuthentication } from './current-authentication.decorator';
import {
  AcceptedAuthRequestDto,
  AuthenticatedSessionDto,
  ResetPasswordDto,
  SessionUserDto,
  UnauthenticatedSessionDto,
  VerifiedEmailDto,
} from './dto/auth-response.dto';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/profile.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { ConfirmPasswordResetDto, TokenDto } from './dto/token.dto';
import { PublicEndpoint } from './public.decorator';

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function ApiPublicMutationErrors(
  forbiddenDescription = 'CSRF_INVALID: Origin 또는 Referer 검증 실패',
) {
  return applyDecorators(
    ApiResponse({
      description: 'INVALID_REQUEST: JSON 요청 형식이 유효하지 않음',
      status: HttpStatus.BAD_REQUEST,
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      description: forbiddenDescription,
      status: HttpStatus.FORBIDDEN,
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      description: 'VALIDATION_ERROR 또는 TOKEN_INVALID: 요청 입력 또는 토큰이 유효하지 않음',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      description: 'RATE_LIMITED: 요청 속도 제한 초과',
      headers: {
        'Retry-After': {
          description: '다시 요청할 수 있을 때까지 남은 초',
          schema: { minimum: 1, type: 'integer' },
        },
      },
      status: HttpStatus.TOO_MANY_REQUESTS,
      type: ApiErrorResponseDto,
    }),
  );
}

@ApiExtraModels(AuthenticatedSessionDto, UnauthenticatedSessionDto)
@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(
    private readonly accountTokens: AuthAccountTokenService,
    private readonly auth: AuthService,
    private readonly profile: AuthProfileService,
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
  ) {}

  @PublicEndpoint()
  @Post('auth/sign-up')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '회원가입 요청' })
  @ApiAcceptedResponse({ type: AcceptedAuthRequestDto })
  @ApiResponse({
    description: 'INVITATION_EMAIL_MISMATCH: 초대 이메일과 가입 이메일 불일치',
    status: HttpStatus.CONFLICT,
    type: ApiErrorResponseDto,
  })
  @ApiPublicMutationErrors()
  signUp(@Body() dto: SignUpDto, @Req() request: Request): Promise<AcceptedAuthRequestDto> {
    return this.auth.signUp(
      dto,
      clientIp(request),
      readInvitationContinuationCookie(request, this.config),
    );
  }

  @PublicEndpoint()
  @Post('auth/email-verifications/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: '이메일 인증 토큰 사용' })
  @ApiOkResponse({ type: VerifiedEmailDto })
  @ApiResponse({
    description: '토큰이 이미 사용됨',
    status: HttpStatus.CONFLICT,
    type: ApiErrorResponseDto,
  })
  @ApiResponse({ description: '토큰이 만료됨', status: HttpStatus.GONE, type: ApiErrorResponseDto })
  @ApiPublicMutationErrors()
  verifyEmail(@Body() dto: TokenDto, @Req() request: Request): Promise<VerifiedEmailDto> {
    return this.accountTokens.verifyEmail(dto, clientIp(request));
  }

  @PublicEndpoint()
  @Post('auth/email-verifications/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '이메일 인증 메일 재발송 요청' })
  @ApiAcceptedResponse({ type: AcceptedAuthRequestDto })
  @ApiPublicMutationErrors()
  resendEmailVerification(
    @Body() dto: EmailDto,
    @Req() request: Request,
  ): Promise<AcceptedAuthRequestDto> {
    return this.accountTokens.resendEmailVerification(dto, clientIp(request));
  }

  @PublicEndpoint()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '로그인과 세션 발급' })
  @ApiOkResponse({ type: AuthenticatedSessionDto })
  @ApiResponse({
    description: '이메일 또는 비밀번호 불일치',
    status: HttpStatus.UNAUTHORIZED,
    type: ApiErrorResponseDto,
  })
  @ApiPublicMutationErrors('CSRF_INVALID, EMAIL_NOT_VERIFIED 또는 MEMBERSHIP_INACTIVE')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedSessionDto> {
    const result = await this.auth.login(
      dto,
      clientIp(request),
      readInvitationContinuationCookie(request, this.config),
    );
    setSessionCookie(response, this.config, result.token, result.absoluteExpiresAt);
    return result.response;
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '현재 세션 종료' })
  @ApiCookieAuth('sessionCookie')
  @ApiNoContentResponse()
  @ApiResponse({
    description: '세션 없음 또는 만료',
    status: HttpStatus.UNAUTHORIZED,
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    description: 'CSRF 토큰 오류',
    status: HttpStatus.FORBIDDEN,
    type: ApiErrorResponseDto,
  })
  async logout(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(authentication.session.sessionId);
    clearSessionCookie(response, this.config);
  }

  @PublicEndpoint()
  @Get('auth/session')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '선택적 현재 세션 조회' })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthenticatedSessionDto) },
        { $ref: getSchemaPath(UnauthenticatedSessionDto) },
      ],
    },
  })
  getSession(
    @Req() request: Request,
  ): Promise<AuthenticatedSessionDto | UnauthenticatedSessionDto> {
    return this.auth.getSession(
      readSessionCookie(request, this.config),
      readInvitationContinuationCookie(request, this.config),
    );
  }

  @PublicEndpoint()
  @Post('auth/password-resets/request')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '비밀번호 재설정 메일 요청' })
  @ApiNoContentResponse()
  @ApiPublicMutationErrors()
  requestPasswordReset(@Body() dto: EmailDto, @Req() request: Request): Promise<void> {
    return this.accountTokens.requestPasswordReset(dto, clientIp(request));
  }

  @PublicEndpoint()
  @Post('auth/password-resets/confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: '비밀번호 재설정 토큰 사용' })
  @ApiOkResponse({ type: ResetPasswordDto })
  @ApiResponse({
    description: '토큰이 이미 사용됨',
    status: HttpStatus.CONFLICT,
    type: ApiErrorResponseDto,
  })
  @ApiResponse({ description: '토큰이 만료됨', status: HttpStatus.GONE, type: ApiErrorResponseDto })
  @ApiPublicMutationErrors()
  async confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResetPasswordDto> {
    const result = await this.accountTokens.confirmPasswordReset(dto, clientIp(request));
    clearSessionCookie(response, this.config);
    return result;
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '현재 사용자 조회' })
  @ApiCookieAuth('sessionCookie')
  @ApiOkResponse({ type: SessionUserDto })
  @ApiResponse({
    description: '세션 없음 또는 만료',
    status: HttpStatus.UNAUTHORIZED,
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    description: '이메일 미인증 또는 비활성 멤버십',
    status: HttpStatus.FORBIDDEN,
    type: ApiErrorResponseDto,
  })
  getMe(@CurrentAuthentication() authentication: AuthenticatedRequestContext): SessionUserDto {
    return this.profile.get(authentication.session);
  }

  @Patch('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '현재 사용자의 표시 이름 변경' })
  @ApiCookieAuth('sessionCookie')
  @ApiOkResponse({ type: SessionUserDto })
  @ApiResponse({
    description: 'VALIDATION_ERROR: 표시 이름이 유효하지 않음',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: ApiErrorResponseDto,
  })
  updateMe(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() dto: UpdateProfileDto,
  ): Promise<SessionUserDto> {
    return this.profile.update(authentication.session, dto);
  }
}
