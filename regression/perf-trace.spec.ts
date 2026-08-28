import { test, expect } from '@playwright/test';
import { perfAdd, perfCount, perfEnabled, perfReset, perfSpan, perfSummary } from '../src/lib/eval/perf-trace';

test.describe('perf-trace', () => {
  test('aggregates stages and counters and resets clean', async () => {
    perfReset();
    perfAdd('stage', 5);
    perfAdd('stage', 7);
    perfAdd('other', 1);
    perfCount('spawn');
    perfCount('spawn', 2);
    await perfSpan('span', async () => {});
    const summary = perfSummary('label');
    expect(summary.label).toBe('label');
    expect(summary.stages['stage']).toEqual({ ms: 12, count: 2 });
    expect(summary.stages['other'].count).toBe(1);
    expect(summary.stages['span'].count).toBe(1);
    expect(summary.counters['spawn']).toBe(3);
    expect(summary.totalMs).toBeGreaterThanOrEqual(0);
    perfReset();
    expect(perfSummary('label').stages).toEqual({});
    expect(perfSummary('label').counters).toEqual({});
  });

  test('spans return the result, charge the failure path, and rethrow', async () => {
    perfReset();
    expect(await perfSpan('ok', async () => 42)).toBe(42);
    await expect(perfSpan('boom', async () => {
      throw new Error('x');
    })).rejects.toThrow('x');
    expect(perfSummary('l').stages['ok'].count).toBe(1);
    expect(perfSummary('l').stages['boom'].count).toBe(1);
  });

  test('reporting stays off without the opt-in flag (node has no localStorage)', () => {
    expect(perfEnabled()).toBe(false);
  });
});
