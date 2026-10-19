import { describe, expect, test } from 'vitest';
import { NOOP_FIELD_MOVES } from '../src/search/options';
import { ALL_VIEWS, battleIn, mon, oracleTagAbove, type SimView } from './sim-views';

/**
 * Round 72 (T235), plan row 15: `NOOP_FIELD_MOVES` in search/options.ts drops a field move from the option list while its
 * condition already stands ("clicking it is a pass with a real-looking label", GPL T25). The table is keyed by move id and
 * holds the standing-condition test per move, with the layer caps of Spikes (3) and Toxic Spikes (2). The Dex says which moves
 * set a side condition (`sideCondition`), not which of them fail against it, so the table stays by hand and this spec holds it
 * to the simulator. For every move that sets a side condition, in every view the corpus plays, it lays the condition on the
 * side the move acts on (as many layers as the simulator takes), plays the move once and keeps the moves that print a failure
 * where the same turn without the standing condition does not (under the weather a move may need: none, Snow, Hail). Then:
 *  - every table entry that exists in the view is a move the simulator fails, and its test says yes on the full stack and no
 *    one layer lower (Spikes, Toxic Spikes);
 *  - FINDING W4: the moves the simulator fails that the table lacks are the list below, by id (five ids in every view that has
 *    them); FINDING W4b: in Generation 2 Spikes stacks one layer, the table's cap is three. The table stays as it is in
 *    this step; each name is a field move the search may still offer into a standing condition.
 */

const SPEC = 'packages/eval-engine/test/noop-field-moves-oracle.spec.ts';

/** Side-condition moves the simulator fails against their standing condition that the table lacks (finding W4). */
const NOT_IN_TABLE = ['craftyshield', 'luckychant', 'matblock', 'quickguard', 'wideguard'];

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

describe('NOOP_FIELD_MOVES is held to the simulator (round 72)', () => {
  test('the table carries its oracle tag', () => {
    expect(oracleTagAbove('packages/eval-engine/src/search/options.ts', 'const NOOP_FIELD_MOVES', SPEC)).toBe(true);
  });

  describe.each(ALL_VIEWS)('$name', view => {
    const setters = [...new Set(view.dex.moves.all().filter(move => isReal(view, move.id) && move.sideCondition).map(move => move.id))].sort();

    test('the table entries are moves the simulator fails, and the others are the named ones', () => {
      const fails = setters.filter(id => simulatorFails(view, id));
      const tabled = Object.keys(NOOP_FIELD_MOVES).filter(id => setters.includes(id)); // Generation 1 keeps its screens and Mist in volatiles
      expect(tabled.filter(id => !fails.includes(id))).toEqual([]);
      expect(fails.filter(id => !(id in NOOP_FIELD_MOVES))).toEqual(NOT_IN_TABLE.filter(id => setters.includes(id) && fails.includes(id)));
    });

    test('each test says yes on the full stack of its condition and no below the cap', () => {
      for (const id of Object.keys(NOOP_FIELD_MOVES).filter(name => setters.includes(name))) {
        const weather = WEATHERS.find(w => !play(view, id, false, w) && play(view, id, true, w)) ?? '';
        const sidesOf = (layers: number) => {
          const { battle, holder } = prepared(view, id, weather, layers);
          return { sides: [battle.sides[0], battle.sides[1]] as unknown as Parameters<(typeof NOOP_FIELD_MOVES)[string]>, holder, battle };
        };
        const full = sidesOf(9);
        // FINDING W4b: Generation 2 takes one layer of Spikes (the table waits for three), so the table never drops it there.
        const oneLayerCap = view.name === 'Gen 2' && id === 'spikes';
        expect(NOOP_FIELD_MOVES[id](...full.sides), `${id} on a full stack`).toBe(!oneLayerCap);
        const layers = (full.battle.sides[full.holder].sideConditions[view.dex.moves.get(id).sideCondition!] as { layers?: number } | undefined)?.layers;
        if (layers && layers > 1 && !oneLayerCap) expect(NOOP_FIELD_MOVES[id](...sidesOf(layers - 1).sides), `${id} one layer below the cap`).toBe(false);
      }
    });
  });
});
