export function isEmailRecipientAllowed(
  environment: 'development' | 'test' | 'production',
  recipient: string,
  allowedRecipients: string[],
): boolean {
  return environment === 'production' || allowedRecipients.includes(recipient.trim().toLowerCase());
}
