/**
 * Round 59 (T91): the speed layer's switch, status and counters.
 *
 * Sim-free on purpose: the app's main thread imports configureSimFast from
 * the barrel, and the main chunk never loads @pkmn/sim (types.ts:48). Under
 * Node the variable EVAL_SIM_FAST decides ('0' off, '1' all, or a list of
 * rules, clone, dispatch; a set variable forces, so a break throws); in a
 * browser the layer stays off until the host configures it.
 */

export type SimFastLever = 'rules' | 'clone' | 'dispatch';
export type SimFastStatus = 'active' | 'off' | 'hash-mismatch' | 'fallback';

export interface SimFastCounters {
  /** Battles built on a rule table the layer keeps (lever rules). */
  ruleTables: number;
  /** Battles copied instead of deserialized (lever clone). */
  clones: number;
  /** runEvent calls through the pre-check (lever dispatch). */
  dispatchCalls: number;
  /** Of those, answered without the original. */
  dispatchAnswered: number;
  /** Breaks: the layer stepped back to the standard path. */
  fallbacks: number;
}

export interface SimFastReport {
  status: SimFastStatus;
  counters: SimFastCounters;
}

export const SIM_FAST_LEVERS: readonly SimFastLever[] = ['rules', 'clone', 'dispatch'];

/**
 * Levers a host gets without asking (Node without the variable, the app without an override).
 * Round 59: adopted at the gate on 2026-09-26; EVAL_SIM_FAST=0 (Node) and '0' in localStorage are the kill switch.
 */
export const SIM_FAST_DEFAULT: readonly SimFastLever[] = ['rules', 'clone', 'dispatch'];

/** Effective flags (configured and not broken); the hot paths read them directly. */
export const simFastFlags: Record<SimFastLever, boolean> = { rules: false, clone: false, dispatch: false };

export const simFastCounters: SimFastCounters = {
  ruleTables: 0, clones: 0, dispatchCalls: 0, dispatchAnswered: 0, fallbacks: 0,
};

interface ProcessLike { env?: Record<string, string | undefined>; versions?: { node?: string } }
const nodeProcess = (): ProcessLike | undefined => (globalThis as { process?: ProcessLike }).process;

/** Unminified sources under Node: the hash gate can read them. */
export const onNode = (): boolean => typeof nodeProcess()?.versions?.node === 'string';

let configured = false;
let levers: readonly SimFastLever[] = [];
let forced = false;
let broken: 'hash-mismatch' | 'fallback' | null = null;
let changeHook: (() => void) | null = null;

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

/** The host's choice. A break (hash mismatch, fallback) outlives it for the rest of the process. */
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

/** rule-table.ts resets its tables when the lever goes off. */
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

export function simFastStatus(): SimFastStatus {
  if (!configured) configureFromEnvironment();
  if (broken) return broken;
  return levers.length > 0 ? 'active' : 'off';
}

/** Status plus the counters since the last report; a worker sends one with every final answer. */
export function takeSimFastReport(): SimFastReport {
  const report: SimFastReport = { status: simFastStatus(), counters: { ...simFastCounters } };
  zeroCounters();
  return report;
}

/** Test hook: forget configuration, break and counters; the environment decides again. */
export function resetSimFastForTests(): void {
  configured = false;
  levers = [];
  forced = false;
  broken = null;
  zeroCounters();
  applyFlags();
}
