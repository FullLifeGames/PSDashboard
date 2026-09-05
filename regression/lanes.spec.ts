import { test, expect, describe } from 'vitest';
import { runInLanes } from '../src/lib/eval/lanes';

describe('runInLanes', () => {
  test('runs every job exactly once and returns true', async () => {
    const seen: number[] = [];
    const ok = await runInLanes(3, 7, async index => {
      seen.push(index);
      return true;
    });
    expect(ok).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('caps concurrency at laneCount', async () => {
    let active = 0;
    let peak = 0;
    const ok = await runInLanes(2, 10, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return true;
    });
    expect(ok).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('a false job stops further pickups and resolves false', async () => {
    const started: number[] = [];
    const ok = await runInLanes(2, 100, async index => {
      started.push(index);
      await new Promise(resolve => setTimeout(resolve, 1));
      return index !== 3;
    });
    expect(ok).toBe(false);
    // In-flight lanes settle, but nothing far beyond the failure starts.
    expect(started.length).toBeLessThan(10);
  });

  test('zero jobs resolve true without running anything', async () => {
    let ran = 0;
    const ok = await runInLanes(4, 0, async () => {
      ran += 1;
      return true;
    });
    expect(ok).toBe(true);
    expect(ran).toBe(0);
  });
});
