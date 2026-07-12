import { Test } from '@nestjs/testing';

import { workerConfig } from '../../config/worker.config';
import { EmailSenderService } from './email-sender.service';

const command = {
  html: '<p>인증 링크</p>',
  outboxEventId: 'f57fa7be-1fe9-4744-a8db-704bf989a3cd',
  recipient: 'allowed@example.test',
  subject: '이메일 인증',
  text: '인증 링크',
};

describe('EmailSenderService', () => {
  let config: {
    email: { allowedRecipients: string[]; apiKey: string; from: string };
    environment: 'development' | 'test';
  };
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let sender: EmailSenderService;

  beforeEach(async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    config = {
      email: {
        allowedRecipients: ['allowed@example.test'],
        apiKey: 're_test_worker_dummy',
        from: 'rivet-worker@example.test',
      },
      environment: 'development',
    };
    const module = await Test.createTestingModule({
      providers: [
        EmailSenderService,
        {
          provide: workerConfig.KEY,
          useValue: config,
        },
      ],
    }).compile();
    sender = module.get(EmailSenderService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('uses the Outbox event ID as the Resend idempotency key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'provider-message-id' }), { status: 200 }),
    );

    await expect(sender.send(command)).resolves.toEqual({
      providerMessageId: 'provider-message-id',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        body: JSON.stringify({
          from: 'rivet-worker@example.test',
          html: command.html,
          subject: command.subject,
          text: command.text,
          to: [command.recipient],
        }),
        headers: {
          Authorization: 'Bearer re_test_worker_dummy',
          'Content-Type': 'application/json',
          'Idempotency-Key': command.outboxEventId,
        },
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    [429, 'EMAIL_PROVIDER_RATE_LIMITED', true],
    [503, 'EMAIL_PROVIDER_UNAVAILABLE', true],
    [400, 'EMAIL_PROVIDER_REJECTED', false],
  ] as const)(
    'classifies an HTTP %s response without reading its body',
    async (status, code, isRetryable) => {
      const response = new Response('provider details must stay private', { status });
      const json = jest.spyOn(response, 'json');
      fetchMock.mockResolvedValue(response);

      await expect(sender.send(command)).rejects.toMatchObject({ code, isRetryable });
      expect(json).not.toHaveBeenCalled();
    },
  );

  it('classifies network and timeout failures as retryable provider failures', async () => {
    fetchMock.mockRejectedValue(new DOMException('request aborted', 'AbortError'));

    await expect(sender.send(command)).rejects.toMatchObject({
      code: 'EMAIL_PROVIDER_UNAVAILABLE',
      isRetryable: true,
    });
  });

  it.each(['development', 'test'] as const)(
    'blocks a non-allowlisted %s recipient before the external request',
    async (environment) => {
      config.environment = environment;

      await expect(
        sender.send({ ...command, recipient: 'blocked@example.test' }),
      ).rejects.toMatchObject({ code: 'DEV_RECIPIENT_BLOCKED', isRetryable: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
