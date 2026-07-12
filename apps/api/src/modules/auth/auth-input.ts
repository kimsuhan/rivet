import { isEmail } from 'class-validator';

const COMMON_PASSWORDS = new Set([
  '000000000000',
  '111111111111',
  '123123123123',
  '123456789012',
  '1234567890123456',
  'abc123abc123',
  'adminadmin123',
  'asdfghjkl123',
  'changeme123456',
  'iloveyou123456',
  'letmein123456',
  'password1234',
  'password123456',
  'passwordpassword',
  'qwerty123456',
  'qwertyuiop12',
  'welcome123456',
]);

const DANGEROUS_DISPLAY_NAME_PATTERN = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export class AuthInputValidationError extends Error {
  override readonly name = 'AuthInputValidationError';

  constructor(
    readonly field: 'displayName' | 'email' | 'password',
    readonly code:
      | 'DISPLAY_NAME_INVALID'
      | 'EMAIL_INVALID'
      | 'PASSWORD_INVALID'
      | 'PASSWORD_TOO_COMMON'
      | 'PASSWORD_TOO_LONG'
      | 'PASSWORD_TOO_SHORT',
  ) {
    super(code);
  }
}

export function normalizeEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail.length > 254 || !isEmail(normalizedEmail)) {
    throw new AuthInputValidationError('email', 'EMAIL_INVALID');
  }

  return normalizedEmail;
}

export function normalizeDisplayName(displayName: string): string {
  if (DANGEROUS_DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new AuthInputValidationError('displayName', 'DISPLAY_NAME_INVALID');
  }

  const normalizedDisplayName = displayName.trim();
  const length = [...normalizedDisplayName].length;

  if (length < 1 || length > 50) {
    throw new AuthInputValidationError('displayName', 'DISPLAY_NAME_INVALID');
  }

  return normalizedDisplayName;
}

export function validatePassword(password: string, normalizedEmail: string): string {
  const normalizedPassword = normalizePasswordForVerification(password);
  const length = [...normalizedPassword].length;

  if (/\p{Cc}/u.test(normalizedPassword)) {
    throw new AuthInputValidationError('password', 'PASSWORD_INVALID');
  }

  const comparisonPassword = normalizedPassword.toLowerCase();
  const emailLocalPart = normalizedEmail
    .slice(0, normalizedEmail.lastIndexOf('@'))
    .normalize('NFC');

  if (
    COMMON_PASSWORDS.has(comparisonPassword) ||
    comparisonPassword === 'rivet' ||
    comparisonPassword === emailLocalPart.toLowerCase()
  ) {
    throw new AuthInputValidationError('password', 'PASSWORD_TOO_COMMON');
  }

  if (length < 12) {
    throw new AuthInputValidationError('password', 'PASSWORD_TOO_SHORT');
  }

  return normalizedPassword;
}

export function normalizePasswordForVerification(password: string): string {
  const normalizedPassword = password.normalize('NFC');

  if ([...normalizedPassword].length > 128) {
    throw new AuthInputValidationError('password', 'PASSWORD_TOO_LONG');
  }

  return normalizedPassword;
}
