import { randomUUID } from 'node:crypto';
import { lstat, opendir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Client } from 'pg';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { workerConfig } from '../../config/worker.config';
import { RetentionService } from './retention.service';

const DATABASE_BATCH_SIZE = 100;
const FILESYSTEM_SCAN_LIMIT = 500;
const MAINTENANCE_ADVISORY_KEY = 'rivet:daily-maintenance:v1';
const MAINTENANCE_UTC_HOUR = 18;
const METADATA_SCAN_LIMIT = 500;
const UUID_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CleanupFile = {
  id: string;
  storageKey: string;
};

type MetadataFile = CleanupFile & {
  avatarUser: { id: string } | null;
  issueAttachments: { id: string }[];
};

type UnlinkedCleanupResult = {
  deletedBinaries: number;
  deletedMetadata: number;
  invalidStorageKeys: number;
};

export type FileCleanupResult = {
  deletedEmailDeliveries: number;
  deletedExportAudits: number;
  deletedBinaries: number;
  deletedMetadata: number;
  deletedOrphans: number;
  deletedOutboxEvents: number;
  deletedRateLimitBuckets: number;
  deletedSessions: number;
  deletedTemporaryFiles: number;
  deletedTokens: number;
  failedSteps: number;
  invalidStorageKeys: number;
  missingBinaries: number;
  skippedByLock: boolean;
};

export function millisecondsUntilNextMaintenance(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(MAINTENANCE_UTC_HOUR, 0, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime() - now.getTime();
}

@Injectable()
export class FileCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly abortController = new AbortController();
  private lastSuccessAt: Date | null = null;
  private metadataCursor: string | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly database: DatabaseService,
    @Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>,
    private readonly retention: RetentionService,
    private readonly observability: ObservabilityService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FileCleanupService.name);
  }

  onApplicationBootstrap(): void {
    this.running = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.abortController.abort();
    await this.running;
  }

  async cleanupOnce(jobId = `file_cleanup_${randomUUID()}`): Promise<FileCleanupResult> {
    const lockClient = new Client({
      connectionString: this.config.database.url,
      connectionTimeoutMillis: this.config.database.connectionTimeoutMs,
    });
    let isConnected = false;
    let isLocked = false;

    try {
      await lockClient.connect();
      isConnected = true;
      const lockResult = await lockClient.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS "acquired"',
        [MAINTENANCE_ADVISORY_KEY],
      );
      isLocked = lockResult.rows[0]?.acquired === true;

      if (!isLocked) {
        const result = this.emptyResult();
        result.skippedByLock = true;
        this.logger.info({ jobId, result: 'lock_not_acquired' }, '파일 정리 건너뜀');
        return result;
      }

      const result = await this.performCleanup(jobId);
      if (result.failedSteps === 0) this.lastSuccessAt = new Date();
      const deletedCount =
        result.deletedBinaries +
        result.deletedEmailDeliveries +
        result.deletedExportAudits +
        result.deletedMetadata +
        result.deletedOrphans +
        result.deletedOutboxEvents +
        result.deletedRateLimitBuckets +
        result.deletedSessions +
        result.deletedTemporaryFiles +
        result.deletedTokens;
      this.logger.info(
        {
          jobId,
          maintenance_deleted_count: deletedCount,
          maintenance_last_success_at: this.lastSuccessAt?.toISOString() ?? null,
          maintenance_missing_file_count: result.missingBinaries,
          ...result,
        },
        '파일 정리 실행 종료',
      );
      return result;
    } finally {
      if (isLocked) {
        await lockClient
          .query('SELECT pg_advisory_unlock(hashtext($1))', [MAINTENANCE_ADVISORY_KEY])
          .catch(() =>
            this.logger.warn(
              { errorCode: 'MAINTENANCE_LOCK_RELEASE_FAILED', jobId },
              '정기 작업 잠금 해제 실패',
            ),
          );
      }

      if (isConnected) {
        await lockClient
          .end()
          .catch(() =>
            this.logger.warn(
              { errorCode: 'MAINTENANCE_LOCK_CONNECTION_CLOSE_FAILED', jobId },
              '정기 작업 잠금 연결 종료 실패',
            ),
          );
      }
    }
  }

  private async run(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      const jobId = `file_cleanup_${randomUUID()}`;

      try {
        await this.cleanupOnce(jobId);
      } catch {
        this.logger.error({ errorCode: 'FILE_CLEANUP_FAILED', jobId }, '파일 정리 실패');
        this.observability.alert({
          errorCode: 'FILE_CLEANUP_FAILED',
          jobId,
          type: 'MAINTENANCE_STEP_FAILED',
        });
      }

      if (this.abortController.signal.aborted) break;

      try {
        await delay(millisecondsUntilNextMaintenance(new Date()), undefined, {
          signal: this.abortController.signal,
        });
      } catch (error) {
        if (!this.abortController.signal.aborted) throw error;
      }
    }
  }

  private async performCleanup(jobId: string): Promise<FileCleanupResult> {
    const result = this.emptyResult();

    try {
      const retention = await this.retention.cleanup(jobId);
      result.deletedEmailDeliveries = retention.deletedEmailDeliveries;
      result.deletedExportAudits = retention.deletedExportAudits;
      result.deletedOutboxEvents = retention.deletedOutboxEvents;
      result.deletedRateLimitBuckets = retention.deletedRateLimitBuckets;
      result.deletedSessions = retention.deletedSessions;
      result.deletedTokens = retention.deletedTokens;
      result.failedSteps += retention.failedSteps;
    } catch {
      result.failedSteps += 1;
      this.logStepFailure('retention', jobId);
    }

    try {
      result.deletedTemporaryFiles = await this.cleanupTemporaryFiles(jobId);
    } catch {
      result.failedSteps += 1;
      this.logStepFailure('tmp', jobId);
    }

    try {
      const unlinked = await this.cleanupUnlinkedFiles(jobId);
      result.deletedBinaries = unlinked.deletedBinaries;
      result.deletedMetadata = unlinked.deletedMetadata;
      result.invalidStorageKeys += unlinked.invalidStorageKeys;
    } catch {
      result.failedSteps += 1;
      this.logStepFailure('unlinked', jobId);
    }

    try {
      result.deletedOrphans = await this.cleanupOrphanBinaries(jobId);
    } catch {
      result.failedSteps += 1;
      this.logStepFailure('orphan', jobId);
    }

    try {
      const metadataCheck = await this.checkLinkedMetadataBinaries(jobId);
      result.invalidStorageKeys += metadataCheck.invalidStorageKeys;
      result.missingBinaries = metadataCheck.missingBinaries;
      if (metadataCheck.missingBinaries > 0) {
        this.observability.alert({
          errorCode: 'FILE_BINARY_MISSING',
          jobId,
          type: 'LINKED_FILE_BINARY_MISSING',
        });
      }
    } catch {
      result.failedSteps += 1;
      this.logStepFailure('missing_binary', jobId);
    }

    return result;
  }

  private async cleanupUnlinkedFiles(jobId: string): Promise<UnlinkedCleanupResult> {
    await this.assertStorageDirectory(join(this.config.fileStorageRoot, 'objects'));
    const candidates = await this.database.client.$queryRaw<CleanupFile[]>`
      SELECT f."id", f."storage_key" AS "storageKey"
      FROM "files" AS f
      WHERE f."unlinked_at" < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1
          FROM "users" AS u
          WHERE u."avatar_file_id" = f."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "issue_file_attachments" AS a
          WHERE a."file_id" = f."id"
        )
      ORDER BY f."unlinked_at", f."id"
      LIMIT ${DATABASE_BATCH_SIZE}
    `;
    const result: UnlinkedCleanupResult = {
      deletedBinaries: 0,
      deletedMetadata: 0,
      invalidStorageKeys: 0,
    };

    for (const candidate of candidates) {
      if (!this.resolveStorageKey(candidate.storageKey)) {
        result.invalidStorageKeys += 1;
        this.logger.warn(
          { errorCode: 'FILE_STORAGE_KEY_INVALID', fileId: candidate.id, jobId },
          '파일 정리 대상의 저장 키가 올바르지 않음',
        );
        continue;
      }

      const cleaned = await this.cleanupUnlinkedFile(candidate.id, jobId);
      result.deletedBinaries += cleaned.deletedBinary ? 1 : 0;
      result.deletedMetadata += cleaned.deletedMetadata ? 1 : 0;
    }

    return result;
  }

  private async cleanupUnlinkedFile(
    fileId: string,
    jobId: string,
  ): Promise<{ deletedBinary: boolean; deletedMetadata: boolean }> {
    return this.database.client.$transaction(async (transaction) => {
      const [file] = await transaction.$queryRaw<CleanupFile[]>`
        SELECT f."id", f."storage_key" AS "storageKey"
        FROM "files" AS f
        WHERE f."id" = ${fileId}::uuid
          AND f."unlinked_at" < NOW() - INTERVAL '24 hours'
        FOR UPDATE OF f
      `;

      if (!file) return { deletedBinary: false, deletedMetadata: false };

      const [references] = await transaction.$queryRaw<Array<{ linked: boolean }>>`
        SELECT
          EXISTS (
            SELECT 1 FROM "users" AS u WHERE u."avatar_file_id" = ${fileId}::uuid
          ) OR EXISTS (
            SELECT 1
            FROM "issue_file_attachments" AS a
            WHERE a."file_id" = ${fileId}::uuid
          ) AS "linked"
      `;

      if (references?.linked) return { deletedBinary: false, deletedMetadata: false };

      const path = this.resolveStorageKey(file.storageKey);

      if (!path) {
        this.logger.warn(
          { errorCode: 'FILE_STORAGE_KEY_INVALID', fileId, jobId },
          '잠근 파일의 저장 키가 올바르지 않음',
        );
        return { deletedBinary: false, deletedMetadata: false };
      }

      const deletedBinary = await this.removeFile(path, 'FILE_BINARY_DELETE_FAILED', jobId);

      if (!deletedBinary) return { deletedBinary: false, deletedMetadata: false };

      const deleted = await transaction.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "files" AS f
        WHERE f."id" = ${fileId}::uuid
          AND f."unlinked_at" < NOW() - INTERVAL '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM "users" AS u WHERE u."avatar_file_id" = f."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "issue_file_attachments" AS a
            WHERE a."file_id" = f."id"
          )
        RETURNING f."id"
      `;

      return { deletedBinary, deletedMetadata: deleted.length === 1 };
    });
  }

  private async cleanupTemporaryFiles(jobId: string): Promise<number> {
    const files = await this.findAgedRegularFiles(
      join(this.config.fileStorageRoot, 'tmp'),
      Date.now() - 60 * 60 * 1_000,
    );
    let deleted = 0;

    for (const path of files.map((file) => file.path)) {
      if (await this.removeFile(path, 'FILE_TEMP_DELETE_FAILED', jobId)) deleted += 1;
    }

    return deleted;
  }

  private async cleanupOrphanBinaries(jobId: string): Promise<number> {
    const files = await this.findAgedRegularFiles(
      join(this.config.fileStorageRoot, 'objects'),
      Date.now() - 24 * 60 * 60 * 1_000,
    );
    const validFiles = files.filter((file) => UUID_FILE_NAME.test(file.name));
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      this.logger.warn(
        { errorCode: 'FILE_STORAGE_ENTRY_INVALID', invalidCount, jobId },
        '최종 저장소에 올바르지 않은 항목이 있음',
      );
    }

    if (validFiles.length === 0) return 0;

    const storageKeys = validFiles.map((file) => `objects/${file.name}`);
    const metadata = await this.database.client.file.findMany({
      select: { storageKey: true },
      where: { storageKey: { in: storageKeys } },
    });
    const knownStorageKeys = new Set(metadata.map((file) => file.storageKey));
    let deleted = 0;

    for (const file of validFiles) {
      if (
        !knownStorageKeys.has(`objects/${file.name}`) &&
        (await this.removeFile(file.path, 'FILE_ORPHAN_DELETE_FAILED', jobId))
      ) {
        deleted += 1;
      }
    }

    return deleted;
  }

  private async checkLinkedMetadataBinaries(
    jobId: string,
  ): Promise<{ invalidStorageKeys: number; missingBinaries: number }> {
    let files = await this.findLinkedMetadataFiles(this.metadataCursor);

    if (files.length === 0 && this.metadataCursor) {
      files = await this.findLinkedMetadataFiles();
    }

    this.metadataCursor = files.length === METADATA_SCAN_LIMIT ? files.at(-1)?.id : undefined;
    let invalidStorageKeys = 0;
    let missingBinaries = 0;

    for (const file of files) {
      const path = this.resolveStorageKey(file.storageKey);

      if (!path) {
        invalidStorageKeys += 1;
        this.logger.warn(
          { errorCode: 'FILE_STORAGE_KEY_INVALID', fileId: file.id, jobId },
          '연결 파일 메타데이터의 저장 키가 올바르지 않음',
        );
        continue;
      }

      try {
        const metadata = await lstat(path);

        if (metadata.isFile()) continue;
      } catch (error) {
        if (!this.isMissingFileError(error)) {
          this.logger.warn(
            { errorCode: 'FILE_BINARY_CHECK_FAILED', fileId: file.id, jobId },
            '파일 바이너리 확인 실패',
          );
          continue;
        }
      }

      missingBinaries += 1;
      this.logger.warn(
        { errorCode: 'FILE_BINARY_MISSING', fileId: file.id, isLinked: true, jobId },
        '파일 바이너리가 없음',
      );
    }

    return { invalidStorageKeys, missingBinaries };
  }

  private findLinkedMetadataFiles(cursor?: string): Promise<MetadataFile[]> {
    return this.database.client.file.findMany({
      orderBy: { id: 'asc' },
      select: {
        avatarUser: { select: { id: true } },
        id: true,
        issueAttachments: { select: { id: true }, take: 1 },
        storageKey: true,
      },
      take: METADATA_SCAN_LIMIT,
      where: {
        OR: [{ avatarUser: { isNot: null } }, { issueAttachments: { some: {} } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
    });
  }

  private async findAgedRegularFiles(
    directory: string,
    olderThanMs: number,
  ): Promise<Array<{ name: string; path: string }>> {
    await this.assertStorageDirectory(directory);
    let handle;

    try {
      handle = await opendir(directory);
    } catch (error) {
      if (this.isMissingFileError(error)) return [];
      throw error;
    }

    const files: Array<{ name: string; path: string }> = [];
    let scanned = 0;

    for await (const entry of handle) {
      scanned += 1;
      if (scanned > FILESYSTEM_SCAN_LIMIT) break;

      const path = join(directory, entry.name);
      const metadata = await lstat(path).catch(() => null);

      if (metadata?.isFile() && metadata.mtimeMs < olderThanMs) {
        files.push({ name: entry.name, path });
      }
    }

    return files;
  }

  private resolveStorageKey(storageKey: string): string | null {
    const match = /^objects\/([^/]+)$/.exec(storageKey);

    return match?.[1] && UUID_FILE_NAME.test(match[1])
      ? join(this.config.fileStorageRoot, 'objects', match[1])
      : null;
  }

  private async removeFile(path: string, errorCode: string, jobId: string): Promise<boolean> {
    try {
      const metadata = await lstat(path);

      if (!metadata.isFile()) {
        this.logger.warn(
          { errorCode: 'FILE_STORAGE_ENTRY_INVALID', jobId },
          '삭제 대상이 일반 파일이 아님',
        );
        return false;
      }
    } catch (error) {
      if (this.isMissingFileError(error)) return true;

      this.logger.warn({ errorCode, jobId }, '파일 삭제 전 확인 실패');
      return false;
    }

    try {
      await unlink(path);
      return true;
    } catch (error) {
      if (this.isMissingFileError(error)) return true;

      this.logger.warn({ errorCode, jobId }, '파일 삭제 실패');
      return false;
    }
  }

  private async assertStorageDirectory(directory: string): Promise<void> {
    const metadata = await lstat(directory);

    if (!metadata.isDirectory()) {
      throw new Error('FILE_STORAGE_DIRECTORY_INVALID');
    }
  }

  private emptyResult(): FileCleanupResult {
    return {
      deletedEmailDeliveries: 0,
      deletedExportAudits: 0,
      deletedBinaries: 0,
      deletedMetadata: 0,
      deletedOrphans: 0,
      deletedOutboxEvents: 0,
      deletedRateLimitBuckets: 0,
      deletedSessions: 0,
      deletedTemporaryFiles: 0,
      deletedTokens: 0,
      failedSteps: 0,
      invalidStorageKeys: 0,
      missingBinaries: 0,
      skippedByLock: false,
    };
  }

  private logStepFailure(step: string, jobId: string): void {
    this.logger.warn({ errorCode: 'FILE_CLEANUP_STEP_FAILED', jobId, step }, '파일 정리 단계 실패');
    this.observability.alert({
      errorCode: 'FILE_CLEANUP_STEP_FAILED',
      jobId,
      type: 'MAINTENANCE_STEP_FAILED',
    });
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    );
  }
}
