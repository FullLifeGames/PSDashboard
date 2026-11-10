import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly, type ReplayData,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext, loadSimMods, reconstructBranchRuntime } from '@fulllifegames/eval-engine';
import { bankTeamsFor } from './bank-build';
import { emittedBlock } from './forced-reconstruction-support';
import { diskCachedSmogonFetcher } from './smogon-fetch-cache';

/**
 * Round 89 (#131, #144, #135): the corpus rows of lane C rebuild a game through one turn, like the bank does, and compare the turn's
 * emitted block with the log's block. `refusalsOfTurn` counts the refusals the turn itself adds.
 */

type Fixture = ReplayData & { formatid: string };

/** The games sit in the local fit corpus (`.fit-corpus`), which a clone lacks: the rows then skip. */
export const CORPUS = (id: string): string => join('.fit-corpus', `${id}.json`);

/** The log's lines of a turn: from its `|turn|` line to the next, without the `|upkeep` marker. */
export function logBlock(log: string, turn: number): string[] {
  const lines = log.split('\n');
  const from = lines.indexOf(`|turn|${turn}`);
  const to = lines.findIndex((line, at) => at > from && line.startsWith('|turn|'));
  return lines.slice(from + 1, to < 0 ? undefined : to).filter(line => line !== '|upkeep');
}

export async function rebuildThrough(id: string, through: number) {
  const replay = JSON.parse(readFileSync(CORPUS(id), 'utf-8')) as Fixture;
  await loadSimMods(getBranchSimulatorFormat(replay));
  const parsed = parseReplayLogWithObservations(replay.log);
  const built = await bankTeamsFor({ log: replay.log, formatId: replay.formatid ?? id, parsed, fetcher: diskCachedSmogonFetcher() });
  if (!built.teams) throw new Error(`${id}: no teams (${built.reason})`);
  const { p1Team, p2Team } = built.teams;
  const snapshotFor = (turn: number) => parsed.snapshots[Math.min(turn - 1, parsed.snapshots.length - 1)] ?? null;
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log, targetTurn: through + 1,
    snapshot: snapshotFor(through + 1), playerNames: [replay.players[0], replay.players[1]],
    choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, parsed.observations),
    bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
    deadlineMs: 600_000,
  });
  return {
    logged: logBlock(replay.log, through),
    emitted: publicLines(emittedBlock(runtime.battleStream.battle!.log, through)),
    refusals: runtime.choiceErrors.count,
    lastError: runtime.choiceErrors.last,
    /** The rebuilt battle at the start of turn `through + 1`. */
    battle: runtime.battleStream.battle!,
  };
}

/** The refusals the turn itself adds: the count through the turn less the count through the turn before (earlier turns keep their own causes). */
export async function refusalsOfTurn(id: string, through: number, upTo: number): Promise<number> {
  return upTo - (through > 1 ? (await rebuildThrough(id, through - 1)).refusals : 0);
}

/** The public half of a battle log: the simulator writes each private line twice (`|split|pN`, the owner's line, the spectator's line). */
export function publicLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith('|split|')) index++; else out.push(lines[index]);
  }
  return out;
}
