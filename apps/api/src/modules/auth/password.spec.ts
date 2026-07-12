import { argon2id, hash as argon2Hash } from 'argon2';

import { hashPassword, passwordHashNeedsRehash, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses the required Argon2id parameters and verifies the whole password', async () => {
    const passwordHash = await hashPassword('  a secure passphrase  ');

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyPassword(passwordHash, '  a secure passphrase  ')).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, 'a secure passphrase')).resolves.toBe(false);
  });

  it('normalizes passwords to NFC for hashing and verification', async () => {
    const passwordHash = await hashPassword(`secur${'e\u0301'.repeat(6)} phrase`);

    await expect(verifyPassword(passwordHash, `secur${'é'.repeat(6)} phrase`)).resolves.toBe(true);
  });

  it('detects outdated hashes without downgrading stronger cost parameters', async () => {
    const currentHash = await hashPassword('a secure passphrase');
    const weakHash = await argon2Hash('a secure passphrase', {
      memoryCost: 12 * 1_024,
      parallelism: 1,
      timeCost: 2,
      type: argon2id,
    });
    const strongerHash = await argon2Hash('a secure passphrase', {
      memoryCost: 20 * 1_024,
      parallelism: 1,
      timeCost: 3,
      type: argon2id,
    });
    const wrongAlgorithmHash = currentHash.replace('$argon2id$', '$argon2i$');

    expect(passwordHashNeedsRehash(currentHash)).toBe(false);
    expect(passwordHashNeedsRehash(weakHash)).toBe(true);
    expect(passwordHashNeedsRehash(strongerHash)).toBe(false);
    expect(passwordHashNeedsRehash(wrongAlgorithmHash)).toBe(true);
  });
});
