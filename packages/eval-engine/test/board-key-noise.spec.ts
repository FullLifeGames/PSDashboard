import { describe, expect, test } from 'vitest';
import { PRNG, type Battle } from '@pkmn/sim';
import { BOARD_FIELDS, boardReads, boardStateKey, bodyStateKey, type Consumer, type ReadSet } from '../src/score/board-key';
import { loadSimMods } from '../src/forward/sim-mods';
import { SWEEP_CASES } from './dice-sweep-support';
import { attackerOf, boardFor, defenderOf } from './board-key-support';

/**
 * Round 89 (#149, step A8-6): what never reaches the board key. A key that carries the bookkeeping of the protocol (the log,
 * the PRNG's starting seed, the rule table, the format) makes every play of a board its own entry, and the memo then plays
 * again what it holds. `battle.queue` is a `read` field (Analytic, Sucker Punch, Fake Out and the like ask whether a body
 * still moves this turn), and the queue object points back at its battle: the key must follow the queue's list and leave the
 * back-reference out. Both consumers, every rule set, singles and doubles, with every `read` field of the table keyed (the
 * widest read set a board can have), so that no field hides behind "nothing on this board reads it".
 */

await loadSimMods('gen9championscustomgame');

const everyRead = (): ReadSet => new Set(Object.values(BOARD_FIELDS).flatMap(fields => Object.entries(fields).filter(([, [hit, residual]]) => hit === 'read' || residual === 'read').map(([name]) => name)));

/** Two boards of one case that differ only in the protocol's bookkeeping: the log, the PRNG's seed, the sent request. */
function twins(rules: (typeof SWEEP_CASES)[number]['rules'], mode: 'singles' | 'doubles'): [Battle, Battle] {
  const first = boardFor(rules, mode, 'tackle');
  const second = boardFor(rules, mode, 'tackle');
  second.log.push('|t:|1794519822', '|move|p2a: Vaporeon|Tackle|p1a: Snorlax');
  second.messageLog.push('|a log line|');
  second.prng = new PRNG([9, 8, 7, 6]);
  return [first, second];
}

describe('the board key leaves the bookkeeping of the protocol out', () => {
  for (const { rules, mode, name } of SWEEP_CASES) {
    for (const consumer of ['hit', 'residual'] as Consumer[]) {
      test(`${name}, ${consumer}: the log, the PRNG seed and the format do not split a board whose handlers read the queue`, () => {
        const [first, second] = twins(rules, mode);
        const reads = everyRead();
        expect(reads.has('queue')).toBe(true);
        expect(boardStateKey(second, reads, consumer)).toBe(boardStateKey(first, reads, consumer));
        for (const pick of [attackerOf, defenderOf]) expect(bodyStateKey(pick(second), reads, consumer)).toBe(bodyStateKey(pick(first), reads, consumer));
      });
    }
  }

  test('the queue still splits the key where its list differs (the field is read, only its back-reference is not)', () => {
    for (const { rules, mode } of SWEEP_CASES) {
      const first = boardFor(rules, mode, 'tackle');
      const second = boardFor(rules, mode, 'tackle');
      const move = second.dex.moves.get('tackle');
      second.queue.list.push({ choice: 'move', pokemon: defenderOf(second), move, moveid: move.id, order: 200, priority: 0, speed: 100, targetLoc: 0 } as never);
      expect(boardStateKey(second, everyRead(), 'hit')).not.toBe(boardStateKey(first, everyRead(), 'hit'));
    }
  });
});

/**
 * The display text of a body's type (`apparentType`, what the client shows after a type change; `types` carries the rule) and the
 * Leppa Berry bookkeeping of the simulator (`pendingStaleness`, `staleness`, which only a tie-break of a stalled battle reads) are
 * `read` fields: they enter the key where a handler of the board names them, and no hit and no end of the turn on a board without
 * such a handler reads them. The sweeps of test/board-key-readers.spec.ts hold the field to the simulator on a bare board.
 */
describe('the display type and the Leppa bookkeeping split a key only where a handler reads them', () => {
  for (const { rules, mode, name } of SWEEP_CASES) {
    for (const consumer of ['hit', 'residual'] as Consumer[]) {
      test(`${name}, ${consumer}: apparentType and pendingStaleness`, () => {
        const first = boardFor(rules, mode, 'tackle');
        const second = boardFor(rules, mode, 'tackle');
        const body = attackerOf(second) as unknown as Record<string, unknown>;
        body.apparentType = `${String(body.apparentType)}/Flying`;
        body.pendingStaleness = 'external';
        body.staleness = 'internal';
        const reads = boardReads(first, consumer, consumer === 'hit' ? 'tackle' : undefined);
        expect(reads.has('apparentType') || reads.has('pendingStaleness') || reads.has('staleness')).toBe(false);
        expect(bodyStateKey(attackerOf(second), reads, consumer)).toBe(bodyStateKey(attackerOf(first), reads, consumer));
      });
    }
  }
});
