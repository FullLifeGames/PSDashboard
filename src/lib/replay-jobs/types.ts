import type { PokemonSet } from '@pkmn/sim';
import type {
  DamageObservation, OpponentTeamInfo, SmogonSetAssumptions, SmogonUsageStats, SpeedOrderObservation, SpreadCandidate,
  TurnSnapshot,
} from '@fulllifegames/replay-core';
import type { TurnAlignmentRecord } from '@fulllifegames/eval-engine';

/**
 * The replay-side jobs the app hands to a worker (round 38): the spread
 * solve and the replay reconstruction, the two synchronous multi-second
 * computations that used to freeze the page. Every field is plain data —
 * the messages cross the worker boundary by structured clone.
 */

export interface SolveSpreadsJob {
  log: string;
  observations: DamageObservation[];
  speedOrders: SpeedOrderObservation[];
  userTeamText?: string;
  p1Info: OpponentTeamInfo | null;
  p2Info: OpponentTeamInfo | null;
  usageStats: SmogonUsageStats | null;
  setAssumptions: SmogonSetAssumptions | null;
}

export interface ReconstructJob {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  /** Per-turn snapshots (snapshots[turn - 1]); the target and every captured boundary correct from them. */
  snapshots: TurnSnapshot[];
  playerNames?: [string, string];
  /** Damage record for the choice-lock context. */
  observations: DamageObservation[];
  bringOnly?: { p1: string[]; p2: string[] } | null;
  /**
   * 'replay': the protocol's choices up to targetTurn with per-boundary
   * healing, choice locks, and position capture (Evaluate, the sweep, a
   * branch at turn N). 'lead': a fresh game to turn 1 with `leadOverride`
   * (a turn-0 variation) — no snapshot corrections, no locks, no capture.
   */
  mode: 'replay' | 'lead';
  leadOverride?: { p1: string[] | null; p2: string[] | null };
  deadlineMs?: number;
}

export interface ReconstructOutcome {
  /** The final battle in the engine's stable serialization; null without a battle. */
  serialized: string | null;
  /** The runtime's protocol log (replay prefix plus active corrections; the sim's own lines for a lead game). */
  log: string[];
  /** validateBranchRuntime's verdict. */
  invalid: string | null;
  /** reconstructionReached: a live battle standing at or past the target turn. */
  reached: boolean;
  ended: boolean;
  turn: number;
  timedOut: boolean;
  haxAlignment: TurnAlignmentRecord[];
  choiceErrors: { count: number; last: string | null };
}

export type ReplayJobRequest =
  | { type: 'solveSpreads'; id: number; job: SolveSpreadsJob }
  | { type: 'reconstruct'; id: number; job: ReconstructJob };

export type ReplayJobResponse =
  | { type: 'replayProgress'; id: number; turn: number; target: number }
  | { type: 'replayPosition'; id: number; turn: number; serialized: string }
  | { type: 'reconstructResult'; id: number; outcome: ReconstructOutcome }
  | { type: 'solveSpreadsResult'; id: number; entries: [string, SpreadCandidate][] }
  | { type: 'replayError'; id: number; message: string };

export const isReplayJob = (message: { type: string }): message is ReplayJobRequest =>
  message.type === 'solveSpreads' || message.type === 'reconstruct';
