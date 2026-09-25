import {
  configureSimFast, parseSimFastSwitch, perfCount, SIM_FAST_DEFAULT, type SimFastLever, type SimFastReport,
} from '@fulllifegames/eval-engine';

/**
 * Round 59 (T91): the speed layer's override, without a UI switch: '0' off,
 * '1' all levers, or a list of rules, clone, dispatch; missing means the
 * engine's default. The main thread reads it and stamps it on every worker
 * message (workers have no localStorage); final answers bring each worker's
 * status and counters back into the perf trace.
 */
export const SIM_FAST_STORAGE_KEY = 'ps-replay-interceptor:sim-fast';

export function readSimFastLevers(): readonly SimFastLever[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SIM_FAST_STORAGE_KEY) : null;
    return parseSimFastSwitch(raw) ?? SIM_FAST_DEFAULT;
  } catch {
    // Storage unavailable or an unknown lever: the default.
    return SIM_FAST_DEFAULT;
  }
}

/** The levers for this page; configures the main thread's engine on the way (reconstruction fallback, lazy paths). */
export function simFastLevers(): readonly SimFastLever[] {
  const levers = readSimFastLevers();
  configureSimFast(levers);
  return levers;
}

/** Worker side: a stamped message reconfigures the worker; an unstamped one leaves it alone. */
export function adoptSimFastStamp(message: { simFast?: readonly SimFastLever[] }): void {
  if (message.simFast) configureSimFast(message.simFast);
}

/** Books a worker's report into the main thread's perf trace (window.__EVAL_PERF__ with the perf flag). */
export function recordSimFastReport(report: SimFastReport): void {
  perfCount(`simFast:status:${report.status}`);
  for (const [name, value] of Object.entries(report.counters)) {
    if (value > 0) perfCount(`simFast:${name}`, value);
  }
}
