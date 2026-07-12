export class CanceledOutboxError extends Error {
  constructor(
    readonly code: 'DEV_RECIPIENT_BLOCKED' | 'EMAIL_TOKEN_INACTIVE' | 'RESOURCE_PURGE_CANCELED',
  ) {
    super(code);
    this.name = CanceledOutboxError.name;
  }
}

export class RetryableOutboxError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = RetryableOutboxError.name;
  }
}

export class PermanentOutboxError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = PermanentOutboxError.name;
  }
}
