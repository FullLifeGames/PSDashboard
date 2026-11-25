import { describe, expect, test } from 'vitest';
import { LAYER_CAPS, failsAgainstStanding } from '../src/search/options';
import type { positionBattle } from '../src/forward-model';
import { ALL_VIEWS, battleIn, mon, type SimView } from './sim-views';

// Side.addSideCondition fails a standing condition without a restart handler (`onSideRestart`);
// Spikes and Toxic Spikes have one and refuse a layer past their cap, held here as `LAYER_CAPS`.

type Side = ReturnType<typeof positionBattle>['sides'][number];

const isReal = (view: SimView, id: string): boolean => {
  const move = view.dex.moves.get(id);
  return move.exists && move.isNonstandard !== 'Future' && !move.isMax && !move.isZ;
};

type Weather = '' | 'snow' | 'hail';
const WEATHERS: Weather[] = ['', 'snow', 'hail'];

function prepared(view: SimView, moveId: string, weather: Weather, layers: number) {
  const move = view.dex.moves.get(moveId);
  const battle = battleIn(view, [mon('Blissey', [moveId, 'splash']), mon('Blissey', ['splash'])], [mon('Snorlax', ['splash']), mon('Snorlax', ['splash'])]);
  const user = battle.sides[0].active[0];
  if (weather) battle.field.setWeather(weather, user);
  const holder: 0 | 1 = move.target === 'foeSide' ? 1 : 0;
  for (let count = 0; count < layers; count++) if (!battle.sides[holder].addSideCondition(move.sideCondition!, user)) break;
  return { battle, holder };
}

function play(view: SimView, moveId: string, standing: boolean, weather: Weather): boolean {
  const { battle } = prepared(view, moveId, weather, standing ? 9 : 0);
  const mark = battle.log.length;
  battle.choose('p1', view.doubles ? 'move 1, move 1' : 'move 1');
  battle.choose('p2', view.doubles ? 'move 1, move 1' : 'move 1');
  const turn = battle.log.slice(mark);
  const moved = turn.findIndex(line => line.startsWith('|move|p1a'));
  if (moved < 0) return false;
  const next = turn.findIndex((line, index) => index > moved && line.startsWith('|move|'));
  return turn.slice(moved + 1, next < 0 ? undefined : next).some(line => line.startsWith('|-fail|'));
}

function simulatorFails(view: SimView, moveId: string): boolean {
  return WEATHERS.some(weather => {
    return !play(view, moveId, false, weather) && play(view, moveId, true, weather);
  });
}

describe('field moves against a standing condition are read from the Dex and held to the simulator', () => {
  describe.each(ALL_VIEWS)('$name', view => {
    const setters = [...new Set(view.dex.moves.all().filter(move => isReal(view, move.id) && move.sideCondition).map(move => move.id))].sort();

    const restarts = (id: string) => typeof (view.dex.conditions.get(view.dex.moves.get(id).sideCondition!) as unknown as { onSideRestart?: unknown }).onSideRestart === 'function';

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
