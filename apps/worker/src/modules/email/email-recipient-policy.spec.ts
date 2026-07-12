import { isEmailRecipientAllowed } from './email-recipient-policy';

describe('isEmailRecipientAllowed', () => {
  it.each(['development', 'test'] as const)(
    'allows only normalized allowlist matches in %s',
    (environment) => {
      expect(
        isEmailRecipientAllowed(environment, ' Allowed@Example.test ', ['allowed@example.test']),
      ).toBe(true);
      expect(
        isEmailRecipientAllowed(environment, 'blocked@example.test', ['allowed@example.test']),
      ).toBe(false);
    },
  );

  it('does not apply the allowlist in production', () => {
    expect(isEmailRecipientAllowed('production', 'recipient@example.test', [])).toBe(true);
  });
});
