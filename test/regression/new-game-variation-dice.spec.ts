import { describe, expect, test } from 'vitest';
import * as branchEngine from '../../src/lib/lazy/branch-engine';
import { gameReplayData } from '../../src/lib/new-game/record';
import { gameAdoptSnapshot, restoreGamePositions } from '../../src/hooks/branch/game-rebuild';
import { replayHistoryEntry } from '../../src/hooks/branch/replay-entry';
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
