import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import type { Response } from 'express';

import type { ObservabilityService } from '../../common/observability/observability.service';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { ExportsController } from './exports.controller';
import type { CsvExportRun, ExportsService } from './exports.service';

const AUDIT_ID = 'd840a59f-e92c-4a43-9315-54f50788dc25';
const MEMBERSHIP_ID = '69b38d72-6a3b-4f3c-a2e7-2b2f6941c3dc';
const WORKSPACE_ID = '7f5f6cb1-d957-438d-aafe-a9b51d01ad5b';

const authentication: AuthenticatedRequestContext = {
  session: {
    membership: {
      id: MEMBERSHIP_ID,
      role: 'ADMIN',
      status: 'ACTIVE',
      workspaceId: WORKSPACE_ID,
    },
    sessionId: '76713790-aac0-452a-bfc4-9c55440b53c6',
    user: {
      avatarFileId: null,
      displayName: '관리자',
      email: 'admin@example.test',
      emailVerifiedAt: new Date('2026-07-10T00:00:00.000Z'),
      id: '725203bb-18fc-4b15-8bd1-2096e9514716',
    },
    workspace: {
      id: WORKSPACE_ID,
      name: 'Rivet',
      slug: 'rivet',
      version: 1,
    },
  },
  sessionToken: 'session-token',
};

type MockResponse = Response &
  EventEmitter & {
    chunks: string[];
    destroy: jest.Mock;
    end: jest.Mock;
    flushHeaders: jest.Mock;
    setHeader: jest.Mock;
    status: jest.Mock;
    write: jest.Mock;
  };

async function* csvRows(...rows: string[]): AsyncGenerator<string, void, void> {
  for (const row of rows) yield row;
}

async function* failedRows(): AsyncGenerator<string, void, void> {
  yield await Promise.reject(new Error('EXPORT_GENERATION_FAILED'));
}

function run(rows: AsyncGenerator<string, void, void>): CsvExportRun {
  return { auditId: AUDIT_ID, header: '"헤더"\r\n', rows };
}

function response(endOutcome: 'CLOSE' | 'FINISH' = 'FINISH'): MockResponse {
  const value = Object.assign(new EventEmitter(), {
    chunks: [] as string[],
    destroy: jest.fn(),
    destroyed: false,
    end: jest.fn(),
    flushHeaders: jest.fn(),
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn(),
    writableEnded: false,
    write: jest.fn(),
  }) as unknown as MockResponse;

  value.status.mockReturnValue(value);
  value.flushHeaders.mockImplementation(() => {
    value.headersSent = true;
  });
  value.write.mockImplementation((chunk: string) => {
    value.chunks.push(chunk);
    return true;
  });
  value.end.mockImplementation(() => {
    Object.defineProperty(value, 'writableEnded', { value: true, writable: true });
    queueMicrotask(() => value.emit(endOutcome === 'FINISH' ? 'finish' : 'close'));
    return value;
  });
  value.destroy.mockImplementation(() => {
    Object.defineProperty(value, 'destroyed', { value: true, writable: true });
    queueMicrotask(() => value.emit('close'));
    return value;
  });

  return value;
}

describe('ExportsController', () => {
  const beginIssues = jest.fn();
  const beginProjects = jest.fn();
  const markCompleted = jest.fn();
  const markDownloaded = jest.fn();
  const markFailed = jest.fn();
  const exportsService = {
    beginIssues,
    beginProjects,
    markCompleted,
    markDownloaded,
    markFailed,
  } as unknown as ExportsService;
  const capture = jest.fn();
  const controller = new ExportsController(exportsService, {
    capture,
  } as unknown as ObservabilityService);
  const context = { membershipId: MEMBERSHIP_ID, workspaceId: WORKSPACE_ID };
  let warn: jest.SpiedFunction<Logger['warn']>;
  let error: jest.SpiedFunction<Logger['error']>;

  beforeAll(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    beginIssues.mockResolvedValue(run(csvRows('"행1"\r\n', '"행2"\r\n')));
    beginProjects.mockResolvedValue(run(csvRows('"프로젝트"\r\n')));
    markCompleted.mockResolvedValue(undefined);
    markDownloaded.mockResolvedValue(undefined);
    markFailed.mockResolvedValue(undefined);
  });

  it('streams a BOM CSV and records download only after the response finish event', async () => {
    const httpResponse = response();

    await controller.issues(authentication, httpResponse);

    expect(httpResponse.status).toHaveBeenCalledWith(200);
    expect(httpResponse.setHeader.mock.calls).toEqual(
      expect.arrayContaining([
        ['Content-Type', 'text/csv; charset=utf-8'],
        ['Cache-Control', 'private, no-store'],
        ['X-Content-Type-Options', 'nosniff'],
        ['X-Accel-Buffering', 'no'],
      ]),
    );
    expect(httpResponse.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/^attachment; filename="rivet-issues-\d{8}\.csv"$/),
    );
    expect(httpResponse.chunks).toEqual(['\uFEFF"헤더"\r\n', '"행1"\r\n', '"행2"\r\n']);
    expect(markCompleted).toHaveBeenCalledWith(context, AUDIT_ID, 2);
    expect(markDownloaded).toHaveBeenCalledWith(context, AUDIT_ID);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: MEMBERSHIP_ID,
        name: 'csv_exported',
        properties: { exportType: 'ISSUES', itemCount: 2 },
        workspaceId: WORKSPACE_ID,
      }),
    );
    expect(markFailed).not.toHaveBeenCalled();
    expect(markCompleted.mock.invocationCallOrder[0]).toBeLessThan(
      markDownloaded.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps generation completion but records failure when close wins before finish', async () => {
    const httpResponse = response('CLOSE');

    await controller.projects(authentication, httpResponse);

    expect(markCompleted).toHaveBeenCalledWith(context, AUDIT_ID, 1);
    expect(markDownloaded).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(context, AUDIT_ID, 'EXPORT_RESPONSE_CLOSED');
  });

  it('does not report a finished response as a stream failure when only the audit update fails', async () => {
    const httpResponse = response();
    markDownloaded.mockRejectedValueOnce(new Error('database unavailable'));

    await controller.projects(authentication, httpResponse);

    expect(markCompleted).toHaveBeenCalledWith(context, AUDIT_ID, 1);
    expect(markDownloaded).toHaveBeenCalledWith(context, AUDIT_ID);
    expect(markFailed).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'EXPORT_AUDIT_UPDATE_FAILED' }),
      'CSV 다운로드 완료 감사 갱신 실패',
    );
  });

  it('records an error event without marking the export completed or downloaded', async () => {
    const httpResponse = response();
    httpResponse.write
      .mockImplementationOnce((chunk: string) => {
        httpResponse.chunks.push(chunk);
        return true;
      })
      .mockImplementationOnce((chunk: string) => {
        httpResponse.chunks.push(chunk);
        queueMicrotask(() => httpResponse.emit('error', new Error('socket failed')));
        return false;
      });
    beginIssues.mockResolvedValueOnce(run(csvRows('"행"\r\n')));

    await controller.issues(authentication, httpResponse);

    expect(markCompleted).not.toHaveBeenCalled();
    expect(markDownloaded).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(context, AUDIT_ID, 'EXPORT_RESPONSE_ERROR');
    expect(httpResponse.destroy).toHaveBeenCalledTimes(1);
  });

  it('distinguishes CSV generation failure from a client disconnect', async () => {
    const httpResponse = response();
    beginIssues.mockResolvedValueOnce(run(failedRows()));

    await controller.issues(authentication, httpResponse);

    expect(markCompleted).not.toHaveBeenCalled();
    expect(markDownloaded).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(context, AUDIT_ID, 'EXPORT_GENERATION_FAILED');
    expect(httpResponse.destroy).toHaveBeenCalledTimes(1);
  });

  it('records an already closed response before opening CSV headers', async () => {
    const httpResponse = response();
    Object.defineProperty(httpResponse, 'destroyed', { value: true, writable: true });

    await controller.issues(authentication, httpResponse);

    expect(httpResponse.setHeader).not.toHaveBeenCalled();
    expect(markCompleted).not.toHaveBeenCalled();
    expect(markDownloaded).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(context, AUDIT_ID, 'EXPORT_RESPONSE_CLOSED');
  });

  it('does not trust a direct controller call without a matching active admin membership', () => {
    const memberAuthentication: AuthenticatedRequestContext = {
      ...authentication,
      session: {
        ...authentication.session,
        membership: {
          id: MEMBERSHIP_ID,
          role: 'MEMBER',
          status: 'ACTIVE',
          workspaceId: WORKSPACE_ID,
        },
      },
    };

    expect(() => controller.issues(memberAuthentication, response())).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
        status: 403,
      }),
    );
    expect(beginIssues).not.toHaveBeenCalled();
  });
});
