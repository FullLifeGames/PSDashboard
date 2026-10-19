import { describe, expect, test } from 'vitest';
import { hazardConditions } from '@fulllifegames/replay-core';
import { BOTH_SIDES_REMOVAL_MOVES, OWN_SIDE_REMOVAL_MOVES, removalKind } from '../src/score/hazards';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 10: score/hazards.ts names five hazard removal moves in two lists, those that clear only the
 * user's side (Rapid Spin, Mortal Spin, Tidy Up) and those that clear or swap both sides (Defog, Court Change). No field of
 * the Dex says it: a removal is a handler (`onHit` or `onAfterHit` walking the side conditions), so this list stays by hand
 * and this spec says why it is right. It splits the hazards the view has between the two sides,
 * plays every move of the view from a fresh battle and keeps the moves that remove a hazard from the side that holds it. Max and Z moves are
 * left out (a Dynamax or a Z crystal is not a move set), and so is every move whose Dex entry holds no function (a hazard
 * comes off through code; 495 of 866 Generation 9 entries are plain data), which keeps the sweep near 15 seconds. The list, held to the simulator:
 *  - Rapid Spin, Mortal Spin and Court Change clear the user's side, Defog and Court Change the foe's, as listed;
 *  - FINDING W6a: Tidy Up clears the foe's hazards too (Generation 9 and Champions), so it stands in the second list;
 *  - FINDING W6b: Defog clears only the foe's side in Generations 4 and 5, so it brings the user no relief there (`removalKind`
 *    answers null for it before Generation 6).
 * A new Dex move or a new difference fails here.
 */

const OWN_ONLY = [...OWN_SIDE_REMOVAL_MOVES].sort();
const BOTH = [...BOTH_SIDES_REMOVAL_MOVES].sort();
/** Whether the Dex entry of a move holds code (a handler on it, or inside its secondary, self or condition). Removing a hazard takes code. */
const carriesCode = (value: unknown, depth = 0): boolean =>
  typeof value === 'function' || (depth < 3 && typeof value === 'object' && value !== null && Object.values(value).some(inner => carriesCode(inner, depth + 1)));

const isReal = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future';
};

/**
 * One turn of every move of the view from a fresh battle. The hazards the view has are split between the two sides (every
 * other one on each, all of them on both when the view has a single one), so a swap such as Court Change shows as a loss on
 * both. A move "clears" a side when one of the hazards laid on it no longer stands there after the turn.
 */
function sweep(view: SimView, hazards: string[]): { own: string[]; foe: string[] } {
  const split = hazards.length >= 2;
  const laid = { own: split ? hazards.filter((_, index) => index % 2 === 0) : hazards, foe: split ? hazards.filter((_, index) => index % 2 === 1) : hazards };
  const found = { own: [] as string[], foe: [] as string[] };
  for (const move of view.dex.moves.all()) {
    if (!isReal(view, move.id) || move.isMax || move.isZ || !carriesCode(move)) continue;
    const battle = battleIn(view, [mon('Blissey', [move.id, 'splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
    const sides = { own: battle.sides[0], foe: battle.sides[1] };
    for (const key of ['own', 'foe'] as const) for (const id of laid[key]) sides[key].addSideCondition(id, sides[key].active[0]);
    const aimed = ['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf'].includes(move.target);
    battle.choose('p1', view.doubles ? `move 1${aimed ? ' 1' : ''}, move 1` : 'move 1');
    battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
    for (const key of ['own', 'foe'] as const) if (laid[key].some(id => !sides[key].sideConditions[id])) found[key].push(move.id);
  }
  return { own: found.own.sort(), foe: found.foe.sort() };
}

const real = (view: SimView, ids: string[]) => ids.filter(id => isReal(view, id));

describe('hazard removal lists are held to the simulator (round 72)', () => {
  test('both lists carry their oracle tag', () => {
    const spec = 'packages/eval-engine/test/hazard-removal-oracle.spec.ts';
    expect(oracleTagAbove('packages/eval-engine/src/score/hazards.ts', 'const OWN_SIDE_REMOVAL_MOVES', spec)).toBe(true);
    expect(oracleTagAbove('packages/eval-engine/src/score/hazards.ts', 'const BOTH_SIDES_REMOVAL_MOVES', spec)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const hazards = [...hazardConditions(view.dex)].filter(id => isReal(view, id)).sort();
    const realHere = (ids: string[]) => real(view, ids);
    let played: { own: string[]; foe: string[] } | undefined;
    const removed = () => (played ??= sweep(view, hazards));

    test('the moves that clear the hazards of the user are the listed ones that give relief', () => {
      if (hazards.length === 0) return; // Generation 1 has no hazards: nothing to remove
      const expected = realHere([...OWN_ONLY, ...BOTH]).filter(id => removalKind(id, view.dex.gen) !== null);
      expect(removed().own).toEqual(expected.sort());
    });

    test('the moves that clear the hazards of the foe are the second list', () => {
      if (hazards.length === 0) return;
      expect(removed().foe).toEqual(realHere([...BOTH]).sort());
    });

    test('removalKind says own for a move that clears the user side only, both for one that clears both, null for the rest', () => {
      if (hazards.length === 0) return;
      for (const id of realHere([...OWN_ONLY, ...BOTH])) {
        const own = removed().own.includes(id);
        const foe = removed().foe.includes(id);
        expect(removalKind(id, view.dex.gen), id).toBe(own && foe ? 'both' : own ? 'own' : null);
      }
    });
  });

  test('the five listed moves carry code, so the prefilter of the sweep keeps them', () => {
    for (const view of ALL_VIEWS) for (const id of real(view, [...OWN_ONLY, ...BOTH])) expect(carriesCode(view.dex.moves.get(id))).toBe(true);
  });

  test('Generation 1 has no hazard, so its hazard cost never reaches a removal list', () => {
    expect([...hazardConditions(ALL_VIEWS[0].dex)].filter(id => isReal(ALL_VIEWS[0], id))).toEqual([]);
  });
});
