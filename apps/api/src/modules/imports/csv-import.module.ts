import { Module } from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { CsvImportController } from './csv-import.controller';
import { CsvImportService } from './csv-import.service';

@Module({ controllers: [CsvImportController], providers: [AdminGuard, CsvImportService] })
export class CsvImportModule {}
