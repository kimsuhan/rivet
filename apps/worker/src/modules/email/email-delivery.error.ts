export class EmailDeliveryError extends Error {
  constructor(
    readonly code:
      | 'DEV_RECIPIENT_BLOCKED'
      | 'EMAIL_PROVIDER_RATE_LIMITED'
      | 'EMAIL_PROVIDER_REJECTED'
      | 'EMAIL_PROVIDER_UNAVAILABLE',
    readonly isRetryable: boolean,
  ) {
    super(code);
    this.name = EmailDeliveryError.name;
  }
}
