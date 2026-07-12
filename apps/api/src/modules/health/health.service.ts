import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { EventsService } from '../events/events.service';
import { FileStorageReadinessService } from './file-storage-readiness.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly fileStorage: FileStorageReadinessService,
    private readonly events: EventsService,
  ) {}

  async isReady(): Promise<boolean> {
    const [isDatabaseReady, isFileStorageReady] = await Promise.all([
      this.database.isReady(),
      this.fileStorage.isReady(),
    ]);

    return isDatabaseReady && isFileStorageReady && this.events.isReady();
  }
}
