import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { CsvImportController } from './csv-import.controller';
import { CsvImportService } from './csv-import.service';
import { CsvImportAnalysisService } from './csv-import-analysis.service';
import { CsvImportPersistenceService } from './csv-import-persistence.service';
import { CsvImportQueryService } from './csv-import-query.service';
import { CsvImportRunRepository } from './csv-import-run.repository';
import { CsvImportTargetRepository } from './csv-import-target.repository';

@Module({
  controllers: [CsvImportController],
  providers: [
    AdminGuard,
    CsvImportAnalysisService,
    CsvImportPersistenceService,
    CsvImportQueryService,
    CsvImportRunRepository,
    CsvImportService,
    CsvImportTargetRepository,
  ],
})
export class CsvImportModule {}
