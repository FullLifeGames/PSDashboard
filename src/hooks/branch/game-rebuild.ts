import type { BranchRuntime, ReconstructParams } from '@fulllifegames/eval-engine';
import { getBranchSimulatorFormat, type TurnSnapshot } from '@fulllifegames/replay-core';
import { snapshotAt } from '../../lib/eval-acquire';
import { gameReplayData, type NewGameRecord } from '../../lib/new-game/record';
import { assembleGameLog } from '../../lib/new-game/game-log';
import { isInterlude } from '../../lib/variation-turns';
import { leadHistoryEntry, replayHistoryEntry } from './replay-entry';
import type { BranchEngineModule, BranchHistoryEntry } from './shared';

/**
 * Round 89 (lane H, #105): the runtime of a new game, from its record. The record's lead entry starts a fresh game on the record's
 * seed (the same start a turn-0 variation makes), and each later entry plays through `replayHistoryEntry`, the road every
 * variation rebuild takes. The simulator is deterministic on its seed, so the rebuilt runtime stands where the game stood when the
 * record was saved, and its log (clock lines dropped) is the record's body.
 */

/** The runtime parameters of the record's lead start: the leads and the bring list come from its first entry. */
export function gameStartParams(record: NewGameRecord): ReconstructParams | null {
  const lead = record.entries[0]?.leadChoices;
  if (!lead) return null;
  return {
    format: getBranchSimulatorFormat(gameReplayData(record)),
    p1Team: record.teams.p1,
    p2Team: record.teams.p2,
    // the header alone: the lead start plays no block of the log
    replayLog: assembleGameLog(record.header, []),
    targetTurn: 1,
    snapshot: null,
    playerNames: [record.players[0], record.players[1]],
    leadOverride: { p1: lead.p1, p2: lead.p2 },
    bringOnly: lead.bring ? { p1: lead.p1, p2: lead.p2 } : undefined,
    seed: record.seed,
  };
}

export interface GameRebuild {
  runtime: BranchRuntime;
  /** The record's entries as the rebuild played them, each with its own position. */
  entries: BranchHistoryEntry[];
  /** The first entry that no longer applies (a team edit removed its move); the entries before it stand. */
  failure: { turnNumber: number; error: string } | null;
}

/** Starts the record's game and plays every entry onto it; null for a record that has not chosen its leads yet. */
export async function rebuildGame(branchEngine: BranchEngineModule, record: NewGameRecord): Promise<GameRebuild | null> {
  const params = gameStartParams(record);
  const lead = record.entries[0]?.leadChoices;
  if (!params || !lead) return null;
  const runtime = await branchEngine.reconstructBranchRuntime(params);
  const invalid = branchEngine.validateBranchRuntime(runtime);
  if (invalid) return { runtime, entries: [], failure: { turnNumber: 0, error: invalid } };
  const start = branchEngine.captureSerializedPosition(runtime.battleStream.battle);
  const entries = [leadHistoryEntry(branchEngine, runtime, lead, start)];
  for (const entry of record.entries.slice(1)) {
    const outcome = await replayHistoryEntry(runtime, branchEngine, entry);
    if (!outcome.ok) return { runtime, entries, failure: { turnNumber: entry.turnNumber, error: outcome.error } };
    entries.push(outcome.entry);
  }
  return { runtime, entries, failure: null };
}

/**
 * The main-line position before each turn of a game, keyed by pointer turn: the lead entry's position stands before turn 1, a
 * turn entry's before the next one, and the last entry of a turn with its interludes settles it. Turns whose entry carries no
 * position are left out.
 */
export function gamePositions(entries: readonly BranchHistoryEntry[]): Map<number, string> {
  const positions = new Map<number, string>();
  let turn = 0;
  entries.forEach((entry, index) => {
    if (!isInterlude(entries, index)) turn += 1;
    if (!isInterlude(entries, index + 1) && entry.serializedPosition) positions.set(turn, entry.serializedPosition);
  });
  return positions;
}

/**
 * The snapshot a game's adopted position corrects from. The game's tip has no block in its log yet, so the arrival's dice alignment
 * would find an empty block and put the position on a fresh seed instead of the game's own PRNG: at the tip the position is adopted
 * as stored (it is exact; no correction, no re-seed). A turn the game has played keeps the replay rule: the position takes the
 * seed that reproduces the log's rolls for the choices the user leaves as they were.
 */
export function gameAdoptSnapshot(snapshots: TurnSnapshot[], turn: number): TurnSnapshot | null {
  return turn >= snapshots.length ? null : snapshotAt(snapshots, turn);
}

/** Replays the record onto a fresh runtime and hands every main-line position out; null for a record without a lead entry. */
export async function restoreGamePositions(
  branchEngine: BranchEngineModule, record: NewGameRecord, store: (turn: number, serialized: string) => void,
): Promise<GameRebuild | null> {
  const rebuilt = await rebuildGame(branchEngine, record);
  if (!rebuilt) return null;
  for (const [turn, serialized] of gamePositions(rebuilt.entries)) store(turn, serialized);
  return rebuilt;
}
