import { Injectable } from '@nestjs/common';

import { type EmailTemplateType } from '@rivet/database';

import { DatabaseService } from '../../common/database/database.service';
import { CanceledOutboxError, PermanentOutboxError } from '../outbox/outbox-errors';
import { EmailDeliveryError } from './email-delivery.error';
import { EmailSenderService } from './email-sender.service';

type DeliverEmailCommand = {
  html: string;
  outboxEventId: string;
  recipient: string;
  subject: string;
  templateType: EmailTemplateType;
  text: string;
};

type EmailDeliveryState = {
  failedAt: Date | null;
  id: string;
  lastErrorCode: string | null;
  recipientEmail: string;
  sentAt: Date | null;
  templateType: EmailTemplateType;
};

@Injectable()
export class EmailDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly emailSender: EmailSenderService,
  ) {}

  async deliver(command: DeliverEmailCommand): Promise<void> {
    const delivery = await this.ensureDelivery(
      command.outboxEventId,
      command.recipient,
      command.templateType,
    );

    if (
      delivery.recipientEmail !== command.recipient ||
      delivery.templateType !== command.templateType
    ) {
      throw new PermanentOutboxError('EMAIL_DELIVERY_CONTRACT_INVALID');
    }

    this.replayTerminalResult(delivery);

    if (delivery.sentAt) {
      return;
    }

    try {
      const result = await this.emailSender.send({
        html: command.html,
        outboxEventId: command.outboxEventId,
        recipient: command.recipient,
        subject: command.subject,
        text: command.text,
      });
      await this.markSent(delivery.id, result.providerMessageId);
    } catch (error) {
      if (!(error instanceof EmailDeliveryError)) {
        throw error;
      }

      await this.markFailed(delivery.id, error.code, !error.isRetryable);

      if (error.code === 'DEV_RECIPIENT_BLOCKED') {
        throw new CanceledOutboxError(error.code);
      }

      throw error;
    }
  }

  private async ensureDelivery(
    outboxEventId: string,
    recipientEmail: string,
    templateType: EmailTemplateType,
  ): Promise<EmailDeliveryState> {
    return this.database.client.emailDelivery.upsert({
      create: { outboxEventId, recipientEmail, templateType },
      select: {
        failedAt: true,
        id: true,
        lastErrorCode: true,
        recipientEmail: true,
        sentAt: true,
        templateType: true,
      },
      update: {},
      where: { outboxEventId },
    });
  }

  private replayTerminalResult(delivery: EmailDeliveryState): void {
    if (!delivery.failedAt) {
      return;
    }

    if (delivery.lastErrorCode === 'DEV_RECIPIENT_BLOCKED') {
      throw new CanceledOutboxError(delivery.lastErrorCode);
    }

    if (delivery.lastErrorCode === 'EMAIL_PROVIDER_REJECTED') {
      throw new EmailDeliveryError(delivery.lastErrorCode, false);
    }

    throw new PermanentOutboxError('EMAIL_DELIVERY_RESULT_INVALID');
  }

  private async markSent(deliveryId: string, providerMessageId: string): Promise<void> {
    const count = await this.database.client.$executeRaw`
      UPDATE "email_deliveries"
      SET "provider_message_id" = ${providerMessageId},
          "sent_at" = NOW(),
          "last_error_code" = NULL,
          "updated_at" = NOW()
      WHERE "id" = ${deliveryId}::uuid
        AND "sent_at" IS NULL
        AND "failed_at" IS NULL
    `;

    if (count !== 1) {
      throw new PermanentOutboxError('EMAIL_DELIVERY_RESULT_CONFLICT');
    }
  }

  private async markFailed(
    deliveryId: string,
    errorCode: string,
    isTerminal: boolean,
  ): Promise<void> {
    const count = isTerminal
      ? await this.database.client.$executeRaw`
          UPDATE "email_deliveries"
          SET "failed_at" = NOW(),
              "last_error_code" = ${errorCode},
              "updated_at" = NOW()
          WHERE "id" = ${deliveryId}::uuid
            AND "sent_at" IS NULL
            AND "failed_at" IS NULL
        `
      : await this.database.client.$executeRaw`
          UPDATE "email_deliveries"
          SET "last_error_code" = ${errorCode},
              "updated_at" = NOW()
          WHERE "id" = ${deliveryId}::uuid
            AND "sent_at" IS NULL
            AND "failed_at" IS NULL
        `;

    if (count !== 1) {
      throw new PermanentOutboxError('EMAIL_DELIVERY_RESULT_CONFLICT');
    }
  }
}
