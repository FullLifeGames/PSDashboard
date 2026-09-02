import {
  matchPlayedSide, phantomStayIn, type TurnSensitivity, type TurnVerification, type SensitivityTarget,
  type LeadEvalData, type PlayedTurn, type EvalPreferences, type EvalResult, type EvalSettings,
  type RankedChoice, type TeraAllowance,
} from '@fulllifegames/eval-engine';
import type { EvalWorkerClient } from '../../lib/eval/worker-client';
import type { EngineMode, TurnEvalSettings } from './prefs';
import type { CachedEval } from './single-eval';

/** Played-pair matching with the KO'd-before-acting stand-in: a side that
 * never got to act still prices its pair through the charitable
 * outcome-equivalent phantom (analysis.ts) — T14/T36 stop reading
 * "unclear". */
export const matchOrPhantom = (result: EvalResult, side: 'p1' | 'p2', played: PlayedTurn | null): RankedChoice | null =>
  matchPlayedSide(result, side, played) ?? phantomStayIn(result, side, played);

/**
 * Eval-layer lifecycle guard: a failure is only a gap while the turn is
 * scoreless — the monotone sweep never lets a failing later pass talk over
 * an earlier score (the settings badges already say how converged a scored
 * turn is).
 */
export function recordEvalError(
  evalErrors: (string | null)[], scores: (number | null)[], turn: number, error: unknown,
): void {
  if (scores[turn - 1] !== null) return;
  evalErrors[turn - 1] = error instanceof Error ? error.message : String(error);
}

/** Sweep-level settings: like EvalSettings, but the mode may still be the unresolved 'auto'. */
export type SweepSettings = Omit<EvalSettings, 'mode'> & { mode?: EvalPreferences['mode'] };

export interface GraphSweepParams {
  /** Number of turns in the game (sizes the graph; sweep may cover less). */
  turns: number;
  /** Optional sub-range to sweep (on-demand analysis); defaults to 1..turns. */
  from?: number;
  to?: number;
  /** Resolved Tera allowance. */
  tera: TeraAllowance;
  /** Sleep Clause enforced for this replay (resolved from the branch format). */
  sleepClause?: boolean;
  cacheKeyFor(turn: number): string;
  acquireFor(turn: number): (report: (turn: number, target: number) => void) => Promise<string>;
  /**
   * Optional single-pass acquisition of ALL positions (index = turn − 1).
   * Preferred over acquireFor when present — one reconstruction instead of
   * one per turn. Only invoked once, on the first cache miss. `onPosition`
   * streams each position as it is captured so searches start immediately
   * instead of waiting for the full replay pass.
   */
  acquireAll?(
    report: (turn: number, target: number) => void,
    onPosition?: (turn: number, serialized: string) => void,
    onDiagnostic?: (message: string) => void,
  ): Promise<(string | null)[]>;
  /** What was actually played on this turn (parsed from the replay log). */
  playedFor(turn: number): PlayedTurn | null;
  /**
   * Turn 0: the serialized team-preview position, or null for formats
   * without preview. Present only on full-game sweeps.
   */
  acquirePreview?(): Promise<string | null>;
  /** The leads each side actually sent (species, slot order). */
  playedLeads?: { p1: string[] | null; p2: string[] | null };
  /**
   * Guessed-item mons per side with their usage-plausible alternative items
   * (rule-outs applied) — the sensitivity probes' search space. Absent =
   * probing disabled.
   */
  sensitivityTargetsFor?(side: 'p1' | 'p2'): SensitivityTarget[];
  /**
   * Engine-settings override for this sweep (the explicit think-deeper
   * escalation). The whole sweep runs at these settings instead of the
   * panel preferences — meant for short ranges.
   */
  settings?: TurnEvalSettings;
}

/** The sweep's working arrays plus the lead/notice slots — mutated in place, painted via snapshots. */
export interface SweepData {
  scores: (number | null)[];
  results: (EvalResult | null)[];
  turnSettings: (TurnEvalSettings | null)[];
  faintedFractions: (number | null)[];
  played: (PlayedTurn | null)[];
  playedOutcome: (number | null)[];
  verified: (TurnVerification | null)[];
  sensitivity: (TurnSensitivity | null)[];
  evalErrors: (string | null)[];
  lead: LeadEvalData | null;
  notice: string | null;
}

/** Everything one sweep run threads through its stages. */
export interface SweepEnv {
  params: GraphSweepParams;
  runId: number;
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  /** Cross-mode merge arbiter: the mode the USER configured, even when this
   *  sweep runs an escalation override. */
  configuredMode: EvalPreferences['mode'];
  data: SweepData;
  paint(progress: { done: number; total: number } | null, force?: boolean): void;
  positionFor(turn: number): Promise<string>;
}

/** A concrete per-turn engine after 'auto' resolution. */
export interface TurnEngine {
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
}

/** What every per-turn stage needs about the turn it works on. */
export interface TurnStageArgs {
  hit: CachedEval;
  key: string;
  storeKey: string;
  turn: number;
  turnPlayed: PlayedTurn | null;
  engine: TurnEngine;
  resolvedSettings: EvalSettings;
}

export const aborted = (env: SweepEnv) => env.runRef.current !== env.runId;
export const isCancelled = (err: unknown) => err instanceof Error && err.message === 'cancelled';

/**
 * One awaited sweep stage under the run's cancellation contract: a run
 * that changed hands or a cancelled worker call ends the turn with
 * 'abort'; any other failure keeps the stage's null result, so the turn
 * stays silent in that channel. The run is checked again after the
 * await, because it can change hands while the stage is in flight.
 */
export async function guardedStage<T>(env: SweepEnv, run: () => Promise<T>): Promise<T | null | 'abort'> {
  let value: T | null = null;
  try {
    value = await run();
  } catch (err) {
    if (aborted(env)) return 'abort';
    if (isCancelled(err)) return 'abort';
  }
  if (aborted(env)) return 'abort';
  return value;
}
