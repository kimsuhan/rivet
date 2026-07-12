import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { Client } from 'pg';

import {
  FileScope,
  IssueFileKind,
  IssueType,
  MembershipRole,
  StateCategory,
} from '@rivet/database';

import { DatabaseModule } from '../src/common/database/database.module';
import { DatabaseService } from '../src/common/database/database.service';
import { ObservabilityService } from '../src/common/observability/observability.service';
import { workerConfig } from '../src/config/worker.config';
import {
  type FileCleanupResult,
  FileCleanupService,
} from '../src/modules/maintenance/file-cleanup.service';
import { RetentionService } from '../src/modules/maintenance/retention.service';

type Fixture = {
  issueId: string;
  membershipId: string;
  teamId: string;
  userId: string;
  workflowStateId: string;
  workspaceId: string;
};

describe('file cleanup integration', () => {
  const alert = jest.fn();
  const warn = jest.fn();
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    setContext: jest.fn(),
    warn,
  } as unknown as PinoLogger;
  const storageRoot = process.env.FILE_STORAGE_ROOT as string;
  const objectsDirectory = join(storageRoot, 'objects');
  const temporaryDirectory = join(storageRoot, 'tmp');
  let context: INestApplicationContext;
  let database: DatabaseService;
  let fixture: Fixture | undefined;
  let service: FileCleanupService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [workerConfig] }), DatabaseModule],
    }).compile();
    context = module;
    await context.init();
    database = context.get(DatabaseService);
    service = new FileCleanupService(
      database,
      context.get<ConfigType<typeof workerConfig>>(workerConfig.KEY),
      {
        cleanup: jest.fn().mockResolvedValue({
          deletedEmailDeliveries: 0,
          deletedExportAudits: 0,
          deletedOutboxEvents: 0,
          deletedRateLimitBuckets: 0,
          deletedSessions: 0,
          deletedTokens: 0,
          failedSteps: 0,
        }),
      } as unknown as RetentionService,
      { alert } as unknown as ObservabilityService,
      logger,
    );
    await mkdir(objectsDirectory, { recursive: true });
    await mkdir(temporaryDirectory, { recursive: true });
    fixture = await createFixture();
  });

  afterAll(async () => {
    if (fixture) {
      await database.client.user.update({
        data: { avatarFileId: null },
        where: { id: fixture.userId },
      });
      await database.client.issueFileAttachment.deleteMany({
        where: { workspaceId: fixture.workspaceId },
      });
      await database.client.file.deleteMany({ where: { uploadedByUserId: fixture.userId } });
      await database.client.issue.deleteMany({ where: { workspaceId: fixture.workspaceId } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: fixture.workspaceId },
      });
      await database.client.team.deleteMany({ where: { workspaceId: fixture.workspaceId } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: fixture.workspaceId },
      });
      await database.client.workspace.delete({ where: { id: fixture.workspaceId } });
      await database.client.user.delete({ where: { id: fixture.userId } });
    }

    await context.close();
    await rm(storageRoot, { force: true, recursive: true });
  });

  async function createFixture(): Promise<Fixture> {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const membershipId = randomUUID();
    const teamId = randomUUID();
    const workflowStateId = randomUUID();
    const issueId = randomUUID();
    const email = `${userId}@example.test`;

    await database.client.$transaction(async (transaction) => {
      await transaction.user.create({
        data: {
          displayName: '파일 정리 사용자',
          email,
          id: userId,
          normalizedEmail: email,
          passwordHash: '$argon2id$file-cleanup-test',
        },
      });
      await transaction.workspace.create({
        data: {
          createdByUserId: userId,
          id: workspaceId,
          name: '파일 정리 워크스페이스',
          normalizedSlug: `file-cleanup-${workspaceId}`,
          slug: `file-cleanup-${workspaceId}`,
        },
      });
      await transaction.workspaceMembership.create({
        data: { id: membershipId, role: MembershipRole.ADMIN, userId, workspaceId },
      });
      await transaction.team.create({
        data: {
          id: teamId,
          key: 'FCL',
          name: '파일 정리 팀',
          normalizedName: '파일 정리 팀',
          workspaceId,
        },
      });
      await transaction.workflowState.create({
        data: {
          category: StateCategory.UNSTARTED,
          id: workflowStateId,
          isDefault: true,
          name: '할 일',
          normalizedName: '할 일',
          position: 0,
          teamId,
          workspaceId,
        },
      });
      await transaction.issue.create({
        data: {
          createdByMembershipId: membershipId,
          id: issueId,
          identifier: 'FCL-1',
          sequenceNumber: 1,
          teamId,
          title: '파일 정리 작업',
          type: IssueType.TEAM_TASK,
          workflowStateId,
          workspaceId,
        },
      });
    });

    return { issueId, membershipId, teamId, userId, workflowStateId, workspaceId };
  }

  async function createWorkspaceFile(
    storageKey: string,
    unlinkedAt: Date | null,
    scope: FileScope = FileScope.WORKSPACE,
  ) {
    if (!fixture) throw new Error('fixture not initialized');

    return database.client.file.create({
      data: {
        detectedMimeType: 'application/octet-stream',
        originalName: 'fixture.bin',
        scope,
        sizeBytes: 1n,
        storageKey,
        unlinkedAt,
        uploadedByUserId: fixture.userId,
        workspaceId: scope === FileScope.WORKSPACE ? fixture.workspaceId : null,
      },
    });
  }

  async function createObject(storageKey: string, modifiedAt: Date): Promise<string> {
    const path = join(storageRoot, storageKey);
    await writeFile(path, 'x');
    await utimes(path, modifiedAt, modifiedAt);
    return path;
  }

  it('holds the daily maintenance advisory lock for the whole cleanup run', async () => {
    let finishCleanup: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const finished = new Promise<FileCleanupResult>((resolve) => {
      finishCleanup = () =>
        resolve({
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
        });
    });
    const internal = service as unknown as {
      performCleanup(jobId: string): Promise<FileCleanupResult>;
    };
    const cleanup = jest.spyOn(internal, 'performCleanup').mockImplementation(async () => {
      markStarted?.();
      return finished;
    });
    const running = service.cleanupOnce('file_cleanup_lock_duration');
    await started;
    const contender = new Client({ connectionString: process.env.DATABASE_URL });

    try {
      await contender.connect();
      const locked = await contender.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS "acquired"',
        ['rivet:daily-maintenance:v1'],
      );
      expect(locked.rows[0]?.acquired).toBe(false);

      finishCleanup?.();
      await running;

      const released = await contender.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS "acquired"',
        ['rivet:daily-maintenance:v1'],
      );
      expect(released.rows[0]?.acquired).toBe(true);
      await contender.query('SELECT pg_advisory_unlock(hashtext($1))', [
        'rivet:daily-maintenance:v1',
      ]);
    } finally {
      cleanup.mockRestore();
      await contender.end();
    }
  });

  it('protects linked files and idempotently removes expired metadata, tmp files, and orphans', async () => {
    if (!fixture) throw new Error('fixture not initialized');
    const { issueId, membershipId, userId, workspaceId } = fixture;

    const old = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    const oldTemporary = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    const young = new Date();
    const expiredStorageKey = `objects/${randomUUID()}`;
    const missingExpiredStorageKey = `objects/${randomUUID()}`;
    const avatarStorageKey = `objects/${randomUUID()}`;
    const attachmentStorageKey = `objects/${randomUUID()}`;
    const missingLinkedStorageKey = `objects/${randomUUID()}`;
    const youngMissingStorageKey = `objects/${randomUUID()}`;
    const expired = await createWorkspaceFile(expiredStorageKey, old);
    const missingExpired = await createWorkspaceFile(missingExpiredStorageKey, old);
    const avatar = await createWorkspaceFile(avatarStorageKey, old, FileScope.USER_PROFILE);
    const attachment = await createWorkspaceFile(attachmentStorageKey, old);
    const missingLinked = await createWorkspaceFile(missingLinkedStorageKey, old);
    const youngMissing = await createWorkspaceFile(youngMissingStorageKey, young);
    const invalidStorageKey = await createWorkspaceFile(`../${randomUUID()}`, old);
    const invalidVersionStorageKey = 'objects/00000000-0000-1000-8000-000000000000';
    const invalidVersion = await createWorkspaceFile(invalidVersionStorageKey, old);
    const symlinkStorageKey = `objects/${randomUUID()}`;
    const symlinkFile = await createWorkspaceFile(symlinkStorageKey, old);

    await database.client.user.update({
      data: { avatarFileId: avatar.id },
      where: { id: userId },
    });
    await database.client.issueFileAttachment.createMany({
      data: [attachment, missingLinked].map((file) => ({
        createdByMembershipId: membershipId,
        fileId: file.id,
        issueId,
        kind: IssueFileKind.ISSUE_ATTACHMENT,
        workspaceId,
      })),
    });

    const expiredPath = await createObject(expiredStorageKey, old);
    const avatarPath = await createObject(avatarStorageKey, old);
    const attachmentPath = await createObject(attachmentStorageKey, old);
    const invalidVersionPath = await createObject(invalidVersionStorageKey, old);
    const metadataSymlinkPath = join(storageRoot, symlinkStorageKey);
    await symlink(avatarPath, metadataSymlinkPath);
    const oldTemporaryPath = join(temporaryDirectory, 'old-upload');
    const youngTemporaryPath = join(temporaryDirectory, 'young-upload');
    const temporaryDirectoryPath = join(temporaryDirectory, 'old-directory');
    const temporarySymlinkPath = join(temporaryDirectory, 'old-symlink');
    await writeFile(oldTemporaryPath, 'old');
    await writeFile(youngTemporaryPath, 'young');
    await mkdir(temporaryDirectoryPath);
    await symlink(oldTemporaryPath, temporarySymlinkPath);
    await utimes(oldTemporaryPath, oldTemporary, oldTemporary);
    const oldOrphanPath = await createObject(`objects/${randomUUID()}`, old);
    const youngOrphanPath = await createObject(`objects/${randomUUID()}`, young);
    const invalidOrphanPath = join(objectsDirectory, 'not-a-uuid');
    const orphanSymlinkPath = join(objectsDirectory, randomUUID());
    await writeFile(invalidOrphanPath, 'invalid');
    await utimes(invalidOrphanPath, old, old);
    await symlink(avatarPath, orphanSymlinkPath);

    const first = await service.cleanupOnce('file_cleanup_integration_first');

    await expect(
      database.client.file.findUnique({ where: { id: expired.id } }),
    ).resolves.toBeNull();
    await expect(
      database.client.file.findUnique({ where: { id: missingExpired.id } }),
    ).resolves.toBeNull();
    await expect(
      database.client.file.findUnique({ where: { id: invalidStorageKey.id } }),
    ).resolves.not.toBeNull();
    await expect(
      database.client.file.findUnique({ where: { id: invalidVersion.id } }),
    ).resolves.not.toBeNull();
    await expect(
      database.client.file.findUnique({ where: { id: symlinkFile.id } }),
    ).resolves.not.toBeNull();
    await expect(
      database.client.file.findUnique({ where: { id: youngMissing.id } }),
    ).resolves.not.toBeNull();
    await expect(access(expiredPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(avatarPath)).resolves.toBeUndefined();
    await expect(access(attachmentPath)).resolves.toBeUndefined();
    await expect(access(invalidVersionPath)).resolves.toBeUndefined();
    expect((await lstat(metadataSymlinkPath)).isSymbolicLink()).toBe(true);
    await expect(access(oldTemporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(youngTemporaryPath)).resolves.toBeUndefined();
    await expect(lstat(temporaryDirectoryPath)).resolves.toEqual(expect.objectContaining({}));
    await expect(lstat(temporarySymlinkPath)).resolves.toEqual(expect.objectContaining({}));
    await expect(access(oldOrphanPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(youngOrphanPath)).resolves.toBeUndefined();
    await expect(access(invalidOrphanPath)).resolves.toBeUndefined();
    await expect(lstat(orphanSymlinkPath)).resolves.toEqual(expect.objectContaining({}));
    expect(first).toMatchObject({
      deletedMetadata: 2,
      deletedOrphans: 1,
      deletedTemporaryFiles: 1,
      skippedByLock: false,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'FILE_BINARY_MISSING',
        fileId: missingLinked.id,
        isLinked: true,
      }),
      '파일 바이너리가 없음',
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'FILE_BINARY_MISSING', fileId: youngMissing.id }),
      '파일 바이너리가 없음',
    );
    expect(alert).toHaveBeenCalledWith({
      errorCode: 'FILE_BINARY_MISSING',
      jobId: 'file_cleanup_integration_first',
      type: 'LINKED_FILE_BINARY_MISSING',
    });
    await expect(
      database.client.issueFileAttachment.count({
        where: { fileId: { in: [attachment.id, missingLinked.id] } },
      }),
    ).resolves.toBe(2);
    await expect(
      database.client.user.findUniqueOrThrow({ where: { id: userId } }),
    ).resolves.toMatchObject({ avatarFileId: avatar.id });

    const second = await service.cleanupOnce('file_cleanup_integration_second');

    expect(second).toMatchObject({
      deletedBinaries: 0,
      deletedMetadata: 0,
      deletedOrphans: 0,
      deletedTemporaryFiles: 0,
      skippedByLock: false,
    });
    await expect(access(avatarPath)).resolves.toBeUndefined();
    await expect(access(attachmentPath)).resolves.toBeUndefined();
  });
});
