import type { Page } from '@playwright/test';

/**
 * The wait for the analysis sweep of the feedback harness (`feedback-drift.spec.ts`), in a module of its own so
 * that a plain spec can import it (`test/regression/feedback-sweep-wait.spec.ts`).
 *
 * Round 88 (T328, #64): every `page.evaluate` of the harness races a timeout. In round 86 the 573756 test ran out
 * of memory in the renderer: all workers closed, the page's own timer stopped, `page.evaluate` never returned and
 * Playwright raised no `crash` event, so neither the stall check nor the cap below was reached and the run held the
 * machine for the whole 40 minute test timeout. Three timed-out polls in a row now end the wait.
 */

export interface SweepWaitOptions {
  /** Pause between two polls. */
  pollMs?: number;
  /** How long one evaluate may take before it counts as a timeout: three poll intervals. */
  evalTimeoutMs?: number;
}

interface SweepPoll {
  running: boolean;
  done: number;
  total: number;
}

const POLL_MS = 10_000;
const STALL_MS = 360_000;
const CAP_MS = 2_100_000;
/** Timed-out evaluates in a row that declare the page dead. */
const DEAD_AFTER = 3;

/**
 * The reason of a dead page. Fixed text with no figures: the report prints it, and a determinism diff stays clean
 * when two runs lose the page at different moments.
 */
export const RENDERER_DEAD_REASON = 'renderer unresponsive: three evaluate calls in a row timed out';

class EvaluateTimeout extends Error {
  constructor() {
    super(RENDERER_DEAD_REASON);
    this.name = 'EvaluateTimeout';
  }
}

/** `page.evaluate` raced against a timeout; a page error passes through unchanged. */
function raceEvaluate<R>(page: Page, fn: () => R | Promise<R>, timeoutMs: number): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => reject(new EvaluateTimeout()), timeoutMs);
    // A dead page leaves the evaluate pending for good; the late settle of a live one must not become an unhandled rejection.
    page.evaluate(fn).then(
      value => { clearTimeout(timer); resolve(value as R); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * The evaluate of the harness for a single read (the perf counter, the debug extract, the dump): one timeout of
 * three poll intervals; a dead page throws an error with the stable reason, which the test turns into ERROR rows.
 */
export function guardedEvaluate<R>(page: Page, fn: () => R | Promise<R>, options: SweepWaitOptions = {}): Promise<R> {
  const pollMs = options.pollMs ?? POLL_MS;
  return raceEvaluate(page, fn, options.evalTimeoutMs ?? pollMs * DEAD_AFTER);
}

/** True for the error `guardedEvaluate` throws when the page stops answering. */
export function isRendererDead(error: unknown): boolean {
  return error instanceof EvaluateTimeout;
}

/**
 * Waits for the sweep to TERMINATE (running false), with a stall detector:
 * the 653785 baseline wedged mid-sweep at "10/26" and burned the full
 * 35-minute wait — running stayed true with frozen progress (the registered
 * return102 family taking down the whole sweep, not just branching). Six
 * minutes without a progress tick is declared a wedge; the slowest healthy
 * per-turn step in the baseline was far under one minute. The stable reason
 * string (no elapsed seconds) feeds the report so determinism diffs stay
 * clean. A page whose evaluate times out three polls in a row is dead
 * (round 88, T328): the same stable reason rule holds.
 */
export async function waitForSweepEnd(
  page: Page,
  options: SweepWaitOptions = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pollMs = options.pollMs ?? POLL_MS;
  const evalTimeoutMs = options.evalTimeoutMs ?? pollMs * DEAD_AFTER;
  const startedAt = Date.now();
  let sawRunning = false;
  let lastDone = -2;
  let lastProgressAt = Date.now();
  let timeouts = 0;
  for (;;) {
    let state: SweepPoll | null = null;
    try {
      state = await raceEvaluate(page, (): SweepPoll | null => {
        const dbg = (window as unknown as {
          __psDebug?: { graph: { running: boolean; progress: { done: number; total: number } | null } };
        }).__psDebug;
        if (!dbg) return null;
        return {
          running: dbg.graph.running,
          done: dbg.graph.progress?.done ?? -1,
          total: dbg.graph.progress?.total ?? -1,
        };
      }, evalTimeoutMs);
      timeouts = 0;
    } catch (error) {
      if (!(error instanceof EvaluateTimeout)) throw error;
      timeouts += 1;
      if (timeouts >= DEAD_AFTER) return { ok: false, reason: RENDERER_DEAD_REASON };
    }
    const elapsed = Date.now() - startedAt;
    if (state) {
      if (state.running) sawRunning = true;
      if (state.done !== lastDone) {
        lastDone = state.done;
        lastProgressAt = Date.now();
      }
      if (!state.running && (sawRunning || elapsed > 30_000)) return { ok: true };
      if (state.running && Date.now() - lastProgressAt > STALL_MS) {
        return {
          ok: false,
          reason: `sweep wedged at ${state.done}/${state.total} — no progress for ${Math.round(STALL_MS / 1000)}s`,
        };
      }
    }
    if (elapsed > CAP_MS) return { ok: false, reason: `sweep did not finish within ${Math.round(CAP_MS / 1000)}s` };
    // The pause is the harness's own timer, not `page.waitForTimeout`: a dead page may never answer that call either.
    await new Promise<void>(resolve => setTimeout(resolve, pollMs));
  }
}
