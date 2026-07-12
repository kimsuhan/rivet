const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000];

export function calculateRetryDelayMs(attemptCount: number, random = Math.random): number | null {
  if (attemptCount >= 7) {
    return null;
  }

  const delay = RETRY_DELAYS_MS[attemptCount - 1];

  if (delay === undefined) {
    throw new RangeError('attemptCount는 1 이상이어야 합니다.');
  }

  return Math.round(delay * (0.8 + random() * 0.4));
}
