import type { PokemonSet } from '@pkmn/sim';
import type {
  DamageObservation, OpponentTeamInfo, SmogonSetAssumptions, SmogonUsageStats, SpeedOrderObservation, SpreadCandidate,
  TurnSnapshot,
} from '@fulllifegames/replay-core';
import type { ReplacementPoint, RollSelector, SimFastLever, SimFastReport, TurnAlignmentRecord } from '@fulllifegames/eval-engine';

/** The replay-side jobs the app hands to a worker; every field is plain data (structured clone). */

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
  observations: DamageObservation[];
  /** `guessed` counts the trailing names of each list that are guesses (a short side's world). */
  bringOnly?: { p1: string[]; p2: string[]; guessed?: { p1: number; p2: number } } | null;
  /**
   * 'replay': the protocol's choices up to targetTurn with per-boundary healing, choice locks and position capture.
   * 'lead': a fresh game to turn 1 with `leadOverride` (a turn-0 variation), without corrections, locks or capture.
   */
  mode: 'replay' | 'lead';
  leadOverride?: { p1: string[] | null; p2: string[] | null };
  /** The dice seed of a new game's lead job; absent for every replay (the default seed). */
  seed?: string;
  deadlineMs?: number;
  /** Hand out the open replacement requests of the knockouts too (the sweep asks; other jobs skip the cost). */
  replacements?: boolean;
}

export interface ReconstructOutcome {
  /** The final battle in the engine's stable serialization; null without a battle. */
  serialized: string | null;
  /** The runtime's protocol log (replay prefix plus corrections; the sim's own lines for a lead game). */
  log: string[];
  invalid: string | null;
  /** reconstructionReached: a live battle standing at or past the target turn. */
  reached: boolean;
  ended: boolean;
  turn: number;
  timedOut: boolean;
  haxAlignment: TurnAlignmentRecord[];
  choiceErrors: { count: number; last: string | null };
}

/** The copy of a turn with the biggest roll's die turned over, played where the simulator is loaded. */
export interface RolledCopyJob {
  format: string;
  replayLog: string;
  position: string;
  turn: number;
  roll: RollSelector;
}

/** The copy's next root and where it stands there; `terminal` is the score of a game that ends in it (p1's view). */
export interface RolledCopyOutcome {
  serialized: string;
  stage: 'turn' | 'request' | 'ended';
  terminal: number | null;
}

export type ReplayJobRequest = (
  | { type: 'solveSpreads'; id: number; job: SolveSpreadsJob }
  | { type: 'reconstruct'; id: number; job: ReconstructJob }
  | { type: 'rolledCopy'; id: number; job: RolledCopyJob }
) & { simFast?: readonly SimFastLever[] };
export type ReplayJobResponse = (
  | { type: 'replayProgress'; id: number; turn: number; target: number }
  | { type: 'replayPosition'; id: number; turn: number; serialized: string }
  | { type: 'replayReplacement'; id: number; point: ReplacementPoint; serialized: string }
  | { type: 'reconstructResult'; id: number; outcome: ReconstructOutcome }
  | { type: 'solveSpreadsResult'; id: number; entries: [string, SpreadCandidate][] }
  | { type: 'rolledCopyResult'; id: number; outcome: RolledCopyOutcome | null }
  | { type: 'replayError'; id: number; message: string }
) & { simFast?: SimFastReport };

export const isReplayJob = (message: { type: string }): message is ReplayJobRequest =>
  message.type === 'solveSpreads' || message.type === 'reconstruct' || message.type === 'rolledCopy';
