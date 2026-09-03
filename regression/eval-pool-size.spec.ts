import { test, expect } from '@playwright/test';
import { POOL_MAX, computePoolSize, evalPoolSize, lanesForPool } from '../src/lib/eval/pool-size';

test.describe('eval worker pool sizing', () => {
  test('never below the old rule, scales to the physical-core estimate, capped at 12', () => {
    expect(computePoolSize(8, 8, undefined)).toBe(6);    // 4C/8T laptop: unchanged
    expect(computePoolSize(16, 8, undefined)).toBe(8);   // 8C/16T
    expect(computePoolSize(24, 8, undefined)).toBe(12);  // 12C/24T (measured 1.4 to 1.5x)
    expect(computePoolSize(32, 8, undefined)).toBe(12);  // cap
    expect(computePoolSize(4, 8, undefined)).toBe(2);
    expect(computePoolSize(1, 8, undefined)).toBe(1);
  });

  test('memory brake: about 0.6 GB per worker, deviceMemory unknown means no brake', () => {
    expect(computePoolSize(24, 4, undefined)).toBe(6);
    expect(computePoolSize(24, 2, undefined)).toBe(3);
    expect(computePoolSize(24, 0.5, undefined)).toBe(1);
    expect(computePoolSize(24, undefined, undefined)).toBe(12);
    expect(computePoolSize(24, NaN, undefined)).toBe(12);
  });

  test('explicit cap wins downward only', () => {
    expect(computePoolSize(24, 8, 2)).toBe(2);
    expect(computePoolSize(24, 8, 40)).toBe(12);
    expect(computePoolSize(24, 8, 0)).toBe(12);
    expect(computePoolSize(24, 8, NaN)).toBe(12);
  });

  test('lanes follow the pool: half, at least three', () => {
    expect(lanesForPool(6)).toBe(3);
    expect(lanesForPool(8)).toBe(4);
    expect(lanesForPool(12)).toBe(6);
    expect(lanesForPool(2)).toBe(3);
  });

  test('the browser reader stays inside the bounds without a browser', () => {
    const size = evalPoolSize();
    expect(size).toBeGreaterThanOrEqual(1);
    expect(size).toBeLessThanOrEqual(POOL_MAX);
  });
});
