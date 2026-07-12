import { argon2id, hash, verify } from 'argon2';

const ARGON2ID_OPTIONS = {
  memoryCost: 19 * 1_024,
  parallelism: 1,
  timeCost: 2,
  type: argon2id,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password.normalize('NFC'), ARGON2ID_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password.normalize('NFC'));
}

export function passwordHashNeedsRehash(passwordHash: string): boolean {
  const parameters = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);

  if (!parameters) {
    return true;
  }

  const version = Number(parameters[1]);
  const memoryCost = Number(parameters[2]);
  const timeCost = Number(parameters[3]);
  const parallelism = Number(parameters[4]);
  return (
    version !== 19 ||
    memoryCost < ARGON2ID_OPTIONS.memoryCost ||
    timeCost < ARGON2ID_OPTIONS.timeCost ||
    parallelism < ARGON2ID_OPTIONS.parallelism
  );
}
