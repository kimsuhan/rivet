import type { ConfigType } from '@nestjs/config';

import { FeedbackCategory, FeedbackStatus } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ObservabilityService } from '../../common/observability/observability.service';
import { apiConfig } from '../../config/api.config';
import { FeedbackService } from './feedback.service';

const context = {
  membershipId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '11111111-1111-4111-8111-111111111111',
};
const now = new Date('2026-07-18T00:00:00.000Z');
const row = {
  body: '검색 결과에서 원하는 항목을 찾기 어려웠습니다.',
  category: FeedbackCategory.USABILITY,
  createdAt: now,
  currentPath: '/ko/issues',
  id: '33333333-3333-4333-8333-333333333333',
  releaseId: 'alpha-a5',
  retentionExpiresAt: new Date('2027-07-18T00:00:00.000Z'),
  status: FeedbackStatus.RECEIVED,
  statusChangedAt: now,
  statusChangedByMembershipId: null,
  submissionId: '44444444-4444-4444-8444-444444444444',
  submittedByMembershipId: context.membershipId,
  updatedAt: now,
  version: 1,
  workspaceId: context.workspaceId,
};

describe('FeedbackService', () => {
  const productFeedback = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  };
  const client = {
    $transaction: jest.fn(
      (operation: (transaction: { productFeedback: typeof productFeedback }) => unknown) =>
        operation({ productFeedback }),
    ),
    productFeedback,
  };
  const capture = jest.fn();
  const service = new FeedbackService(
    { releaseId: 'alpha-a5' } as ConfigType<typeof apiConfig>,
    { client } as unknown as DatabaseService,
    { capture } as unknown as ObservabilityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    productFeedback.findFirst.mockResolvedValue(null);
    productFeedback.create.mockResolvedValue(row);
  });

  it('stores normalized feedback once and emits only category metadata', async () => {
    await expect(
      service.submit(context, {
        body: `  ${row.body}  `,
        category: 'USABILITY',
        currentPath: row.currentPath,
        submissionId: row.submissionId,
      }),
    ).resolves.toEqual({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      status: 'RECEIVED',
      submissionId: row.submissionId,
    });

    expect(productFeedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: row.body,
        category: 'USABILITY',
        submittedByMembershipId: context.membershipId,
        workspaceId: context.workspaceId,
      }),
    });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: row.id,
        name: 'feedback_submitted',
        properties: { category: 'USABILITY' },
      }),
    );
    expect(JSON.stringify(capture.mock.calls)).not.toContain(row.body);
  });

  it('returns an identical retried submission without creating or double counting it', async () => {
    productFeedback.findFirst.mockResolvedValue(row);

    await service.submit(context, {
      body: row.body,
      category: 'USABILITY',
      currentPath: row.currentPath,
      submissionId: row.submissionId,
    });

    expect(productFeedback.create).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects reuse of a submission ID for different body content', async () => {
    productFeedback.findFirst.mockResolvedValue(row);

    await expect(
      service.submit(context, {
        body: '같은 식별자에 다른 피드백 내용을 넣었습니다.',
        category: 'BUG',
        currentPath: row.currentPath,
        submissionId: row.submissionId,
      }),
    ).rejects.toMatchObject({ response: { code: 'FEEDBACK_SUBMISSION_CONFLICT' } });
  });

  it('scopes administrator list and status writes to the active workspace', async () => {
    productFeedback.findMany.mockResolvedValue([row]);
    productFeedback.findFirst.mockResolvedValue(row);
    productFeedback.updateMany.mockResolvedValue({ count: 1 });
    productFeedback.findFirstOrThrow.mockResolvedValue({
      ...row,
      status: FeedbackStatus.IN_REVIEW,
      statusChangedByMembershipId: context.membershipId,
      version: 2,
    });

    await service.list(context, { limit: 20 });
    await service.updateStatus(context, row.id, { status: 'IN_REVIEW', version: 1 });

    expect(productFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: context.workspaceId }),
      }),
    );
    expect(productFeedback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: context.workspaceId }),
      }),
    );
  });
});
