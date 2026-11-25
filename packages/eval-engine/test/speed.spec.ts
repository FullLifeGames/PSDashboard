import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, Pokemon } from '@pkmn/sim';
import { effectiveSpeed, movesFirst } from '../src/speed';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { loadPositions } from './sim-fast-helpers';

function makeSet(
  name: string,
  species: string,
  moves: string[],
  level = 50,
  extras: { item?: string; ability?: string } = {},
): PokemonSet {
  return {
    name, species, item: extras.item ?? '', ability: extras.ability ?? 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const VANILLA = ['Protect', 'Substitute'];

describe('effectiveSpeed', () => {
  test('base is storedStats.spe, stages multiply', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    const mon = battle.sides[0].active[0]!;
    expect(effectiveSpeed(mon, battle)).toBe(mon.storedStats.spe);
    mon.boosts.spe = 2;
    expect(effectiveSpeed(mon, battle)).toBe(mon.storedStats.spe * 2);
    mon.boosts.spe = -1;
    expect(effectiveSpeed(mon, battle)).toBe(Math.floor(mon.storedStats.spe / 1.5));
  });

  test('paralysis halves in gen 9, quarters in gen 5, Quick Feet overrides', () => {
    const g9 = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    const mon9 = g9.sides[0].active[0]!;
    mon9.setStatus('par');
    expect(effectiveSpeed(mon9, g9)).toBe(mon9.storedStats.spe * 0.5);

    const g5 = makeBattle(
      [makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])],
      'gen5customgame',
    );
    const mon5 = g5.sides[0].active[0]!;
    mon5.setStatus('par');
    expect(effectiveSpeed(mon5, g5)).toBe(mon5.storedStats.spe * 0.25);

    const quick = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA, 50, { ability: 'Quick Feet' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const quickMon = quick.sides[0].active[0]!;
    quickMon.setStatus('par');
    expect(effectiveSpeed(quickMon, quick)).toBe(quickMon.storedStats.spe * 1.5);
  });

  test('tailwind doubles, Scarf 1.5x, Iron Ball 0.5x, Unburden needs a consumed item', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('S', 'Talonflame', VANILLA, 50, { item: 'choicescarf' })],
      [makeSet('B', 'Snorlax', VANILLA, 50, { item: 'ironball' })],
    );
    const plain = battle.sides[0].active[0]!;
    const base = effectiveSpeed(plain, battle);
    battle.sides[0].addSideCondition('tailwind', battle.sides[1].active[0]!);
    expect(effectiveSpeed(plain, battle)).toBe(base * 2);
    battle.sides[0].removeSideCondition('tailwind');

    const scarfed = battle.sides[0].pokemon.find(p => p.species.id === 'talonflame')!;
    expect(effectiveSpeed(scarfed, battle)).toBe(scarfed.storedStats.spe * 1.5);
    const balled = battle.sides[1].active[0]!;
    expect(effectiveSpeed(balled, battle)).toBe(balled.storedStats.spe * 0.5);

    const unburden = makeBattle(
      [makeSet('A', 'Hawlucha', VANILLA, 50, { ability: 'Unburden', item: 'sitrusberry' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const bird = unburden.sides[0].active[0]!;
    expect(effectiveSpeed(bird, unburden)).toBe(bird.storedStats.spe);
    bird.useItem(); // the sim's Unburden volatile, not just an empty slot
    expect(effectiveSpeed(bird, unburden)).toBe(bird.storedStats.spe * 2);
  });

  test('weather abilities double only under their weather', () => {
    const battle = makeBattle(
      [makeSet('A', 'Kingdra', VANILLA, 50, { ability: 'Swift Swim' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const fish = battle.sides[0].active[0]!;
    expect(effectiveSpeed(fish, battle)).toBe(fish.storedStats.spe);
    battle.field.setWeather('raindance', battle.sides[1].active[0]!);
    expect(effectiveSpeed(fish, battle)).toBe(fish.storedStats.spe * 2);
  });

  test('a benched body reads as if on the field, and asking leaves the battle as it was', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('S', 'Talonflame', VANILLA, 50, { item: 'choicescarf' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const scarfed = battle.sides[0].pokemon.find(p => p.species.id === 'talonflame')!;
    const before = JSON.stringify(battle.toJSON());
    const benched = effectiveSpeed(scarfed, battle);
    expect(JSON.stringify(battle.toJSON())).toBe(before);
    expect(scarfed.isActive).toBe(false);
    battle.makeChoices('switch 2', 'move protect');
    expect(battle.sides[0].active[0]!.species.id).toBe('talonflame');
    expect(effectiveSpeed(scarfed, battle)).toBe(benched);
  });
});

describe('movesFirst', () => {
  const NO_PRIO = { priority: false };
  const PRIO = { priority: true };

  test('priority beats raw speed, mirrored from beatsPair', () => {
    const battle = makeBattle(
      [makeSet('Slow', 'Snorlax', VANILLA)], [makeSet('Fast', 'Talonflame', VANILLA)],
    );
    const slow = battle.sides[0].active[0]!;
    const fast = battle.sides[1].active[0]!;
    expect(movesFirst(slow, fast, NO_PRIO, NO_PRIO, battle)).toBe(false);
    expect(movesFirst(slow, fast, PRIO, NO_PRIO, battle)).toBe(true);
    expect(movesFirst(fast, slow, NO_PRIO, PRIO, battle)).toBe(false);
  });

  test('Trick Room inverts the speed comparison, a tie is never first', () => {
    const battle = makeBattle(
      [makeSet('Slow', 'Snorlax', VANILLA)], [makeSet('Fast', 'Talonflame', VANILLA)],
    );
    const slow = battle.sides[0].active[0]!;
    const fast = battle.sides[1].active[0]!;
    battle.field.addPseudoWeather('trickroom', battle.sides[0].active[0]!);
    expect(movesFirst(slow, fast, NO_PRIO, NO_PRIO, battle)).toBe(true);
    expect(movesFirst(fast, slow, NO_PRIO, NO_PRIO, battle)).toBe(false);

    const mirror = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)],
    );
    const a = mirror.sides[0].active[0]!;
    const b = mirror.sides[1].active[0]!;
    expect(movesFirst(a, b, NO_PRIO, NO_PRIO, mirror)).toBe(false);
    expect(movesFirst(b, a, NO_PRIO, NO_PRIO, mirror)).toBe(false);
  });

  test('a Choice Scarf flips a real speed order', () => {
    const bare = makeBattle(
      [makeSet('W', 'Weavile', VANILLA)], [makeSet('T', 'Talonflame', VANILLA)],
    );
    expect(movesFirst(bare.sides[0].active[0]!, bare.sides[1].active[0]!,
      { priority: false }, { priority: false }, bare)).toBe(false);
    const scarfed = makeBattle(
      [makeSet('W', 'Weavile', VANILLA, 50, { item: 'choicescarf' })],
      [makeSet('T', 'Talonflame', VANILLA)],
    );
    expect(movesFirst(scarfed.sides[0].active[0]!, scarfed.sides[1].active[0]!,
      { priority: false }, { priority: false }, scarfed)).toBe(true);
  });
});

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

describe('the speed list against the simulator', () => {
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
