// Wall-clock stage collector for the graph sweep (main thread only): it always collects and reports only when localStorage
// 'ps-replay-interceptor:perf' is '1'.

const FLAG_KEY = 'ps-replay-interceptor:perf';

interface PerfStage {
  ms: number;
  count: number;
}

export interface PerfSummary {
  label: string;
  totalMs: number;
  /** Stages may overlap in wall time (acquisition streams positions while searches run), so their sum can exceed totalMs; the total is the truth. */
  stages: Record<string, PerfStage>;
  counters: Record<string, number>;
}

const stages = new Map<string, PerfStage>();
const counters = new Map<string, number>();
let startedAt: number | null = null;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function perfEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** Starts a fresh collection window (one graph sweep). */
export function perfReset(): void {
  stages.clear();
  counters.clear();
  startedAt = now();
}

/** Adds one timed run of a stage, in milliseconds. */
export function perfAdd(stage: string, ms: number): void {
  const entry = stages.get(stage);
  if (entry) {
    entry.ms += ms;
    entry.count += 1;
  } else {
    stages.set(stage, { ms, count: 1 });
  }
}

/** Adds to a named counter. */
export function perfCount(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/** Times one awaited stage; the failure path is charged like the success path. */
export async function perfSpan<T>(stage: string, run: () => Promise<T>): Promise<T> {
  const start = now();
  try {
    return await run();
  } finally {
    perfAdd(stage, now() - start);
  }
}

/** Times one synchronous block, for main-thread compute sites where the span is blocked main-thread time (async spans measure waiting). */
export function perfSync<T>(stage: string, run: () => T): T {
  const start = now();
  try {
    return run();
  } finally {
    perfAdd(stage, now() - start);
  }
}

export function perfSummary(label: string): PerfSummary {
  return {
    label,
    totalMs: startedAt === null ? 0 : now() - startedAt,
    stages: Object.fromEntries([...stages.entries()].sort((a, b) => b[1].ms - a[1].ms)),
    counters: Object.fromEntries(counters),
  };
}

/** Prints the collected stages to the console and mirrors them on window.__EVAL_PERF__; flag-gated. */
export function perfReport(label: string): void {
  if (!perfEnabled()) return;
  const summary = perfSummary(label);
  const lines = Object.entries(summary.stages)
    .map(([stage, { ms, count }]) => `  ${stage}: ${(ms / 1000).toFixed(1)}s (${count}x)`)
    .join('\n');
  const counts = Object.entries(summary.counters)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n');
  console.info(
    `[eval-perf] ${label}: ${(summary.totalMs / 1000).toFixed(1)}s total\n${lines}${counts ? `\ncounters:\n${counts}` : ''}`,
  );
  (globalThis as { __EVAL_PERF__?: PerfSummary }).__EVAL_PERF__ = summary;
}
