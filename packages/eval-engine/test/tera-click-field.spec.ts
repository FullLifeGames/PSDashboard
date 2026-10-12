import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle } from '../src/branch/state';
import { bodyOf } from '../src/calc/body';
import { teraClicked } from '../src/calc/tera-click';
import { calcSingleDamageRange } from '../src/damage-calc';
import { createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { boundaryEvent, critRate } from '../src/ko-odds';
import { pairKoOdds } from '../src/pair/odds';
import { drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';
import { simDamages, killing, type SimDamages } from './sim-rolls';

/**
 * Round 69, lane D (T152 point 1): Terapagos-Terastal's click makes
 * Terapagos-Stellar, whose Teraform Zero clears the weather and the terrain
 * (the simulator's onAfterTerastallization). The calc clears them only for a
 * holder whose abilityOn is set, so the body a click makes carries that flag
 * when the field it clicks into has something to clear, and the paths that
 * read the battle's weather (the accuracy of Thunder in rain) read the
 * cleared field too. The oracle is the simulator: a real battle with the
 * field, the click, the field read after; the damage of its own draws.
 */

const terapagos = (): PokemonSet => set('Terapagos', ['Hydro Pump', 'Thunder', 'Splash'], { ability: 'Tera Shift', teraType: 'Stellar' });
const blastoise = (): PokemonSet => set('Blastoise', ['Hydro Pump', 'Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 252, spd: 0, spe: 0 } });
const wall = (species = 'Blissey'): PokemonSet => set(species, ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 252, spe: 0 } });

type Field = { weather?: string; terrain?: string };
const setField = (field: Field) => (battle: Battle) => {
  if (field.weather) battle.field.setWeather(field.weather, 'debug');
  if (field.terrain) battle.field.setTerrain(field.terrain, 'debug');
};

const FIELDS: [string, Field][] = [
  ['rain', { weather: 'raindance' }],
  ['sand', { weather: 'sandstorm' }],
  ['snow', { weather: 'snowscape' }],
  ['Electric Terrain', { terrain: 'electricterrain' }],
];

/** The first p1 active of a battle, read as a body that clicks its Tera type. */
function armed(battle: Battle) {
  const mon = battle.sides[0].active[0];
  return { ...bodyOf(battle, mon), tera: mon.teraType };
}

/** Did the simulator's own click clear a field that stood? */
function simCleared(root: SimPosition): boolean {
  const twin = positionBattle(createRootPosition(root.serialized));
  const had = !!(twin.field.weather || twin.field.terrain);
  twin.actions.terastallize(twin.sides[0].active[0]!);
  return had && !twin.field.weather && !twin.field.terrain;
}

const fieldOf = (battle: Battle): Field => ({ weather: battle.field.weather, terrain: battle.field.terrain });

describe('the click that clears the field (T152 point 1)', () => {
  test.each(FIELDS)('Terapagos clicking into %s carries the clearing flag exactly when the simulator clears it', (_name, field) => {
    const root = rootOf('gen9customgame', [terapagos()], [wall()], setField(field));
    const battle = positionBattle(root);
    expect(simCleared(root)).toBe(true);
    expect(teraClicked(9, armed(battle), fieldOf(battle)).abilityOn).toBe(true);
  });

  test('no field to clear, a click that keeps the forme and a Terapagos-Stellar that clicked before carry no flag', () => {
    const plain = positionBattle(rootOf('gen9customgame', [terapagos()], [wall()]));
    expect(simCleared(rootOf('gen9customgame', [terapagos()], [wall()]))).toBe(false);
    expect(teraClicked(9, armed(plain), fieldOf(plain)).abilityOn).toBeUndefined();

    const rainy = setField({ weather: 'raindance' });
    const chomp = positionBattle(rootOf('gen9customgame', [set('Garchomp', ['Earthquake'], { teraType: 'Steel' })], [wall()], rainy));
    expect(simCleared(rootOf('gen9customgame', [set('Garchomp', ['Earthquake'], { teraType: 'Steel' })], [wall()], rainy))).toBe(false);
    expect(teraClicked(9, armed(chomp), fieldOf(chomp)).abilityOn).toBeUndefined();

    // After the click the body is Terapagos-Stellar: its next use of the body clicks nothing and clears nothing.
    const clicked = teraClicked(9, armed(positionBattle(rootOf('gen9customgame', [terapagos()], [wall()], rainy))), { weather: 'raindance' });
    expect(clicked.species).toBe('Terapagos-Stellar');
    expect(teraClicked(9, { ...clicked, abilityOn: undefined }, { weather: 'raindance' }).abilityOn).toBeUndefined();
  });
});

/** The foe's HP at which about half of the sim's normal rolls kill, with the root built at that HP. */
function halfKilling(make: (hp: number) => SimPosition, damages: SimDamages): { hp: number; root: SimPosition } {
  const hp = [...damages.normal].sort((a, b) => a - b)[8];
  expect(killing(damages.normal, hp)).toBeGreaterThan(0);
  expect(killing(damages.normal, hp)).toBeLessThan(16);
  return { hp, root: make(hp) };
}

describe('singles: the odds of a click into rain read the cleared field', () => {
  const rain = setField({ weather: 'raindance' });
  const full = () => rootOf('gen9customgame', [terapagos()], [wall()], rain);

  test('Hydro Pump after the click: the kill rolls are the simulator\'s, without the rain bonus', () => {
    const damages = simDamages(full(), 'move hydropump terastallize', 'move splash', { script: 'p1a:hydropump>p2a', target: { side: 1, slot: 0 } });
    const { hp, root } = halfKilling(h => rootOf('gen9customgame', [terapagos()], [wall()], battle => { rain(battle); battle.sides[1].active[0].sethp(h); }), damages);
    const battle = positionBattle(root);
    const event = boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'hydropump', { attacker: true })!;
    expect(event.normalKillRolls).toBe(killing(damages.normal, hp));
    expect(event.critKillRolls).toBe(killing(damages.crit, hp));
    const crit = critRate(9, 1)!;
    expect(event.killFraction).toBeCloseTo((1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16, 10);
    // Without the click the rain is still there, and the odds differ.
    expect(boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'hydropump')!.normalKillRolls).not.toBe(event.normalKillRolls);
  });

  test('Thunder after the click hits at its own 70 %, the rain gone, as the simulator rolls it', () => {
    const root = full();
    const drawn = drawTurn(root, 'move thunder terastallize', 'move splash');
    const accuracy = drawn.records.find(record => record.kind === 'accuracy');
    expect(accuracy && accuracy.kind === 'accuracy' && accuracy.numerator).toBe(70);
    const battle = positionBattle(root);
    expect(boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'thunder', { attacker: true })!.accuracy).toBe(0.7);
    // Not clicking: the rain makes Thunder sure.
    expect(boundaryEvent(battle, battle.sides[0].active[0], battle.sides[1].active[0], 'thunder')!.accuracy).toBe(1);
  });

  test('the foe\'s Hydro Pump into the clicking Terapagos reads the cleared rain too', () => {
    const rootAt = (hp?: number) => rootOf('gen9customgame', [terapagos()], [blastoise()], battle => { rain(battle); if (hp) battle.sides[0].active[0].sethp(hp); });
    const damages = simDamages(rootAt(), 'move splash terastallize', 'move hydropump', { script: 'p2a:hydropump>p1a', target: { side: 0, slot: 0 } });
    // The click raises the HP the hit meets; ask the simulator's twin for it.
    const clickedHp = (hp: number) => {
      const twin = positionBattle(createRootPosition(rootAt(hp).serialized));
      twin.actions.terastallize(twin.sides[0].active[0]!);
      return twin.sides[0].active[0]!.hp;
    };
    const target = [...damages.normal].sort((a, b) => a - b)[8];
    let hp = 1;
    while (clickedHp(hp) < target && hp < 600) hp += 1;
    const root = rootAt(hp);
    const battle = positionBattle(root);
    const event = boundaryEvent(battle, battle.sides[1].active[0], battle.sides[0].active[0], 'hydropump', { defender: true })!;
    expect(event.normalKillRolls).toBe(killing(damages.normal, clickedHp(hp)));
    expect(event.normalKillRolls).toBeGreaterThan(0);
    expect(event.normalKillRolls).toBeLessThan(16);
  });
});

describe('doubles: the headline of a click option and the preview read the cleared field', () => {
  const rain = setField({ weather: 'raindance' });
  const choice = 'move hydropump 1 terastallize, move splash';
  const doubles = (hp?: number) => rootOf('gen9doublescustomgame', [terapagos(), wall('Snorlax')], [wall(), wall('Chansey')],
    battle => { rain(battle); if (hp) battle.sides[1].active[0].sethp(hp); });

  test('pairKoOdds of the Hydro Pump click equals the simulator\'s rolls after the click', () => {
    const damages = simDamages(doubles(), choice, 'move splash, move splash', { script: 'p1a:hydropump>p2a', target: { side: 1, slot: 0 } });
    const { hp, root } = halfKilling(doubles, damages);
    const [odds] = pairKoOdds(positionBattle(root), 'p1', [choice]);
    const crit = critRate(9, 1)!;
    expect(odds).not.toBeNull();
    expect(odds!.killFraction).toBeCloseTo((1 - crit) * killing(damages.normal, hp) / 16 + crit * killing(damages.crit, hp) / 16, 10);
  });

  test('the preview of the armed Terapagos in rain equals the simulator\'s range after the click', () => {
    const root = doubles();
    const battle = positionBattle(root);
    const state = createBranchStateFromBattle(battle, [], {});
    const [attacker, defender] = [state.p1ActiveSlots[0]!, state.p2ActiveSlots[0]!];
    const option = { name: 'Hydro Pump', activeSlot: 0, slot: 1, pp: 8, maxpp: 8, disabled: false, type: 'Water', targetType: 'normal', requiresTarget: true, targetOptions: [] };
    const damages = simDamages(root, choice, 'move splash, move splash', { script: 'p1a:hydropump>p2a', target: { side: 1, slot: 0 } });
    const result = calcSingleDamageRange({ ...attacker, teraType: 'Stellar' }, defender, option as never, { gen: 9, gameType: 'Doubles', weather: 'raindance' });
    const pct = (damage: number) => Math.round(damage / defender.maxhp * 1000) / 10;
    expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal)), pct(Math.max(...damages.normal))]);
  });
});
