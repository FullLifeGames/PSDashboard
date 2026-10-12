import { describe, expect, test } from 'vitest';
import { Generations, Pokemon } from '@smogon/calc';
import { Dex } from '@pkmn/sim';
import { calcGenerationFor } from '@fulllifegames/replay-core';
import { bodyOf, calcPokemon, type CalcBody } from '../src/calc/body';
import { positionBattle } from '../src/forward-model';
import { checkedRolls, drawTurn, rollSet as set, rootOf } from './calc-roll-oracle';

/**
 * Round 68 (T186, decision 6), the small consequences of the 0.12 diff: 0.12 drops the Gmax and Totem species from the
 * calculator's Gen 8 and Gen 9 (the form map must carry them), gives 110 Gen 9 species a gender (Rivalry reads it), and
 * lets Struggle take Normal items in Gens 2 to 4 (the simulator's Struggle has no type there).
 */
const BASE: Omit<CalcBody, 'species'> = {
  level: 100, ability: '', item: '', nature: 'Hardy', evs: { hp: 4, atk: 252, spe: 252 }, ivs: {},
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, tera: null, onField: false,
};
const stats = (pokemon: Pokemon) => ({ ...pokemon.rawStats, hp: pokemon.maxHP() });

describe('a Gigantamax or Totem form builds through the form map (0.12 dropped them)', () => {
  for (const gen of [8, 9]) {
    test(`gen ${gen}: every Gmax and Totem species of the Dex builds with its base species' stats`, () => {
      const dex = Dex.forGen(gen);
      const calcGen = calcGenerationFor(gen);
      const wrong: string[] = [];
      let checked = 0;
      for (const species of dex.species.all()) {
        if (!species.exists || !(species.forme === 'Gmax' || /Totem/.test(species.forme))) continue;
        const base = dex.species.get(species.baseSpecies);
        if (Object.values(base.baseStats).join() !== Object.values(species.baseStats).join() || base.types.join() !== species.types.join()) continue;
        checked += 1;
        try {
          expect(stats(calcPokemon(calcGen, { ...BASE, species: species.name })), species.name).toEqual(stats(new Pokemon(calcGen, base.name, { level: 100, nature: 'Hardy', evs: BASE.evs })));
        } catch (error) {
          wrong.push(`${species.name}: ${String(error).slice(0, 80)}`);
        }
      }
      expect(checked).toBeGreaterThan(20);
      expect(wrong.slice(0, 10)).toEqual([]);
    });
  }

  test('the Gen 8 Charizard-Gmax of the Dex builds as Charizard', () => {
    const gmax = calcPokemon(Generations.get(8), { ...BASE, species: 'Charizard-Gmax' });
    expect(stats(gmax)).toEqual(stats(new Pokemon(Generations.get(8), 'Charizard', { level: 100, nature: 'Hardy', evs: BASE.evs })));
  });
});

describe('the body passes the battle\'s gender, and a female-only Rivalry attacker lands on its kill table', () => {
  const nidoqueen = () => set('Nidoqueen', ['Earth Power'], { ability: 'Rivalry', gender: '' });
  const rival = () => set('Snorlax', ['Splash'], { ability: 'Battle Armor', gender: 'M' });

  test('singles: bodyOf reads F from the simulator, and Earth Power into a male Snorlax is on the table', () => {
    const root = rootOf('gen9customgame', [nidoqueen()], [rival()]);
    const battle = positionBattle(root);
    expect(bodyOf(battle, battle.sides[0].active[0]).gender).toBe('F');
    const hits = checkedRolls(drawTurn(root, 'move earthpower', 'move splash'));
    expect(hits.length).toBe(1);
    expect(hits[0].holds).toBe(true);
  });

  test('doubles: the same hit with a partner each side is on the table', () => {
    const root = rootOf('gen9doublescustomgame', [nidoqueen(), set('Corviknight', ['Roost'])], [rival(), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })]);
    const battle = positionBattle(root);
    expect(bodyOf(battle, battle.sides[0].active[0]).gender).toBe('F');
    const hits = checkedRolls(drawTurn(root, 'move earthpower 1, move roost', 'move splash, move softboiled'));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(({ holds }) => holds)).toBe(true);
  });
});

describe('Struggle in the Gens 2 to 4 takes no item boost, as the simulator plays it', () => {
  for (const format of ['gen3customgame'] as const) {
    test(`${format}: a Silk Scarf attacker's Struggle lies on the kill table`, () => {
      const root = rootOf(format, [set('Snorlax', ['Splash'], { item: 'Silk Scarf', ability: '' })], [set('Blissey', ['Splash'], { ability: '' })],
        battle => { for (const slot of battle.sides[0].active[0].moveSlots) slot.pp = 0; });
      const hits = checkedRolls(drawTurn(root, 'move 1', 'move splash'));
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(({ holds }) => holds)).toBe(true);
    });
  }
});
