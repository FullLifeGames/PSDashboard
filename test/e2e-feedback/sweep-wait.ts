import type { Page } from '@playwright/test';

// A renderer out of memory raises no `crash` event and `page.evaluate` never returns: every evaluate races a timeout.

export interface SweepWaitOptions {
  pollMs?: number;
  evalTimeoutMs?: number;
}

interface SweepPoll {
  running: boolean;
  done: number;
  total: number;
  /** The early-lines stage (`useEarlyLines` writes `__psEarlyLines`); null on a page that mounts none. */
  stage: { active: boolean; done: number; total: number } | null;
}

const POLL_MS = 10_000;
const STALL_MS = 360_000;
const CAP_MS = 2_100_000;
const DEAD_AFTER = 3;

/** The reason of a dead page: text with no figures, so a determinism diff stays clean across runs. */
export const RENDERER_DEAD_REASON = 'renderer unresponsive: three evaluate calls in a row timed out';

class EvaluateTimeout extends Error {
  constructor() {
    super(RENDERER_DEAD_REASON);
    this.name = 'EvaluateTimeout';
  }
}

function raceEvaluate<R>(page: Page, fn: () => R | Promise<R>, timeoutMs: number): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => reject(new EvaluateTimeout()), timeoutMs);
    // A dead page leaves the evaluate pending for good; a live one's late settle must not be an unhandled rejection.
    page.evaluate(fn).then(
      value => { clearTimeout(timer); resolve(value as R); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function guardedEvaluate<R>(page: Page, fn: () => R | Promise<R>, options: SweepWaitOptions = {}): Promise<R> {
  const pollMs = options.pollMs ?? POLL_MS;
  return raceEvaluate(page, fn, options.evalTimeoutMs ?? pollMs * DEAD_AFTER);
}

export function isRendererDead(error: unknown): boolean {
  return error instanceof EvaluateTimeout;
}

// The sweep's end is not the report's end: the early-lines stage keeps writing lines, so the end is the stage's end.
function judgePoll(state: SweepPoll, now: { settled: boolean; stalled: boolean }): { ok: true } | { ok: false; reason: string } | null {
  const stageActive = state.stage?.active === true;
  if (!state.running && !stageActive && now.settled) return { ok: true };
  const stalledFor = `no progress for ${Math.round(STALL_MS / 1000)}s`;
  if (state.running && now.stalled) return { ok: false, reason: `sweep wedged at ${state.done}/${state.total} — ${stalledFor}` };
  if (!state.running && stageActive && now.stalled) {
    return { ok: false, reason: `early lines wedged at ${state.stage?.done}/${state.stage?.total} — ${stalledFor}` };
  }
  return null;
}

// A wedged sweep stays `running` with frozen progress, so the wait watches progress ticks as well.
export async function waitForSweepEnd(
  page: Page,
  options: SweepWaitOptions = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pollMs = options.pollMs ?? POLL_MS;
  const evalTimeoutMs = options.evalTimeoutMs ?? pollMs * DEAD_AFTER;
  const startedAt = Date.now();
  let sawRunning = false;
  let lastDone = '-2';
  let lastProgressAt = Date.now();
  let timeouts = 0;
  for (;;) {
    let state: SweepPoll | null = null;
    try {
      state = await raceEvaluate(page, (): SweepPoll | null => {
        const win = window as unknown as {
          __psDebug?: { graph: { running: boolean; progress: { done: number; total: number } | null } };
          __psEarlyLines?: { active: boolean; done: number; total: number };
        };
        const dbg = win.__psDebug;
        if (!dbg) return null;
        return {
          running: dbg.graph.running,
          done: dbg.graph.progress?.done ?? -1,
          total: dbg.graph.progress?.total ?? -1,
          stage: win.__psEarlyLines ?? null,
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
      const tick = `${state.done}/${state.stage?.done ?? -1}`;
      if (tick !== lastDone) {
        lastDone = tick;
        lastProgressAt = Date.now();
      }
      const verdict = judgePoll(state, { settled: sawRunning || elapsed > 30_000, stalled: Date.now() - lastProgressAt > STALL_MS });
      if (verdict) return verdict;
    }
    if (elapsed > CAP_MS) return { ok: false, reason: `sweep did not finish within ${Math.round(CAP_MS / 1000)}s` };
    // The pause is the harness's own timer, not `page.waitForTimeout`: a dead page may never answer that call either.
    await new Promise<void>(resolve => setTimeout(resolve, pollMs));
  }
}
