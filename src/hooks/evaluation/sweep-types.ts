import {
  matchPlayedSide, phantomStayIn, type TurnSensitivity, type TurnVerification, type SensitivityTarget,
  type LeadEvalData, type ReplacementEvalData, type ReplacementPoint, type ReplacementRound, type PlayedTurn, type EvalPreferences, type EvalResult, type EvalSettings,
  type RankedChoice, type RollFlip, type StaticRuleset, type TeraAllowance,
} from '@fulllifegames/eval-engine';
import type { GameRules } from '@fulllifegames/replay-core';
import type { EvalWorkerClient } from '../../lib/eval/worker-client';
import type { StoredEval } from '../../lib/eval-cache-store';
import type { AppEvalSettings } from '../../lib/eval/worker-client';
import type { EngineMode, TurnEvalSettings } from './prefs';
import type { CachedEval } from './single-eval';
import type { RolledCopyParams } from '../../lib/rolled-copy-stage';

/** Played-pair matching with the KO'd-before-acting stand-in (analysis.ts); both sides read `playedBounds`. */
export const matchOrPhantom = (result: EvalResult, side: 'p1' | 'p2', played: PlayedTurn | null, rules: GameRules): RankedChoice | null =>
  matchPlayedSide(result, side, played, result.playedBounds) ?? phantomStayIn(result, side, played, rules, result.playedBounds?.[side]?.[0]);

/** A failure is a gap only while the turn is scoreless; a failing later pass never talks over an earlier score. */
export function recordEvalError(
  evalErrors: (string | null)[], scores: (number | null)[], turn: number, error: unknown,
): void {
  if (scores[turn - 1] !== null) return;
  evalErrors[turn - 1] = error instanceof Error ? error.message : String(error);
}

export type SweepSettings = Omit<EvalSettings, 'mode'> & { mode?: EvalPreferences['mode'] };

export interface GraphSweepParams {
  turns: number;
  from?: number;
  to?: number;
  tera: TeraAllowance;
  sleepClause?: boolean;
  /** For the Dex reads of the sweep (the stay-in phantom's move priorities). */
  rules: GameRules;
  ruleset: StaticRuleset;
  /** The sweep runs over a new game: positions come from its record, not a replay's guessed sets. */
  game?: boolean;
  doubles: boolean;
  cacheKeyFor(turn: number): string;
  acquireFor(turn: number): (report: (turn: number, target: number) => void) => Promise<string>;
  /** Single-pass capture of ALL positions (index = turn - 1), preferred over acquireFor; called on the first miss. */
  acquireAll?(
    report: (turn: number, target: number) => void,
    onPosition?: (turn: number, serialized: string) => void,
    onDiagnostic?: (message: string) => void,
    onReplacement?: (point: ReplacementPoint, serialized: string) => void,
  ): Promise<(string | null)[]>;
  playedFor(turn: number): PlayedTurn | null;
  /** Turn 0: the serialized team-preview position, or null without preview. Full-game sweeps only. */
  acquirePreview?(): Promise<string | null>;
  playedLeads?: { p1: string[] | null; p2: string[] | null };
  /** Guessed-item mons per side with plausible alternative items (rule-outs applied); absent = no probing. */
  sensitivityTargetsFor?(side: 'p1' | 'p2'): SensitivityTarget[];
  /** This replay's store-key prefix (evalStorePrefix): the run reads every persisted eval under it once. */
  storePrefix?: string;
  /** Replacement request rounds (full-game sweeps only), priced at the captured position by `replacementKeyFor`. */
  replacementRounds?: ReplacementRound[];
  replacementKeyFor?(turn: number, ordinal: number): string;
  /** The biggest roll played the other way (full-game sweeps only); absent = no stage, the graph keeps its flip. */
  rolledCopy?: RolledCopyParams;
}

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
  /** The replacement points of the knockout turn t at index t (the card of turn t + 1 reads index (t + 1) - 1). */
  replacements: (ReplacementEvalData[] | null)[];
  /** The engine's score of the next root with the biggest roll's die turned over; null = no named roll or no copy. */
  rollFlip: RollFlip | null;
  notice: string | null;
}

export interface SweepEnv {
  params: GraphSweepParams;
  runId: number;
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  /** The mode the USER configured (the cross-mode merge arbiter), even when this sweep runs an escalation override. */
  configuredMode: EvalPreferences['mode'];
  data: SweepData;
  paint(progress: SweepProgress | null, force?: boolean): void;
  positionFor(turn: number): Promise<string>;
  /** The serialized open request of a replacement round, or null where the capture never reached it. */
  replacementPositionFor?(turn: number, ordinal: number): Promise<string | null>;
  /** The store's evals for this replay, read once at run start (null = read unavailable, single reads instead). */
  prefetched: Map<string, StoredEval> | null;
}

export interface SweepProgress {
  done: number;
  total: number;
  task?: 'key' | 'rest';
}

export interface TurnEngine {
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
  prove?: boolean;
}

export interface TurnStageArgs {
  hit: CachedEval;
  key: string;
  storeKey: string;
  turn: number;
  turnPlayed: PlayedTurn | null;
  engine: TurnEngine;
  resolvedSettings: AppEvalSettings;
}

export const aborted = (env: SweepEnv) => env.runRef.current !== env.runId;
export const isCancelled = (err: unknown) => err instanceof Error && err.message === 'cancelled';

/** One awaited stage under the run's cancellation contract: a changed run or a cancelled call ends it with 'abort'. */
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
