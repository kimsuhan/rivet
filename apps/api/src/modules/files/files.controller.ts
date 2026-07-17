import { createReadStream } from 'node:fs';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  SetMetadata,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { ALLOW_MULTIPART } from '../../common/guards/json-body.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { FileIdDto, UploadFileDto } from './dto/file-request.dto';
import {
  FileResourceResponseDto,
  FileUserSummaryResponseDto,
  IssueAttachmentListResponseDto,
  IssueAttachmentResponseDto,
} from './dto/file-response.dto';
import { contentDisposition } from './file-content.policy';
import { FileQueryService } from './file-query.service';
import { FilesService, type UploadedTemporaryFile } from './files.service';
import { UploadedFileCleanupInterceptor } from './uploaded-file-cleanup.interceptor';

const UUID_PIPE = new ParseUUIDPipe({ version: '4' });

function workspaceContext(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  userId: string;
  workspaceId: string;
} {
  const { membership, user, workspace } = authentication.session;
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
  return { membershipId: membership.id, userId: user.id, workspaceId: workspace.id };
}

@ApiTags('files')
@ApiCookieAuth('sessionCookie')
@Controller('files')
export class FilesController {
  constructor(
    private readonly fileQueries: FileQueryService,
    private readonly files: FilesService,
  ) {}

  @Post()
  @SetMetadata(ALLOW_MULTIPART, true)
  @UseInterceptors(FileInterceptor('file'), UploadedFileCleanupInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '단일 파일 업로드' })
  @ApiBody({
    schema: {
      properties: {
        file: { format: 'binary', type: 'string' },
        scope: { enum: ['USER_PROFILE', 'WORKSPACE'], type: 'string' },
      },
      required: ['file', 'scope'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ type: FileResourceResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'FILE_TOO_LARGE', type: ApiErrorResponseDto })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_ALLOWED',
    type: ApiErrorResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'FILE_EMPTY 또는 VALIDATION_ERROR',
    type: ApiErrorResponseDto,
  })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  upload(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() body: UploadFileDto,
    @UploadedFile() file: UploadedTemporaryFile | undefined,
  ): Promise<FileResourceResponseDto> {
    return this.files.upload(
      {
        membershipId: authentication.session.membership?.id ?? null,
        userId: authentication.session.user.id,
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      body.scope,
      file,
    );
  }

  @Get(':fileId')
  @ApiOperation({ summary: '접근 가능한 파일 메타데이터 조회' })
  @ApiOkResponse({ type: FileResourceResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  get(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('fileId', UUID_PIPE) fileId: string,
  ): Promise<FileResourceResponseDto> {
    return this.fileQueries.get(
      {
        userId: authentication.session.user.id,
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      fileId,
    );
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: '접근 가능한 파일 인라인 또는 첨부 스트리밍' })
  @ApiProduces('application/octet-stream', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')
  @ApiOkResponse({
    content: {
      'application/octet-stream': { schema: { format: 'binary', type: 'string' } },
      'image/gif': { schema: { format: 'binary', type: 'string' } },
      'image/jpeg': { schema: { format: 'binary', type: 'string' } },
      'image/png': { schema: { format: 'binary', type: 'string' } },
      'image/webp': { schema: { format: 'binary', type: 'string' } },
    },
    description: '파일 바이너리',
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  async content(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('fileId', UUID_PIPE) fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.fileQueries.getBinary(
      {
        userId: authentication.session.user.id,
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      fileId,
    );
    response.setHeader('Content-Type', file.detectedMimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      contentDisposition(file.inlineDisplayable ? 'inline' : 'attachment', file.originalName),
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.path));
  }

  @Get(':fileId/download')
  @ApiOperation({ summary: '접근 가능한 파일 다운로드' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    content: {
      'application/octet-stream': { schema: { format: 'binary', type: 'string' } },
    },
    description: '파일 바이너리',
  })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  async download(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('fileId', UUID_PIPE) fileId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.fileQueries.getBinary(
      {
        userId: authentication.session.user.id,
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      fileId,
    );
    response.setHeader('Content-Type', file.detectedMimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', contentDisposition('attachment', file.originalName));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.path));
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '업로더의 미연결 파일 즉시 삭제' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  delete(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('fileId', UUID_PIPE) fileId: string,
  ): Promise<void> {
    return this.files.delete({ userId: authentication.session.user.id }, fileId);
  }
}

@ApiTags('profile')
@ApiCookieAuth('sessionCookie')
@Controller('me/avatar')
export class AvatarController {
  constructor(private readonly files: FilesService) {}

  @Put()
  @ApiOperation({ summary: '현재 사용자의 프로필 사진 연결 또는 교체' })
  @ApiOkResponse({ type: FileUserSummaryResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiUnsupportedMediaTypeResponse({
    description: 'FILE_TYPE_NOT_ALLOWED',
    type: ApiErrorResponseDto,
  })
  @ApiConflictResponse({ description: 'FILE_ALREADY_LINKED', type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  set(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() body: FileIdDto,
  ): Promise<FileUserSummaryResponseDto> {
    return this.files.setAvatar(
      {
        userId: authentication.session.user.id,
        workspaceId: authentication.session.workspace?.id ?? null,
      },
      body.fileId,
    );
  }

  @Delete()
  @ApiOperation({ summary: '현재 사용자의 프로필 사진 연결 해제' })
  @ApiOkResponse({ type: FileUserSummaryResponseDto })
  clear(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
  ): Promise<FileUserSummaryResponseDto> {
    return this.files.clearAvatar({
      userId: authentication.session.user.id,
      workspaceId: authentication.session.workspace?.id ?? null,
    });
  }
}

@ApiTags('issue attachments')
@ApiCookieAuth('sessionCookie')
@Controller('issues/:issueId/attachments')
export class IssueAttachmentsController {
  constructor(
    private readonly fileQueries: FileQueryService,
    private readonly files: FilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: '이슈 일반 첨부 목록' })
  @ApiOkResponse({ type: IssueAttachmentListResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  list(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', UUID_PIPE) issueId: string,
  ): Promise<IssueAttachmentListResponseDto> {
    const context = workspaceContext(authentication);
    return this.fileQueries.listIssueAttachments(context.workspaceId, issueId);
  }

  @Post()
  @ApiOperation({ summary: '미연결 워크스페이스 파일을 이슈 일반 첨부로 연결' })
  @ApiCreatedResponse({ type: IssueAttachmentResponseDto })
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  @ApiConflictResponse({ description: 'FILE_ALREADY_LINKED', type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ description: 'FILE_UNAVAILABLE', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_ERROR', type: ApiErrorResponseDto })
  create(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', UUID_PIPE) issueId: string,
    @Body() body: FileIdDto,
  ): Promise<IssueAttachmentResponseDto> {
    return this.files.attachToIssue(workspaceContext(authentication), issueId, body.fileId);
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '이슈 일반 첨부 연결 해제' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'RESOURCE_NOT_FOUND', type: ApiErrorResponseDto })
  delete(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('issueId', UUID_PIPE) issueId: string,
    @Param('attachmentId', UUID_PIPE) attachmentId: string,
  ): Promise<void> {
    return this.files.detachFromIssue(workspaceContext(authentication), issueId, attachmentId);
  }
}
