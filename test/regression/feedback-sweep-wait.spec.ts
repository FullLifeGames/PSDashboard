import { describe, expect, test } from 'vitest';
import type { Page } from '@playwright/test';
import { guardedEvaluate, waitForSweepEnd } from '../e2e-feedback/sweep-wait';


// An out-of-memory renderer stops the page's timer: `page.evaluate` never returns and no `crash` event comes.
const FAST = { pollMs: 5, evalTimeoutMs: 15 };

interface Poll {
  running: boolean;
  done: number;
  total: number;
  stage?: { active: boolean; done: number; total: number } | null;
}

function deadPage(): { page: Page; calls: () => number } {
  let calls = 0;
  const page = {
    evaluate: () => {
      calls += 1;
      return new Promise<never>(() => {});
    },
    waitForTimeout: () => new Promise<never>(() => {}),
  } as unknown as Page;
  return { page, calls: () => calls };
}

function scriptedPage(states: (Poll | null | 'hang')[]): { page: Page; calls: () => number } {
  let calls = 0;
  const page = {
    evaluate: () => {
      const state = states[Math.min(calls, states.length - 1)];
      calls += 1;
      return state === 'hang' ? new Promise<never>(() => {}) : Promise.resolve(state);
    },
  } as unknown as Page;
  return { page, calls: () => calls };
}

describe('waitForSweepEnd on a dead renderer', () => {
  test('a page whose evaluate never settles fails after three timeouts with a stable reason', async () => {
    const { page, calls } = deadPage();
    const started = Date.now();
    const result = await waitForSweepEnd(page, FAST);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(calls()).toBe(3);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.reason).not.toMatch(/\d/);
    expect(result.reason).toMatch(/renderer/i);
  });

  test('the reason is the same text whatever the timings are', async () => {
    const first = await waitForSweepEnd(deadPage().page, FAST);
    const second = await waitForSweepEnd(deadPage().page, { pollMs: 2, evalTimeoutMs: 8 });
    expect(first).toEqual(second);
  });

  test('a timeout between answers does not count against a healthy page (three in a row only)', async () => {
    const running: Poll = { running: true, done: 1, total: 4 };
    const finished: Poll = { running: false, done: 4, total: 4 };
    const { page } = scriptedPage(['hang', 'hang', running, 'hang', 'hang', running, finished]);
    expect(await waitForSweepEnd(page, FAST)).toEqual({ ok: true });
  });

  test('a healthy sweep that ends returns ok', async () => {
    const { page } = scriptedPage([
      { running: true, done: 0, total: 3 },
      { running: true, done: 2, total: 3 },
      { running: false, done: 3, total: 3 },
    ]);
    expect(await waitForSweepEnd(page, FAST)).toEqual({ ok: true });
  });
});

describe('waitForSweepEnd and the early-lines stage', () => {
  const stage = (active: boolean, done: number) => ({ active, done, total: 3 });

  test('the sweep ending is not the end: the dump waits for the stage, so two runs dump the same lines', async () => {
    const { page, calls } = scriptedPage([
      { running: true, done: 2, total: 3 },
      { running: false, done: 3, total: 3, stage: stage(true, 0) },
      { running: false, done: 3, total: 3, stage: stage(true, 1) },
      { running: false, done: 3, total: 3, stage: stage(true, 2) },
      { running: false, done: 3, total: 3, stage: stage(false, 3) },
    ]);
    expect(await waitForSweepEnd(page, FAST)).toEqual({ ok: true });
    expect(calls()).toBe(5);
  });

  test('a page without the stage (doubles, an explicit mode, an old build) ends with the sweep', async () => {
    const { page, calls } = scriptedPage([
      { running: true, done: 0, total: 3 },
      { running: false, done: 3, total: 3, stage: stage(false, 0) },
    ]);
    expect(await waitForSweepEnd(page, FAST)).toEqual({ ok: true });
    expect(calls()).toBe(2);
  });

  test('a stage that stops ticking is a wedge with a stable reason, as a wedged sweep is', async () => {
    let now = 0;
    const real = Date.now;
    Date.now = () => (now += 120_000);
    try {
      const { page } = scriptedPage([
        { running: false, done: 3, total: 3, stage: stage(true, 1) },
        { running: false, done: 3, total: 3, stage: stage(true, 1) },
      ]);
      const result = await waitForSweepEnd(page, FAST);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/early lines|stage/i);
    } finally {
      Date.now = real;
    }
  });
});

describe('guardedEvaluate, the race of the other three evaluates of the harness', () => {
  test('hands a settled answer through', async () => {
    const page = { evaluate: () => Promise.resolve(42) } as unknown as Page;
    expect(await guardedEvaluate(page, () => 42, FAST)).toBe(42);
  });

  test('throws a stable error on a page that never answers', async () => {
    const { page } = deadPage();
    const started = Date.now();
    await expect(guardedEvaluate(page, () => 42, FAST)).rejects.toThrow(/renderer/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('passes a page error through unchanged', async () => {
    const page = { evaluate: () => Promise.reject(new Error('Execution context was destroyed')) } as unknown as Page;
    await expect(guardedEvaluate(page, () => 42, FAST)).rejects.toThrow('Execution context was destroyed');
  });
});
