import {
  configureSimFast, parseSimFastSwitch, perfCount, SIM_FAST_DEFAULT, type SimFastLever, type SimFastReport,
} from '@fulllifegames/eval-engine';

/** The speed layer's override: '0' off, '1' all levers, or a list of rules, clone, dispatch; missing: the default. */
// Workers have no localStorage: the main thread stamps the override on every worker message.
export const SIM_FAST_STORAGE_KEY = 'ps-replay-interceptor:sim-fast';

export function readSimFastLevers(): readonly SimFastLever[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SIM_FAST_STORAGE_KEY) : null;
    return parseSimFastSwitch(raw) ?? SIM_FAST_DEFAULT;
  } catch {
    return SIM_FAST_DEFAULT;
  }
}

/** The levers for this page; configures the main thread's engine on the way. */
export function simFastLevers(): readonly SimFastLever[] {
  const levers = readSimFastLevers();
  configureSimFast(levers);
  return levers;
}

export function adoptSimFastStamp(message: { simFast?: readonly SimFastLever[] }): void {
  if (message.simFast) configureSimFast(message.simFast);
}

export function recordSimFastReport(report: SimFastReport): void {
  perfCount(`simFast:status:${report.status}`);
  for (const [name, value] of Object.entries(report.counters)) {
    if (value > 0) perfCount(`simFast:${name}`, value);
  }
}
