import { HttpException } from '@nestjs/common';

export class ApiError extends HttpException {
  readonly retryAfterSeconds?: number;

  constructor(options: {
    code: string;
    currentVersion?: number;
    details?: Record<string, unknown>;
    fieldErrors?: Record<string, string[]>;
    message: string;
    retryAfterSeconds?: number;
    status: number;
  }) {
    const response: Record<string, unknown> = {
      code: options.code,
      fieldErrors: options.fieldErrors ?? {},
      message: options.message,
    };

    if (options.currentVersion !== undefined) {
      response.currentVersion = options.currentVersion;
    }

    if (options.details !== undefined) {
      response.details = options.details;
    }

    super(response, options.status);
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}
