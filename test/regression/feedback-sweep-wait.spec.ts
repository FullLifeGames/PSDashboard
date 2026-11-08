import { describe, expect, test } from 'vitest';
import type { Page } from '@playwright/test';
import { guardedEvaluate, waitForSweepEnd } from '../e2e-feedback/sweep-wait';

/**
 * Round 88 (T328, #64): the feedback harness stops on a dead renderer within minutes. Round 86's 573756 test ran
 * out of memory in the renderer: every worker closed, the page's timer stopped, `page.evaluate` never returned and
 * Playwright raised no `crash` event, so the run held the machine for the whole 40 minute test timeout.
 * A fake page stands for each state; the poll times are scaled down to milliseconds. The harness is the same for
 * singles, doubles and VGC (it reads the debug handle after the sweep and knows no game type).
 */

const FAST = { pollMs: 5, evalTimeoutMs: 15 };

interface Poll {
  running: boolean;
  done: number;
  total: number;
}

/** A page whose evaluate never settles: the dead renderer. */
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

/** A page that answers each evaluate with the next poll state; the last state repeats. */
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
    // Three timeouts of 15 ms and two polls of 5 ms, far under a second even on a loaded machine.
    expect(Date.now() - started).toBeLessThan(2_000);
    // The report keeps determinism diffs clean: the reason names no elapsed seconds and no timings.
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
