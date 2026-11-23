import { describe, expect, test } from 'vitest';
import { SCREENS, standingScreens } from '../src/dex-facts/index';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * The screens are one constant (`SCREEN_FLAGS` in dex-facts/screens.ts, `SCREENS` its keys), because the Dex cannot say them: the
 * handler rule (`onAnyModifyDamage`) finds them only from Generation 5, and Generations 2 to 4 cut the damage inside the stat or
 * damage calculation. In every view the corpus plays, the damage of a physical (Tackle) and a special (Thunderbolt) hit against a
 * Snorlax is asked of the simulator with and without each side condition a move of the view sets (crits off, same dice): the
 * conditions that cut it are the list (Reflect physical, Light Screen special, Aurora Veil both, from Generation 7); in doubles the
 * cut is the same condition at a different fraction. Generation 1 builds Reflect and Light Screen as volatiles, so a read of
 * `side.sideConditions` never sees them: `standingScreens(side)` reads the side conditions and the volatiles of the actives, and the
 * log parser books the screen on a hit in every view.
 */

const SPEC = 'packages/replay-core/test/screens-oracle.spec.ts';
const HITS = [{ category: 'Physical', move: 'tackle', user: 'Machamp' }, { category: 'Special', move: 'thunderbolt', user: 'Alakazam' }];

const isReal = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future' && !move.isMax && !move.isZ;
};

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

  describe.each(ALL_VIEWS)('$name: standingScreens', view => {
    const screenMoves = SCREENS.filter(id => isReal(view, id));
    const play = (id: string) => {
      const user = id === 'auroraveil' ? 'Snorlax' : 'Blissey';
      const battle = battleIn(view, [mon(user, [id, 'splash']), mon('Blissey', ['splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      if (id === 'auroraveil') battle.field.setWeather(view.dex.conditions.get('snow').exists ? 'snow' : 'hail', battle.sides[0].active[0]);
      battle.choose('p1', view.doubles ? 'move 1, move 1' : 'move 1');
      battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
      return battle;
    };

    test('finds each screen the simulator holds for the side that used it, and none on the other side', () => {
      for (const id of screenMoves) {
        const battle = play(id);
        const held = battle.sides[0].sideConditions[id] || battle.sides[0].active.some(mon => mon.volatiles[id]);
        if (!held) continue; // Aurora Veil needs the weather to start: a view without it holds nothing to find
        expect(standingScreens(battle.sides[0]), id).toEqual([id]);
        expect(standingScreens(battle.sides[1]), id).toEqual([]);
      }
    });

    test('a screen that is not up is not found', () => {
      const battle = battleIn(view, [mon('Blissey', ['splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
      expect(standingScreens(battle.sides[0])).toEqual([]);
    });

    test('the log parser books the screen on a hit it cuts', () => {
      for (const [id, hit] of [['reflect', HITS[0]], ['lightscreen', HITS[1]]] as const) {
        if (!isReal(view, id)) continue;
        const battle = battleIn(view, [mon(hit.user, [hit.move, 'splash']), mon('Blissey', ['splash']), mon('Blissey', ['splash'])], [mon('Blissey', [id, 'splash']), mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
        battle.choose('p1', view.doubles ? 'move 2, move 1' : 'move 2'); battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1'); // the screen goes up
        battle.choose('p1', view.doubles ? 'move 1 1, move 1' : 'move 1'); battle.choose('p2', view.doubles ? 'move 2, move 1' : 'move 2'); // the hit
        const log = battle.log.filter((line, index) => !line.startsWith('|split|') && !battle.log[index - 1]?.startsWith('|split|'));
        const booked = parseReplayLogWithObservations([...log, '|win|Alpha'].join('\n')).observations.filter(observation => observation.moveId === hit.move);
        expect(booked.length, `${id}: a hit was observed`).toBeGreaterThan(0);
        expect(booked.map(observation => observation.screens), id).toEqual(booked.map(() => [id]));
      }
    });
  });
});
