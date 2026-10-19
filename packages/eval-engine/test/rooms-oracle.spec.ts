import { describe, expect, test } from 'vitest';
import { ROOMS } from '../src/pair/snapshot';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 14: `ROOMS` in pair/snapshot.ts names the pseudo-weathers the damage calculator's Field reads
 * (isGravity, isMagicRoom, isWonderRoom). The Dex has more pseudo-weathers; the question for the list is which of them change
 * a damage roll. This spec adds each pseudo-weather the view's moves set to a battle and asks the simulator for the damage of
 * six hits (a physical and a special Normal hit, a Ground move at a Flying target, a Normal hit at a Ground target, an
 * Electric and a Fire hit, and a Life Orb hit) with and without it. The pseudo-weathers that change one of them are:
 *  - the three of ROOMS, in every view that has the move (Gravity, Magic Room, Wonder Room);
 *  - FINDING W8: Mud Sport, Water Sport and Ion Deluge (which Plasma Fists sets as well) change the roll and the calculator's
 *    Field has no flag for them, so the pair snapshot prices those hits without them (Ion Deluge, Plasma Fists, Mud Sport and
 *    Water Sport are Past moves in Generation 9; Mud Sport and Water Sport are live in Generations 3 to 8).
 * Trick Room and Fairy Lock change no roll. The hand list stays as it is; the unlisted three are named for the integrator.
 */

const SPEC = 'packages/eval-engine/test/rooms-oracle.spec.ts';

/** Pseudo-weathers that change a roll but are not in ROOMS (finding W8). */
const UNKEYED = ['iondeluge', 'mudsport', 'watersport'];

interface Scenario { name: string; user: string; item?: string; move: string; target: string }
const SCENARIOS: Scenario[] = [
  { name: 'physical Normal at Snorlax', user: 'Machamp', move: 'tackle', target: 'Snorlax' },
  { name: 'special Normal at Snorlax', user: 'Alakazam', move: 'swift', target: 'Snorlax' },
  { name: 'Ground move at a Flying target', user: 'Machamp', move: 'earthquake', target: 'Pidgeot' },
  { name: 'Normal move at a Ground target', user: 'Machamp', move: 'tackle', target: 'Golem' },
  { name: 'Electric hit', user: 'Alakazam', move: 'thunderbolt', target: 'Snorlax' },
  { name: 'Fire hit', user: 'Alakazam', move: 'flamethrower', target: 'Snorlax' },
  { name: 'Life Orb hit', user: 'Machamp', item: 'lifeorb', move: 'tackle', target: 'Snorlax' },
];

const isReal = (view: SimView, kind: 'moves' | 'items', id: string): boolean => {
  const entry = view.dex[kind].get(id);
  return entry.exists && entry.isNonstandard !== 'Future';
};

/** The damage the simulator gives the hit, on a battle where `prepare` has run. */
function damage(view: SimView, scenario: Scenario, prepare?: (battle: ReturnType<typeof battleIn>, user: ReturnType<typeof battleIn>['sides'][0]['pokemon'][0]) => void): unknown {
  const battle = battleIn(view,
    [mon(scenario.user, ['splash'], scenario.item ? { item: scenario.item } : {}), mon('Blissey', ['splash'])],
    [mon(scenario.target, ['splash']), mon('Blissey', ['splash'])]);
  const user = battle.sides[0].active[0];
  prepare?.(battle, user);
  const target = battle.sides[1].active[0];
  let move = battle.dex.getActiveMove(scenario.move);
  move.willCrit = false;
  battle.setActiveMove(move, user, target);
  move = battle.runEvent('ModifyType', user, target, move, move) as typeof move; // Ion Deluge turns Normal moves Electric here
  return battle.actions.getDamage(user, target, move);
}

describe('ROOMS is held to the simulator (round 72)', () => {
  test('the list carries its oracle tag', () => {
    expect(oracleTagAbove('packages/eval-engine/src/pair/snapshot.ts', 'const ROOMS', SPEC)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const pseudoWeathers = [...new Set(view.dex.moves.all()
      .filter(move => isReal(view, 'moves', move.id) && move.pseudoWeather)
      .map(move => move.pseudoWeather as string))].sort();
    const scenarios = SCENARIOS.filter(scenario => isReal(view, 'moves', scenario.move) && (!scenario.item || isReal(view, 'items', scenario.item)));

    test('the pseudo-weathers that change a roll are ROOMS and the three named', () => {
      if (pseudoWeathers.length === 0) return; // Generations 1 to 3 have none the corpus plays
      const changing = pseudoWeathers.filter(id => scenarios.some(scenario => {
        const plain = damage(view, scenario);
        const set = damage(view, scenario, (battle, user) => { battle.field.addPseudoWeather(id, user); });
        return plain !== set;
      }));
      const keyed = ROOMS.filter(id => pseudoWeathers.includes(id));
      const expected = [...keyed, ...UNKEYED.filter(id => pseudoWeathers.includes(id))].sort();
      expect(changing).toEqual(expected);
    });
  });

  test('every room of the list is a pseudo-weather some move of the Dex sets', () => {
    for (const id of ROOMS) expect(ALL_VIEWS.some(view => view.dex.moves.all().some(move => move.pseudoWeather === id)), id).toBe(true);
  });
});
