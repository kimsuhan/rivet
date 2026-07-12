import { calculateRetryDelayMs } from './outbox-retry';

describe('calculateRetryDelayMs', () => {
  it('uses the fixed retry schedule before jitter', () => {
    expect(calculateRetryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(calculateRetryDelayMs(6, () => 0.5)).toBe(21_600_000);
  });

  it('stops scheduling after the seventh attempt', () => {
    expect(calculateRetryDelayMs(7, () => 0.5)).toBeNull();
  });
});
