import { describe, expect, test } from 'vitest';
import { LAYER_CAPS, failsAgainstStanding } from '../src/search/options';
import type { positionBattle } from '../src/forward-model';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 15, FINDINGS W4 and W4b: search/options.ts drops a field move from the option list while its
 * condition already stands ("clicking it is a pass with a real-looking label", GPL T25). The hand table of ten ids missed three
 * side-condition moves the simulator fails against their standing condition (Crafty Shield, Lucky Chant, Mat Block) and never
 * dropped Spikes in Generation 2, where one layer is the cap. Quick Guard and Wide Guard also lack a table entry, but they run an
 * `onHitSide` handler and print no failure with their condition standing (it ends within the turn), so the rule leaves them. The
 * simulator's rule (`Side.addSideCondition`)
 * is: a condition that stands and has no restart handler (`onSideRestart`) fails to start again; Spikes and Toxic Spikes have the
 * handler and refuse a layer past their cap, which lives in the handler's code (`LAYER_CAPS`, held here). For every move that sets a
 * side condition, in every view the corpus plays, this spec lays the condition on the side the move acts on (as many layers as the
 * simulator takes), plays the move once and keeps the moves that print a failure where the same turn without the standing
 * condition does not (under the weather a move may need: none, Snow, Hail). Then:
 *  - `failsAgainstStanding` drops exactly those moves with the full stack standing;
 *  - the cap of each layered hazard is what the simulator takes, and one layer below it is no no-op;
 *  - the layered hazards are the conditions with a restart handler (none in Generation 2).
 */

const SPEC = 'packages/eval-engine/test/noop-field-moves-oracle.spec.ts';
type Side = ReturnType<typeof positionBattle>['sides'][number];

const isReal = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future' && !move.isMax && !move.isZ;
};

type Weather = '' | 'snow' | 'hail';
const WEATHERS: Weather[] = ['', 'snow', 'hail'];

/** A battle where the first Blissey holds `moveId`; `layers` of its condition stand on the side it acts on (none: untouched). */
function prepared(view: SimView, moveId: string, weather: Weather, layers: number) {
  const move = view.dex.moves.get(moveId);
  const battle = battleIn(view, [mon('Blissey', [moveId, 'splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  const user = battle.sides[0].active[0];
  if (weather) battle.field.setWeather(weather, user);
  const holder: 0 | 1 = move.target === 'foeSide' ? 1 : 0;
  for (let count = 0; count < layers; count++) if (!battle.sides[holder].addSideCondition(move.sideCondition!, user)) break;
  return { battle, holder };
}

/** One turn of `moveId` by the first Blissey; `standing` lays its condition first (as many layers as the simulator takes). */
function play(view: SimView, moveId: string, standing: boolean, weather: Weather): boolean {
  const { battle } = prepared(view, moveId, weather, standing ? 9 : 0);
  const mark = battle.log.length;
  battle.choose('p1', view.doubles ? 'move 1, move 1' : 'move 1');
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  const turn = battle.log.slice(mark);
  const moved = turn.findIndex(line => line.startsWith('|move|p1a'));
  if (moved < 0) return false;
  const next = turn.findIndex((line, index) => index > moved && line.startsWith('|move|'));
  return turn.slice(moved + 1, next < 0 ? undefined : next).some(line => line.startsWith('|-fail|')); // Generation 2 names the target
}

/** Whether the simulator fails the move against its standing condition, but not without it (under some weather it may need). */
function simulatorFails(view: SimView, moveId: string): boolean {
  return WEATHERS.some(weather => {
    return !play(view, moveId, false, weather) && play(view, moveId, true, weather);
  });
}

describe('field moves against a standing condition are read from the Dex and held to the simulator (round 72)', () => {
  test('the layer caps carry their oracle tag', () => {
    expect(oracleTagAbove('packages/eval-engine/src/search/options.ts', 'export const LAYER_CAPS', SPEC)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const setters = [...new Set(view.dex.moves.all().filter(move => isReal(view, move.id) && move.sideCondition).map(move => move.id))].sort();

    /** Moves whose condition has a restart handler: the layered hazards (Generation 2 builds Spikes without one). */
    const restarts = (id: string) => typeof (view.dex.conditions.get(view.dex.moves.get(id).sideCondition!) as unknown as { onSideRestart?: unknown }).onSideRestart === 'function';

    /** The moves failsAgainstStanding drops with the full stack of their condition standing. */
    const dropped = () => setters.filter(id => {
      const { battle } = prepared(view, id, WEATHERS.find(w => !play(view, id, false, w) && play(view, id, true, w)) ?? '', 9);
      return failsAgainstStanding(battle.dex, id, battle.sides[0] as unknown as Side, battle.sides[1] as unknown as Side);
    });

    test('the moves it drops are the moves the simulator fails, no more and no fewer', () => {
      expect(dropped()).toEqual(setters.filter(id => simulatorFails(view, id)));
    });

    test('the moves the hand table lacked are dropped where the view has them', () => {
      const lacked = ['craftyshield', 'luckychant', 'matblock'].filter(id => setters.includes(id));
      expect(dropped()).toEqual(expect.arrayContaining(lacked));
      if (view.dex.gen === 2) expect(dropped()).toContain('spikes');
    });

    test('a stack below the cap of a layered hazard is no no-op, and the cap is what the simulator takes', () => {
      for (const id of setters.filter(name => name in LAYER_CAPS && restarts(name))) {
        const weather = WEATHERS.find(w => !play(view, id, false, w) && play(view, id, true, w)) ?? '';
        const full = prepared(view, id, weather, 9);
        const layers = (full.battle.sides[full.holder].sideConditions[view.dex.moves.get(id).sideCondition!] as { layers?: number } | undefined)?.layers;
        expect(layers, `${id} stack`).toBe(LAYER_CAPS[id]);
        const below = prepared(view, id, weather, layers! - 1);
        expect(failsAgainstStanding(below.battle.dex, id, below.battle.sides[0] as unknown as Side, below.battle.sides[1] as unknown as Side), `${id} one layer below the cap`).toBe(false);
      }
    });

    test('the layered hazards are the conditions with a restart handler, and Generation 2 has none', () => {
      expect(setters.filter(restarts)).toEqual(view.dex.gen === 2 ? [] : setters.filter(id => id in LAYER_CAPS));
    });
  });
});
