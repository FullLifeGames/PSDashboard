import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { SCREENS } from '../src/dex-facts/index';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 5 and GO point 4: the screens are one constant (`SCREEN_FLAGS` in dex-facts/screens.ts, `SCREENS` its keys), because the Dex
 * cannot say them: the handler rule (`onAnyModifyDamage`) finds them only from Generation 5, and Generations 2 to 4 cut the
 * damage inside the stat or damage calculation. The simulator is the oracle, played in every view the corpus plays: for every
 * side condition a move of the view sets, the damage of a physical hit (Tackle) and of a special hit (Thunderbolt) against a
 * Snorlax is asked of the simulator with and without the condition standing on its side (crits off, same dice), and the
 * conditions that cut it are the list: Reflect for the physical hit, Light Screen for the special hit, Aurora Veil for both,
 * wherever the move is real (Aurora Veil from Generation 7). In doubles the cut is the same condition at a different fraction.
 *  - FINDING W10: Generation 1 builds Reflect and Light Screen as volatiles (no side condition), so a read of
 *    `side.sideConditions` never sees them there; the volatile cuts the damage (played below).
 * The seven readers (and ko-odds.ts) import the one constant instead of keeping a list of their own; a source check holds that.
 */

const SPEC = 'packages/replay-core/test/screens-oracle.spec.ts';
const HITS = [{ category: 'Physical', move: 'tackle', user: 'Machamp' }, { category: 'Special', move: 'thunderbolt', user: 'Alakazam' }];

const isReal = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future' && !move.isMax && !move.isZ;
};

/** The damage the simulator gives the hit after `prepare` ran on the defender's side. */
function damage(view: SimView, hit: (typeof HITS)[number], prepare?: (side: ReturnType<typeof battleIn>['sides'][0], defender: ReturnType<typeof battleIn>['sides'][0]['active'][0]) => void): unknown {
  const battle = battleIn(view, [mon(hit.user, [hit.move]), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Blissey', ['splash'])]);
  const defender = battle.sides[1].active[0];
  prepare?.(battle.sides[1], defender);
  const move = battle.dex.getActiveMove(hit.move);
  move.willCrit = false;
  return battle.actions.getDamage(battle.sides[0].active[0], defender, move);
}

describe('SCREENS is held to the simulator (round 72)', () => {
  test('the constant carries its oracle tag', () => {
    expect(oracleTagAbove('packages/replay-core/src/dex-facts/screens.ts', 'export const SCREEN_FLAGS', SPEC)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    test('the side conditions that cut a physical or a special hit are the screens', () => {
      const conditions = [...new Set(view.dex.moves.all().filter(move => isReal(view, move.id) && move.sideCondition).map(move => move.sideCondition as string))];
      const cutting = conditions.filter(id => HITS.some(hit => damage(view, hit) !== damage(view, hit, (side, defender) => { side.addSideCondition(id, defender!); }))).sort();
      const expected = SCREENS.filter(id => conditions.includes(id)).sort();
      expect(cutting).toEqual(expected);
      if (view.dex.gen >= 2) expect(cutting.length).toBeGreaterThan(0);
    });

    test('each screen cuts its own category', () => {
      for (const id of SCREENS.filter(name => isReal(view, name) && view.dex.moves.get(name).sideCondition)) {
        const cuts = HITS.filter(hit => damage(view, hit) !== damage(view, hit, (side, defender) => { side.addSideCondition(id, defender!); })).map(hit => hit.category);
        expect(cuts, id).toEqual(id === 'reflect' ? ['Physical'] : id === 'lightscreen' ? ['Special'] : ['Physical', 'Special']);
      }
    });
  });

  test('Generation 1 keeps Reflect and Light Screen as volatiles, which cut the damage (W10)', () => {
    const view = ALL_VIEWS[0];
    expect(view.dex.gen).toBe(1);
    for (const [id, hit] of [['reflect', HITS[0]], ['lightscreen', HITS[1]]] as const) {
      expect(view.dex.moves.get(id).sideCondition).toBeFalsy();
      const cut = damage(view, hit, (_side, defender) => { defender!.addVolatile(id); });
      expect(cut).not.toBe(damage(view, hit));
    }
  });

  test('the readers import the one constant and keep no list of their own', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const readers = [
      'packages/eval-engine/src/score/features.ts', 'packages/eval-engine/src/pair/snapshot.ts', 'packages/eval-engine/src/damage-calc.ts',
      'packages/eval-engine/src/ko-odds.ts', 'packages/replay-core/src/inference/hits.ts', 'packages/replay-core/src/protocol/handlers.ts',
      'packages/replay-core/src/team/item-damage-shared.ts', 'packages/replay-core/src/spreads/observation-read.ts',
    ];
    for (const file of readers) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(/\b(SCREENS|screenFlags)\b/.test(source), `${file} reads the constant`).toBe(true);
      expect(/'(reflect|lightscreen|auroraveil)'/.test(source), `${file} keeps no screen literal`).toBe(false);
    }
  });
});
