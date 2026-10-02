import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { Pokemon, PokemonSet } from '@pkmn/sim';
import { effectiveSpeed } from '../src/speed';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { loadPositions } from './sim-fast-helpers';

/**
 * Round 60 (T95) prover: the static's speed list against the simulator's
 * getStat('spe'). Asking the simulator directly cost the static 15 to 22 %
 * (time gate 5 %), so the list stays and this test keeps it honest: one
 * scene per rule, and every body of the committed bank positions. A benched
 * body is asked as if on the field (the sim finds no handlers for an
 * inactive Pokémon and ignores its item and ability from gen 5 on).
 */

function simSpeed(pokemon: Pokemon): number {
  if (pokemon.isActive) return pokemon.getStat('spe');
  pokemon.isActive = true;
  try {
    return pokemon.getStat('spe');
  } finally {
    pokemon.isActive = false;
  }
}

function set(species: string, extras: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves: ['Protect', 'Splash'], nature: 'Hardy', gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, ...extras,
  };
}

function battleOf(p1: PokemonSet[], p2: PokemonSet[], format = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(format), seed: '1,2,3,4',
    p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1', 'team 1');
  return battle;
}

function expectFits(pokemon: Pokemon, battle: Battle): void {
  expect(Math.abs(effectiveSpeed(pokemon, battle) - simSpeed(pokemon))).toBeLessThanOrEqual(1);
}

const FAST = { evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 }, nature: 'Timid' };

describe('the speed list against the simulator (round 60, T95 prover)', () => {
  test('stages floor like the sim, also under Tailwind', () => {
    const battle = battleOf([set('Kingambit', { moves: ['Tailwind', 'Protect'] })], [set('Blissey')]);
    battle.makeChoices('move tailwind', 'move protect');
    const gambit = battle.sides[0].active[0]!;
    gambit.boosts.spe = -1;
    expectFits(gambit, battle);
    gambit.boosts.spe = 2;
    expectFits(gambit, battle);
  });

  test('paralysis per generation, Quick Feet, Scarf and Iron Ball', () => {
    for (const format of ['gen9customgame', 'gen5customgame']) {
      const battle = battleOf([set('Snorlax'), set('Ursaring', { ability: 'Quick Feet' })], [set('Blissey')], format);
      const lax = battle.sides[0].active[0]!;
      lax.setStatus('par');
      expectFits(lax, battle);
    }
    const quick = battleOf([set('Ursaring', { ability: 'Quick Feet' })], [set('Blissey')]);
    quick.sides[0].active[0]!.setStatus('par');
    expectFits(quick.sides[0].active[0]!, quick);
    const items = battleOf([set('Talonflame', { item: 'Choice Scarf' }), set('Snorlax', { item: 'Iron Ball' })], [set('Blissey')]);
    for (const pokemon of items.sides[0].pokemon) expectFits(pokemon, items);
  });

  test('weather and terrain abilities, Slush Rush in gen 9 snow and gen 8 hail', () => {
    const scenes: [PokemonSet, PokemonSet, string][] = [
      [set('Kingdra', { ability: 'Swift Swim' }), set('Pelipper', { ability: 'Drizzle' }), 'gen9customgame'],
      [set('Venusaur', { ability: 'Chlorophyll' }), set('Torkoal', { ability: 'Drought' }), 'gen9customgame'],
      [set('Excadrill', { ability: 'Sand Rush' }), set('Tyranitar', { ability: 'Sand Stream' }), 'gen9customgame'],
      [set('Cetitan', { ability: 'Slush Rush' }), set('Abomasnow', { ability: 'Snow Warning' }), 'gen9customgame'],
      [set('Arctozolt', { ability: 'Slush Rush' }), set('Abomasnow', { ability: 'Snow Warning' }), 'gen8customgame'],
      [set('Raichu-Alola', { ability: 'Surge Surfer' }), set('Pincurchin', { ability: 'Electric Surge' }), 'gen9customgame'],
    ];
    for (const [runner, setter, format] of scenes) {
      const battle = battleOf([runner], [setter], format);
      expect(battle.field.weather || battle.field.terrain).not.toBe('');
      expectFits(battle.sides[0].active[0]!, battle);
    }
  });

  test('Unburden only while the sim\'s volatile holds, and not under Neutralizing Gas', () => {
    const battle = battleOf(
      [set('Hawlucha', { ability: 'Unburden', item: 'Sitrus Berry' }), set('Snorlax')],
      [set('Blissey'), set('Weezing-Galar', { ability: 'Neutralizing Gas' })],
    );
    const bird = battle.sides[0].pokemon[0];
    bird.useItem();
    expectFits(bird, battle);
    battle.makeChoices('switch 2', 'move protect');
    battle.makeChoices('switch 2', 'move protect');
    expect(bird.isActive).toBe(true);
    expectFits(bird, battle);
    const gassed = battleOf(
      [set('Hawlucha', { ability: 'Unburden', item: 'Sitrus Berry' })],
      [set('Blissey'), set('Weezing-Galar', { ability: 'Neutralizing Gas' })],
    );
    gassed.sides[0].active[0]!.useItem();
    gassed.makeChoices('move protect', 'switch 2');
    expectFits(gassed.sides[0].active[0]!, gassed);
  });

  test('Protosynthesis and Quark Drive boost speed when it is the best stat', () => {
    const battle = battleOf(
      [set('Flutter Mane', { ability: 'Protosynthesis', item: 'Booster Energy', ...FAST }), set('Iron Bundle', { ability: 'Quark Drive', item: 'Booster Energy', ...FAST })],
      [set('Blissey')],
    );
    expectFits(battle.sides[0].active[0]!, battle);
    battle.makeChoices('switch 2', 'move protect');
    expectFits(battle.sides[0].active[0]!, battle);
  });

  test('every body of the committed bank positions', () => {
    let checked = 0;
    for (const fixture of loadPositions()) {
      const battle = positionBattle(createRootPosition(fixture.serialized));
      for (const side of battle.sides) {
        for (const pokemon of side.pokemon) {
          if (pokemon.fainted) continue;
          expect({ id: fixture.id, species: pokemon.species.name, diff: Math.abs(effectiveSpeed(pokemon, battle) - simSpeed(pokemon)) > 1 })
            .toEqual({ id: fixture.id, species: pokemon.species.name, diff: false });
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
