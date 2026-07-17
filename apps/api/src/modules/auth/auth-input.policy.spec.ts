import {
  AuthInputValidationError,
  normalizeDisplayName,
  normalizeEmail,
  normalizePasswordForVerification,
  validatePassword,
} from './auth-input.policy';

describe('auth input', () => {
  describe('normalizeEmail', () => {
    it('trims and lowercases without provider-specific transformations', () => {
      expect(normalizeEmail('  User.Name+tag@Gmail.COM  ')).toBe('user.name+tag@gmail.com');
    });

    it.each(['not-an-email', `${'a'.repeat(243)}@example.com`, 'Name <user@example.com>'])(
      'rejects an invalid email: %s',
      (email) => {
        expect(() => normalizeEmail(email)).toThrow(
          expect.objectContaining({ code: 'EMAIL_INVALID', field: 'email' }),
        );
      },
    );
  });

  describe('normalizeDisplayName', () => {
    it('trims a valid display name and counts Unicode code points', () => {
      expect(normalizeDisplayName('  리벳 사용자  ')).toBe('리벳 사용자');
      expect(normalizeDisplayName('😀'.repeat(50))).toBe('😀'.repeat(50));
    });

    it.each(['   ', 'a'.repeat(51), '사용자\n이름', '사용자\u202e이름', '\t사용자'])(
      'rejects an empty, oversized, control, or bidi display name',
      (displayName) => {
        expect(() => normalizeDisplayName(displayName)).toThrow(
          expect.objectContaining({ code: 'DISPLAY_NAME_INVALID', field: 'displayName' }),
        );
      },
    );
  });

  describe('validatePassword', () => {
    it('normalizes to NFC without trimming the password', () => {
      const decomposed = `  ${'e\u0301'.repeat(6)} safe phrase  `;

      expect(validatePassword(decomposed, 'user@example.com')).toBe(
        `  ${'é'.repeat(6)} safe phrase  `,
      );
    });

    it('counts Unicode code points after NFC normalization', () => {
      expect(validatePassword('😀'.repeat(12), 'user@example.com')).toBe('😀'.repeat(12));
      expect(() => validatePassword('😀'.repeat(129), 'user@example.com')).toThrow(
        expect.objectContaining({ code: 'PASSWORD_TOO_LONG' }),
      );
    });

    it.each([
      ['short pass', 'PASSWORD_TOO_SHORT'],
      ['password123456', 'PASSWORD_TOO_COMMON'],
      ['RIVET', 'PASSWORD_TOO_COMMON'],
      ['VeryLongUserName', 'PASSWORD_TOO_COMMON'],
      ['valid\npassword phrase', 'PASSWORD_INVALID'],
    ])('rejects an invalid password without including it in the error: %s', (password, code) => {
      let thrown: unknown;

      try {
        validatePassword(password, 'verylongusername@example.com');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toEqual(expect.objectContaining({ code, field: 'password' }));
      expect(thrown).toBeInstanceOf(AuthInputValidationError);
      expect((thrown as Error).message).toBe(code);
      expect((thrown as Error).message).not.toContain(password);
    });

    it.each([
      'a long phrase with password inside',
      'use-rivet-in-a-long-passphrase',
      'verylongusername-with-more-words',
    ])('allows a longer phrase that only contains a blocked word: %s', (password) => {
      expect(validatePassword(password, 'verylongusername@example.com')).toBe(password);
    });
  });

  describe('normalizePasswordForVerification', () => {
    it('normalizes without applying signup strength rules', () => {
      expect(normalizePasswordForVerification('e\u0301')).toBe('é');
    });

    it('rejects more than 128 code points before Argon2 verification', () => {
      expect(() => normalizePasswordForVerification('😀'.repeat(129))).toThrow(
        expect.objectContaining({ code: 'PASSWORD_TOO_LONG' }),
      );
    });
  });
});
