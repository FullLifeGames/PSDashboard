import { describe, expect, test } from 'vitest';
import type { Battle } from '@pkmn/sim';
import { UNPRICEABLE_MOVE_IDS } from '../src/ko-odds';
import { ALL_VIEWS, battleIn, known, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 8: `UNPRICEABLE_MOVE_IDS` in ko-odds.ts names the 31 moves whose immediate damage the one-turn
 * model cannot price. The Dex says why for 30 of them, through a field the simulator reads (a charge turn, a future hit, a
 * self-destruct, a damage callback, a callback before the turn, a condition on the turn that fails the move); Beat Up is the
 * one whose reason is only a handler (it counts the party). This spec holds the list to the simulator in every view the corpus
 * plays: each name carries a reason in every view that has the move, the delayed and self-destroying reasons are played, and
 * a damaging move whose Dex entry carries such a reason but stays off the list is named below with its count, so a new Dex
 * move fails here. Deriving the whole class would move scores, which is finding W3 of the lane (its review is in the ledger).
 */

type Reason = 'delayed' | 'self-ko' | 'reactive' | 'turn-order' | 'condition' | 'party';

const reasonOf = (move: ReturnType<SimView['dex']['moves']['get']>): Reason | null => {
  const m = move as unknown as Record<string, unknown>;
  const flags = move.flags as Record<string, unknown>;
  if (flags.charge || flags.futuremove) return 'delayed';
  if (move.selfdestruct) return 'self-ko';
  if (m.damageCallback) return 'reactive';
  if (m.beforeTurnCallback || m.priorityChargeCallback) return 'turn-order';
  if (m.onTry) return 'condition';
  return null;
};

/** Beat Up: its multi-hit count is the party (onModifyMove). The only listed move with no field of the six. */
const PARTY = new Set(['beatup']);

/** Damaging moves with a reason in some view that the list leaves out: the review candidates of finding W3. */
const UNLISTED_WITH_REASON: string[] = [
  // damage callbacks, priced by their own rules (HALVING_MOVES in score/threat.ts, the fixed-damage and Psywave rules)
  'superfang', 'naturesmadness', 'ruination', 'endeavor', 'psywave', 'guardianofalola',
  // a condition on the turn or on the user (first turn out, last move, a berry, a hit taken first)
  'feint', 'lastresort', 'snore', 'round', 'hyperspacefury', 'belch', 'aurawheel', 'firstimpression', 'poltergeist', 'spitup',
  'steelroller', 'upperhand',
  // a charge turn the model prices as one hit, and a callback before the turn
  'skydrop', 'beakblast', 'shelltrap',
];

describe('UNPRICEABLE_MOVE_IDS is held to the simulator (round 72)', () => {
  test('the list carries its oracle tag', () => {
    expect(oracleTagAbove('packages/eval-engine/src/ko-odds.ts', 'const UNPRICEABLE_MOVE_IDS', 'packages/eval-engine/test/unpriceable-oracle.spec.ts')).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const listed = [...UNPRICEABLE_MOVE_IDS].filter(id => view.dex.moves.get(id).exists);

    test('every listed move has a reason the simulator reads', () => {
      const without = listed.filter(id => !PARTY.has(id) && reasonOf(view.dex.moves.get(id)) === null);
      expect(without).toEqual([]);
      for (const id of PARTY) if (listed.includes(id)) expect(typeof (view.dex.moves.get(id) as unknown as { onModifyMove?: unknown }).onModifyMove).toBe('function');
    });

    test('the moves with a reason that stay off the list are the named review candidates', () => {
      const unlisted = view.dex.moves.all()
        .filter(move => move.exists && move.category !== 'Status' && !UNPRICEABLE_MOVE_IDS.has(move.id) && reasonOf(move) !== null)
        .map(move => move.id);
      expect(unlisted.filter(id => !UNLISTED_WITH_REASON.includes(id))).toEqual([]);
    });
  });
});

/** Plays `moveId` as the first move of a user against a sturdy target and returns the log. */
function playFirstTurn(view: SimView, moveId: string, filler: string): Battle {
  const mk = (species: string, moves: string[]) => mon(species, moves);
  const battle = battleIn(view,
    [mk('Blissey', [moveId, filler]), mk('Blissey', [filler])],
    [mk('Snorlax', [filler]), mk('Snorlax', [filler])]);
  const aimed = ['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf'].includes(view.dex.moves.get(moveId).target);
  battle.choose('p1', view.doubles ? `move 1${aimed ? ' 1' : ''}, move 1` : 'move 1');
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  return battle;
}

describe.each(ALL_VIEWS)('$name: the delayed and self-destroying reasons, played', view => {
  const ids = [...UNPRICEABLE_MOVE_IDS].filter(id => view.dex.moves.get(id).exists);
  const filler = known(view, ['splash', 'harden', 'tackle'])[0];

  test('a charge or future move announces its hit instead of dealing it on the first turn', () => {
    const delayed = ids.filter(id => reasonOf(view.dex.moves.get(id)) === 'delayed');
    expect(delayed.length).toBeGreaterThan(0);
    const dealt = delayed.filter(id => {
      const log = playFirstTurn(view, id, filler).log;
      const announced = log.some(line => /^\|-prepare\|p1a/.test(line) || /^\|-start\|p2a: .*\|move: /.test(line) || /^\|-anim\|/.test(line));
      return !announced && log.some(line => /^\|-damage\|p2a/.test(line));
    });
    expect(dealt).toEqual([]);
  });

  test('a self-destruct move faints its user', () => {
    const selfKo = ids.filter(id => view.dex.moves.get(id).selfdestruct === 'always');
    expect(selfKo.length).toBeGreaterThan(0);
    const survived = selfKo.filter(id => !playFirstTurn(view, id, filler).log.some(line => /^\|faint\|p1a/.test(line)));
    expect(survived).toEqual([]);
  });
});
