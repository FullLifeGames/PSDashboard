import { describe, expect, test } from 'vitest';
import * as branchEngine from '../../src/lib/lazy/branch-engine';
import { gameReplayData } from '../../src/lib/new-game/record';
import { gameAdoptSnapshot, rebuildGame, restoreGamePositions } from '../../src/hooks/branch/game-rebuild';
import { replayHistoryEntry } from '../../src/hooks/branch/replay-entry';
import type { BranchHistoryEntry } from '../../src/lib/branch-history';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { FAMILIES, playRecord } from './new-game-play';

/**
 * Round 89 (lane H, #105), step H7 (wave-tester, second pass, finding 3): "The same seed, teams and choices roll the same dice."
 * A variation of a game at a past turn starts from the game's own PRNG state at that turn, so the choices the user leaves as they
 * were roll the game's rolls: the turn it plays is the game's log for that turn, line for line. The branch's position is the stored
 * position of the record's rebuild (exact, with the PRNG the game had), adopted the way `usePositionSource` adopts it for a game
 * (`gameAdoptSnapshot`): no re-seed to the log's dice, because the game's true dice are known. The cause before the fix: the adopt
 * put the position on seed index 0 with only the dice a log line names (crit, miss, secondary) forced, so every damage roll and
 * every roll the log does not show came from another stream (the tester: Earthquake 62.5 % in the variation, 59.6 % in the game).
 */

/** The lines of battle turn `turn` in a protocol log, from `|turn|<turn>` up to the next `|turn|` line, clock lines out. */
function turnLines(log: readonly string[], turn: number): string[] {
  const from = log.findIndex(line => line === `|turn|${turn}`);
  if (from < 0) return [];
  const next = log.findIndex((line, index) => index > from && line.startsWith('|turn|'));
  return log.slice(from, next < 0 ? undefined : next).filter(line => !line.startsWith('|t:|'));
}

describe('a variation of a game at a past turn that repeats the game\'s choices rolls the game\'s dice', () => {
  for (const family of FAMILIES) {
    test(`${family.name}: turns 1 to 4 played again from their stored positions give the game's log, line for line`, async () => {
      // five turns: the picks rotate through Earthquake, Protect, Return, Substitute, so turns 1 and 3 are damage turns
      const record = await playRecord(family, 5, '1111,2222,3333,4444');
      expect(record.turns).toBeGreaterThanOrEqual(4);
      const positions = new Map<number, string>();
      const rebuilt = await restoreGamePositions(branchEngine, record, (turn, serialized) => positions.set(turn, serialized));
      expect(rebuilt?.failure).toBeNull();
      const gameLog = rebuilt!.runtime.log;
      const text = gameReplayData(record).log;
      let damageTurns = 0;
      for (let turn = 1; turn <= 4; turn += 1) {
        const runtime = branchEngine.adoptSerializedRuntime({
          serialized: positions.get(turn)!, replayLog: text, targetTurn: turn, snapshot: gameAdoptSnapshot(),
        });
        // the entries of this turn (the turn and the replacements that settle it), played as the user repeats them
        for (const entry of record.entries.filter(candidate => candidate.turnNumber === turn)) {
          const outcome = await replayHistoryEntry(runtime, branchEngine, entry);
          if (!outcome.ok) throw new Error(`turn ${turn}: ${outcome.error}`);
        }
        const wanted = turnLines(gameLog, turn);
        if (wanted.some(line => line.startsWith('|-damage|'))) damageTurns += 1;
        expect(turnLines(runtime.log, turn)).toEqual(wanted);
      }
      expect(damageTurns).toBeGreaterThanOrEqual(1);
    }, 240_000);
  }
});

/**
 * H21a (user ruling 13.11.2026): "the game's dice up to the change, after it what the seed gives". The first half is the spec above. The
 * second half: a variation that changes a choice at turn N rolls the dice the seed's stream gives from that point, which a rebuild of
 * the game from its seed reaches too (the entries before turn N played again, then the changed turn): the two turns are the same lines.
 * The stored position carries the game's PRNG, so the variation and the reference cannot drift apart.
 */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The turn's entry with side one's moves swapped for one that is not the played one (no target needed: Substitute, else Earthquake). */
function changedEntry(entry: BranchHistoryEntry): BranchHistoryEntry {
  const swap = (choice: BranchSlotChoice | null): BranchSlotChoice | null => {
    if (!choice || choice.kind !== 'move') return choice;
    const moveName = choice.moveName === 'Substitute' ? 'Earthquake' : 'Substitute';
    return { kind: 'move', moveId: slug(moveName), moveName };
  };
  return { ...entry, p1SlotChoices: entry.p1SlotChoices?.map(swap) };
}

describe('a variation that changes a choice rolls what the seed gives after the change (H21a)', () => {
  for (const family of FAMILIES) {
    test(`${family.name}: the changed turn 2 is the turn a rebuild from the seed plays with the same change`, async () => {
      const record = await playRecord(family, 3, '4321,8765,1357,2468');
      expect(record.turns).toBeGreaterThanOrEqual(3);
      const positions = new Map<number, string>();
      await restoreGamePositions(branchEngine, record, (turn, serialized) => positions.set(turn, serialized));
      const text = gameReplayData(record).log;
      const turn = 2;
      const variation = branchEngine.adoptSerializedRuntime({ serialized: positions.get(turn)!, replayLog: text, targetTurn: turn, snapshot: gameAdoptSnapshot() });
      const reference = await rebuildGame(branchEngine, { ...record, entries: record.entries.filter(entry => entry.turnNumber < turn) });
      expect(reference?.failure).toBeNull();
      const played = record.entries.filter(entry => entry.turnNumber === turn).map(changedEntry);
      for (const entry of played) {
        const here = await replayHistoryEntry(variation, branchEngine, entry);
        const there = await replayHistoryEntry(reference!.runtime, branchEngine, entry);
        if (!here.ok || !there.ok) throw new Error(`turn ${turn}: ${here.ok ? '' : here.error} ${there.ok ? '' : there.error}`);
      }
      const wanted = turnLines(reference!.runtime.log, turn);
      expect(wanted.length).toBeGreaterThan(1);
      expect(turnLines(variation.log, turn)).toEqual(wanted);
      // the change is real: the game's own turn 2 read differently
      expect(turnLines(variation.log, turn)).not.toEqual(turnLines(restoredLog(record), turn));
    }, 240_000);
  }
});

/** The game's full log as its record's rebuild writes it. */
function restoredLog(record: Parameters<typeof gameReplayData>[0]): string[] {
  return gameReplayData(record).log.split('\n');
}
