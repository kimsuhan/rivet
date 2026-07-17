import { HttpStatus, Injectable } from '@nestjs/common';

import type { CsvImportContext } from './csv-import.context';
import { csvImportError } from './csv-import.errors';
import { toCsvImportRunResponse } from './csv-import-response.mapper';
import { CsvImportRunRepository } from './csv-import-run.repository';
import type { CsvImportRunListQueryDto } from './dto/csv-import-request.dto';
import type {
  CsvImportRunListResponseDto,
  CsvImportRunResponseDto,
} from './dto/csv-import-response.dto';

@Injectable()
export class CsvImportQueryService {
  constructor(private readonly runs: CsvImportRunRepository) {}

  async getRun(context: CsvImportContext, executionId: string): Promise<CsvImportRunResponseDto> {
    const row = await this.runs.get(context.workspaceId, executionId);
    if (!row) {
      return csvImportError(
        'RESOURCE_NOT_FOUND',
        '가져오기 실행을 찾을 수 없습니다.',
        HttpStatus.NOT_FOUND,
      );
    }
    return toCsvImportRunResponse(row);
  }

  async listRuns(
    context: CsvImportContext,
    query: CsvImportRunListQueryDto,
  ): Promise<CsvImportRunListResponseDto> {
    const cursor = query.cursor
      ? await this.runs.getCursor(context.workspaceId, query.cursor)
      : null;
    if (query.cursor && !cursor) {
      return csvImportError(
        'RESOURCE_NOT_FOUND',
        '가져오기 실행 커서를 찾을 수 없습니다.',
        HttpStatus.NOT_FOUND,
      );
    }
    const rows = await this.runs.list(context.workspaceId, query.limit, cursor);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toCsvImportRunResponse),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
