import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  SetMetadata,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiError } from '../../common/errors/api-error';
import { ApiErrorResponseDto } from '../../common/errors/api-error-response.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ALLOW_MULTIPART } from '../../common/guards/json-body.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { CurrentAuthentication } from '../auth/current-authentication.decorator';
import { CSV_IMPORT_MAX_BYTES, type CsvImportUpload } from './csv-import.parser';
import { CsvImportService } from './csv-import.service';
import { CsvImportQueryService } from './csv-import-query.service';
import {
  CsvImportRunListQueryDto,
  ExecuteCsvImportDto,
  InspectCsvImportDto,
  ValidateCsvImportDto,
} from './dto/csv-import-request.dto';
import {
  CsvImportInspectionResponseDto,
  CsvImportMappingOptionsResponseDto,
  CsvImportRunListResponseDto,
  CsvImportRunResponseDto,
  CsvImportValidationResponseDto,
} from './dto/csv-import-response.dto';

const MULTIPART_PROPERTIES = {
  allowDuplicateFile: { default: false, type: 'boolean' as const },
  executionId: { format: 'uuid', type: 'string' as const },
  file: { format: 'binary', type: 'string' as const },
  mapping: { description: '컬럼·값 매핑 JSON', type: 'string' as const },
  validationSignature: { maxLength: 64, minLength: 64, type: 'string' as const },
} as const;

function adminContext(authentication: AuthenticatedRequestContext): {
  membershipId: string;
  workspaceId: string;
} {
  const { membership, workspace } = authentication.session;
  if (
    !membership ||
    !workspace ||
    membership.role !== 'ADMIN' ||
    membership.status !== 'ACTIVE' ||
    membership.workspaceId !== workspace.id
  ) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: '관리자만 CSV를 가져올 수 있습니다.',
      status: HttpStatus.FORBIDDEN,
    });
  }
  return { membershipId: membership.id, workspaceId: workspace.id };
}

@ApiTags('imports')
@ApiCookieAuth('sessionCookie')
@UseGuards(AdminGuard)
@Controller('imports/csv')
export class CsvImportController {
  constructor(
    private readonly imports: CsvImportService,
    private readonly queries: CsvImportQueryService,
  ) {}

  @Get('mapping-options')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '현재 워크스페이스 CSV 매핑 대상 조회' })
  @ApiOkResponse({ type: CsvImportMappingOptionsResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  mappingOptions(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
  ): Promise<CsvImportMappingOptionsResponseDto> {
    return this.imports.mappingOptions(adminContext(authentication));
  }

  @Post('inspect')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @SetMetadata(ALLOW_MULTIPART, true)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: CSV_IMPORT_MAX_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'CSV 컬럼과 원본 값 확인' })
  @ApiBody({
    schema: {
      properties: MULTIPART_PROPERTIES,
      required: ['executionId', 'file'],
      type: 'object',
    },
  })
  @ApiOkResponse({ type: CsvImportInspectionResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'IMPORT_FILE_TOO_LARGE', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'IMPORT_*', type: ApiErrorResponseDto })
  inspect(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() body: InspectCsvImportDto,
    @UploadedFile() file: CsvImportUpload | undefined,
  ): Promise<CsvImportInspectionResponseDto> {
    return this.imports.inspect(adminContext(authentication), body.executionId, file);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @SetMetadata(ALLOW_MULTIPART, true)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: CSV_IMPORT_MAX_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'CSV 매핑과 저장 예정 결과 검증' })
  @ApiBody({
    schema: {
      properties: MULTIPART_PROPERTIES,
      required: ['executionId', 'file', 'mapping'],
      type: 'object',
    },
  })
  @ApiOkResponse({ type: CsvImportValidationResponseDto })
  @ApiConflictResponse({ description: 'IMPORT_EXECUTION_CONFLICT', type: ApiErrorResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'IMPORT_FILE_TOO_LARGE', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'IMPORT_*', type: ApiErrorResponseDto })
  validate(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() body: ValidateCsvImportDto,
    @UploadedFile() file: CsvImportUpload | undefined,
  ): Promise<CsvImportValidationResponseDto> {
    return this.imports.validate(
      adminContext(authentication),
      body.executionId,
      file,
      body.mapping,
      body.allowDuplicateFile,
    );
  }

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @SetMetadata(ALLOW_MULTIPART, true)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: CSV_IMPORT_MAX_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '검증된 CSV 원자적 저장' })
  @ApiBody({
    schema: {
      properties: MULTIPART_PROPERTIES,
      required: ['executionId', 'file', 'mapping', 'validationSignature'],
      type: 'object',
    },
  })
  @ApiOkResponse({ type: CsvImportRunResponseDto })
  @ApiConflictResponse({ description: 'IMPORT_*', type: ApiErrorResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'IMPORT_FILE_TOO_LARGE', type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'IMPORT_*', type: ApiErrorResponseDto })
  execute(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Body() body: ExecuteCsvImportDto,
    @UploadedFile() file: CsvImportUpload | undefined,
  ): Promise<CsvImportRunResponseDto> {
    return this.imports.execute(
      adminContext(authentication),
      body.executionId,
      file,
      body.mapping,
      body.allowDuplicateFile,
      body.validationSignature,
    );
  }

  @Get('runs')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '현재 워크스페이스 CSV 가져오기 실행 목록' })
  @ApiOkResponse({ type: CsvImportRunListResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  listRuns(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Query() query: CsvImportRunListQueryDto,
  ): Promise<CsvImportRunListResponseDto> {
    return this.queries.listRuns(adminContext(authentication), query);
  }

  @Get('runs/:executionId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: '현재 워크스페이스 CSV 가져오기 실행 결과' })
  @ApiOkResponse({ type: CsvImportRunResponseDto })
  @ApiUnauthorizedResponse({ description: 'SESSION_REQUIRED', type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ description: 'FORBIDDEN', type: ApiErrorResponseDto })
  getRun(
    @CurrentAuthentication() authentication: AuthenticatedRequestContext,
    @Param('executionId', new ParseUUIDPipe({ version: '4' })) executionId: string,
  ): Promise<CsvImportRunResponseDto> {
    return this.queries.getRun(adminContext(authentication), executionId);
  }
}
