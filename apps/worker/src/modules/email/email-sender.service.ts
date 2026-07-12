import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { workerConfig } from '../../config/worker.config';
import { EmailDeliveryError } from './email-delivery.error';
import { isEmailRecipientAllowed } from './email-recipient-policy';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

export type SendEmailCommand = {
  html: string;
  outboxEventId: string;
  recipient: string;
  subject: string;
  text: string;
};

function readProviderMessageId(value: unknown): string | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0
  ) {
    return null;
  }

  return value.id;
}

@Injectable()
export class EmailSenderService {
  constructor(@Inject(workerConfig.KEY) private readonly config: ConfigType<typeof workerConfig>) {}

  async send(command: SendEmailCommand): Promise<{ providerMessageId: string }> {
    if (
      !isEmailRecipientAllowed(
        this.config.environment,
        command.recipient,
        this.config.email.allowedRecipients,
      )
    ) {
      throw new EmailDeliveryError('DEV_RECIPIENT_BLOCKED', false);
    }

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        body: JSON.stringify({
          from: this.config.email.from,
          html: command.html,
          subject: command.subject,
          text: command.text,
          to: [command.recipient],
        }),
        headers: {
          Authorization: `Bearer ${this.config.email.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': command.outboxEventId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new EmailDeliveryError('EMAIL_PROVIDER_RATE_LIMITED', true);
        }

        if (response.status >= 400 && response.status < 500) {
          throw new EmailDeliveryError('EMAIL_PROVIDER_REJECTED', false);
        }

        throw new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);
      }

      const providerMessageId = readProviderMessageId(await response.json());

      if (!providerMessageId) {
        throw new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);
      }

      return { providerMessageId };
    } catch (error) {
      if (error instanceof EmailDeliveryError) {
        throw error;
      }

      throw new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);
    }
  }
}
