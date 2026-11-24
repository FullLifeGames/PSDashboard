// Sim-free on purpose: the app's main thread imports configureSimFast from the barrel and never loads @pkmn/sim.
// Under Node EVAL_SIM_FAST decides ('0' off, '1' all, or a list; a set variable forces, so a break throws).

/** One lever of the speed layer: rule tables, battle copy or the dispatch pre-check. */
export type SimFastLever = 'rules' | 'clone' | 'dispatch';
/** The layer's state: active, off, or stepped back after a hash mismatch or a fallback. */
export type SimFastStatus = 'active' | 'off' | 'hash-mismatch' | 'fallback';

/** What the levers did between two reports. */
export interface SimFastCounters {
  ruleTables: number;
  clones: number;
  dispatchCalls: number;
  /** Of those, answered without the original. */
  dispatchAnswered: number;
  fallbacks: number;
}

/** The status with the counters, as a worker reports them. */
export interface SimFastReport {
  status: SimFastStatus;
  counters: SimFastCounters;
}

/** Every lever, in the order the switch lists them. */
export const SIM_FAST_LEVERS: readonly SimFastLever[] = ['rules', 'clone', 'dispatch'];

/** Levers a host gets without asking; `EVAL_SIM_FAST=0` (or '0' in localStorage) turns them off. */
export const SIM_FAST_DEFAULT: readonly SimFastLever[] = ['rules', 'clone', 'dispatch'];

/** Effective flags: configured and not broken. */
export const simFastFlags: Record<SimFastLever, boolean> = { rules: false, clone: false, dispatch: false };

export const simFastCounters: SimFastCounters = {
  ruleTables: 0, clones: 0, dispatchCalls: 0, dispatchAnswered: 0, fallbacks: 0,
};

interface ProcessLike { env?: Record<string, string | undefined>; versions?: { node?: string } }
const nodeProcess = (): ProcessLike | undefined => (globalThis as { process?: ProcessLike }).process;

export const onNode = (): boolean => typeof nodeProcess()?.versions?.node === 'string';

let configured = false;
let levers: readonly SimFastLever[] = [];
let forced = false;
let broken: 'hash-mismatch' | 'fallback' | null = null;
let changeHook: (() => void) | null = null;

/** Parses EVAL_SIM_FAST: null when unset, [] for '0', every lever for '1', else the named list; unknown ones throw. */
export function parseSimFastSwitch(raw: string | null | undefined): SimFastLever[] | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (value === '0') return [];
  if (value === '1') return [...SIM_FAST_LEVERS];
  const picked = value.split(',').map(part => part.trim());
  for (const part of picked) {
    if (!(SIM_FAST_LEVERS as readonly string[]).includes(part)) {
      throw new Error(`EVAL_SIM_FAST: unknown lever "${part}" (use 0, 1 or a list of rules, clone, dispatch)`);
    }
  }
  return SIM_FAST_LEVERS.filter(lever => picked.includes(lever));
}

function zeroCounters(): void {
  for (const key of Object.keys(simFastCounters) as (keyof SimFastCounters)[]) simFastCounters[key] = 0;
}

function applyFlags(): void {
  for (const lever of SIM_FAST_LEVERS) simFastFlags[lever] = broken === null && levers.includes(lever);
  changeHook?.();
}

/** The host's choice; a break (hash mismatch, fallback) outlives it for the rest of the process. */
export function configureSimFast(next: readonly SimFastLever[], options: { forced?: boolean } = {}): void {
  configured = true;
  levers = SIM_FAST_LEVERS.filter(lever => next.includes(lever));
  forced = options.forced ?? false;
  applyFlags();
}

function configureFromEnvironment(): void {
  if (!onNode()) {
    configureSimFast([]);
    return;
  }
  const parsed = parseSimFastSwitch(nodeProcess()?.env?.EVAL_SIM_FAST);
  configureSimFast(parsed ?? SIM_FAST_DEFAULT, { forced: parsed !== null && parsed.length > 0 });
}

export function simFastOn(lever: SimFastLever): boolean {
  if (!configured) configureFromEnvironment();
  return simFastFlags[lever];
}

export function onSimFastChange(hook: () => void): void {
  changeHook = hook;
}

/** Steps back to the standard path for the rest of the process; forced mode throws instead. */
export function breakSimFast(status: 'hash-mismatch' | 'fallback', reason: string): void {
  if (forced) throw new Error(`sim-fast ${status}: ${reason}`);
  broken ??= status;
  simFastCounters.fallbacks++;
  applyFlags();
}

/** The layer's status: a break outlives the host's choice, else active or off. */
export function simFastStatus(): SimFastStatus {
  if (!configured) configureFromEnvironment();
  if (broken) return broken;
  return levers.length > 0 ? 'active' : 'off';
}

/** Status plus the counters, which it resets; a worker sends one with every final answer. */
export function takeSimFastReport(): SimFastReport {
  const report: SimFastReport = { status: simFastStatus(), counters: { ...simFastCounters } };
  zeroCounters();
  return report;
}

export function resetSimFastForTests(): void {
  configured = false;
  levers = [];
  forced = false;
  broken = null;
  zeroCounters();
  applyFlags();
}
