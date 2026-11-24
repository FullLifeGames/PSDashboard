/** The worker-pool cap; 18 workers froze the page (about 350 MB each while an MCTS tree is alive). */
export const POOL_MAX = 12;
const POOL_GB_PER_WORKER = 0.6;
const LEGACY_MAX = 6;
const STORAGE_CAP_KEY = 'ps-replay-interceptor:eval-pool';

export function computePoolSize(cores: number, deviceMemoryGb: number | undefined, cap: number | undefined): number {
  const legacy = Math.max(1, Math.min(cores - 2, LEGACY_MAX));
  const physical = Math.max(1, Math.min(Math.round(cores / 2), POOL_MAX));
  let size = Math.max(legacy, physical);
  if (deviceMemoryGb !== undefined && Number.isFinite(deviceMemoryGb)) {
    size = Math.min(size, Math.max(1, Math.floor(deviceMemoryGb / POOL_GB_PER_WORKER)));
  }
  if (cap !== undefined && Number.isFinite(cap) && cap >= 1) size = Math.min(size, cap);
  return size;
}

/** Concurrent sweep turns: half the pool (four MCTS trees per turn), at least three. */
export function lanesForPool(pool: number): number {
  return Math.max(3, Math.ceil(pool / 2));
}

export function evalPoolSize(): number {
  const nav = typeof navigator !== 'undefined'
    ? (navigator as { hardwareConcurrency?: number; deviceMemory?: number })
    : undefined;
  let cap: number | undefined;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_CAP_KEY) : null;
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed)) cap = parsed;
  } catch {
    // Storage unavailable: no cap.
  }
  return computePoolSize(nav?.hardwareConcurrency ?? 4, nav?.deviceMemory, cap);
}
