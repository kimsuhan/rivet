import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { FeedbackCategory, FeedbackStatus, Prisma } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { ApiError } from '../../common/errors/api-error';
import { ObservabilityService } from '../../common/observability/observability.service';
import { productEvent } from '../../common/observability/product-event';
import { apiConfig } from '../../config/api.config';
import type {
  FeedbackListResponseDto,
  FeedbackResponseDto,
  FeedbackSubmissionReceiptDto,
  ListFeedbackQueryDto,
  SubmitFeedbackDto,
  UpdateFeedbackStatusDto,
} from './dto/feedback.dto';

type FeedbackContext = { membershipId: string; workspaceId: string };
type FeedbackRow = Awaited<
  ReturnType<DatabaseService['client']['productFeedback']['findFirstOrThrow']>
>;

const RETENTION_DAYS = 365;

function notFound(): never {
  throw new ApiError({
    code: 'RESOURCE_NOT_FOUND',
    message: '피드백을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  });
}

function invalidCursor(): never {
  throw new ApiError({
    code: 'INVALID_QUERY',
    message: '피드백 커서를 확인해 주세요.',
    status: HttpStatus.BAD_REQUEST,
  });
}

function parseCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidCursor();
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) invalidCursor();
    const parsed = JSON.parse(decoded.toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    )
      invalidCursor();
    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== parsed[0]) invalidCursor();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed[1]))
      invalidCursor();
    return { createdAt, id: parsed[1] };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return invalidCursor();
  }
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

@Injectable()
export class FeedbackService {
  constructor(
    @Inject(apiConfig.KEY) private readonly config: ConfigType<typeof apiConfig>,
    private readonly database: DatabaseService,
    private readonly observability: ObservabilityService,
  ) {}

  async submit(
    context: FeedbackContext,
    dto: SubmitFeedbackDto,
  ): Promise<FeedbackSubmissionReceiptDto> {
    const normalized = {
      body: dto.body.normalize('NFC').trim(),
      category: dto.category as FeedbackCategory,
      currentPath: dto.currentPath.normalize('NFC').trim(),
    };
    let created = false;
    let row: FeedbackRow;
    try {
      row = await this.database.client.$transaction(async (transaction) => {
        const existing = await transaction.productFeedback.findFirst({
          where: {
            submissionId: dto.submissionId,
            submittedByMembershipId: context.membershipId,
            workspaceId: context.workspaceId,
          },
        });
        if (existing) return this.sameSubmission(existing, normalized);
        created = true;
        return transaction.productFeedback.create({
          data: {
            ...normalized,
            releaseId: this.config.releaseId,
            retentionExpiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1_000),
            submissionId: dto.submissionId,
            submittedByMembershipId: context.membershipId,
            workspaceId: context.workspaceId,
          },
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      const existing = await this.database.client.productFeedback.findFirst({
        where: {
          submissionId: dto.submissionId,
          submittedByMembershipId: context.membershipId,
          workspaceId: context.workspaceId,
        },
      });
      if (!existing) throw error;
      created = false;
      row = this.sameSubmission(existing, normalized);
    }

    if (created) {
      this.observability.capture(
        productEvent(
          context,
          'feedback_submitted',
          { category: row.category },
          { eventId: row.id, occurredAt: row.createdAt },
        ),
      );
    }
    return {
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      status: row.status,
      submissionId: row.submissionId,
    };
  }

  async list(
    context: FeedbackContext,
    query: ListFeedbackQueryDto,
  ): Promise<FeedbackListResponseDto> {
    const cursor = parseCursor(query.cursor);
    const limit = query.limit ?? 50;
    const rows = await this.database.client.productFeedback.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      where: {
        ...(query.category ? { category: query.category as FeedbackCategory } : {}),
        ...(query.status ? { status: query.status as FeedbackStatus } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
        workspaceId: context.workspaceId,
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.response(row)),
      nextCursor:
        rows.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  async updateStatus(
    context: FeedbackContext,
    feedbackId: string,
    dto: UpdateFeedbackStatusDto,
  ): Promise<FeedbackResponseDto> {
    const current = await this.database.client.productFeedback.findFirst({
      where: { id: feedbackId, workspaceId: context.workspaceId },
    });
    if (!current) notFound();
    if (current.version !== dto.version) {
      throw new ApiError({
        code: 'FEEDBACK_VERSION_CONFLICT',
        currentVersion: current.version,
        message: '다른 변경이 있어 최신 피드백을 다시 불러와야 합니다.',
        status: HttpStatus.CONFLICT,
      });
    }
    if (current.status === dto.status) return this.response(current);

    const updated = await this.database.client.productFeedback.updateMany({
      data: {
        status: dto.status as FeedbackStatus,
        statusChangedAt: new Date(),
        statusChangedByMembershipId: context.membershipId,
        version: { increment: 1 },
      },
      where: { id: feedbackId, version: dto.version, workspaceId: context.workspaceId },
    });
    if (updated.count === 0) {
      const latest = await this.database.client.productFeedback.findFirst({
        where: { id: feedbackId, workspaceId: context.workspaceId },
      });
      if (!latest) notFound();
      throw new ApiError({
        code: 'FEEDBACK_VERSION_CONFLICT',
        currentVersion: latest.version,
        message: '다른 변경이 있어 최신 피드백을 다시 불러와야 합니다.',
        status: HttpStatus.CONFLICT,
      });
    }
    return this.response(
      await this.database.client.productFeedback.findFirstOrThrow({
        where: { id: feedbackId, workspaceId: context.workspaceId },
      }),
    );
  }

  private sameSubmission(
    row: FeedbackRow,
    normalized: { body: string; category: FeedbackCategory; currentPath: string },
  ): FeedbackRow {
    if (
      row.body !== normalized.body ||
      row.category !== normalized.category ||
      row.currentPath !== normalized.currentPath
    ) {
      throw new ApiError({
        code: 'FEEDBACK_SUBMISSION_CONFLICT',
        message: '같은 제출 식별자로 다른 피드백을 제출할 수 없습니다.',
        status: HttpStatus.CONFLICT,
      });
    }
    return row;
  }

  private response(row: FeedbackRow): FeedbackResponseDto {
    return {
      body: row.body,
      category: row.category,
      createdAt: row.createdAt.toISOString(),
      currentPath: row.currentPath,
      id: row.id,
      releaseId: row.releaseId,
      status: row.status,
      statusChangedAt: row.statusChangedAt.toISOString(),
      statusChangedByMembershipId: row.statusChangedByMembershipId,
      submissionId: row.submissionId,
      submittedByMembershipId: row.submittedByMembershipId,
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      workspaceId: row.workspaceId,
    };
  }
}
