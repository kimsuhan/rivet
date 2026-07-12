import { DatabaseService } from '../../common/database/database.service';
import { EventsService } from '../events/events.service';
import { FileStorageReadinessService } from './file-storage-readiness.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const database = { isReady: jest.fn() } as unknown as DatabaseService;
  const fileStorage = { isReady: jest.fn() } as unknown as FileStorageReadinessService;
  const events = { isReady: jest.fn() } as unknown as EventsService;
  const service = new HealthService(database, fileStorage, events);

  beforeEach(() => {
    jest.clearAllMocks();
    database.isReady = jest.fn().mockResolvedValue(true);
    fileStorage.isReady = jest.fn().mockResolvedValue(true);
    events.isReady = jest.fn().mockReturnValue(true);
  });

  it('is ready only when the database, file root, and PostgreSQL listener are ready', async () => {
    await expect(service.isReady()).resolves.toBe(true);

    events.isReady = jest.fn().mockReturnValue(false);
    await expect(service.isReady()).resolves.toBe(false);

    events.isReady = jest.fn().mockReturnValue(true);
    database.isReady = jest.fn().mockResolvedValue(false);
    await expect(service.isReady()).resolves.toBe(false);

    database.isReady = jest.fn().mockResolvedValue(true);
    fileStorage.isReady = jest.fn().mockResolvedValue(false);
    await expect(service.isReady()).resolves.toBe(false);
  });
});
