import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { effectiveSpeed, movesFirst } from '../src/lib/eval/speed';

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

test.describe('effectiveSpeed', () => {
  test('base is storedStats.spe, stages multiply', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    const mon = battle.sides[0].active[0]!;
    expect(effectiveSpeed(mon, battle)).toBe(mon.storedStats.spe);
    mon.boosts.spe = 2;
    expect(effectiveSpeed(mon, battle)).toBe(mon.storedStats.spe * 2);
    mon.boosts.spe = -1;
    expect(effectiveSpeed(mon, battle)).toBeCloseTo(mon.storedStats.spe * (2 / 3), 8);
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
    expect(effectiveSpeed(bird, unburden)).toBe(bird.storedStats.spe); // Item noch da
    bird.item = '';
    expect(effectiveSpeed(bird, unburden)).toBe(bird.storedStats.spe * 2); // verbraucht
  });

  test('weather abilities double only under their weather', () => {
    const battle = makeBattle(
      [makeSet('A', 'Kingdra', VANILLA, 50, { ability: 'Swift Swim' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const fish = battle.sides[0].active[0]!;
    expect(effectiveSpeed(fish, battle)).toBe(fish.storedStats.spe); // kein Regen
    battle.field.setWeather('raindance', battle.sides[1].active[0]!);
    expect(effectiveSpeed(fish, battle)).toBe(fish.storedStats.spe * 2);
  });
});

test.describe('movesFirst', () => {
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
    // Weavile (base 125) vs Talonflame (base 126): bare, Talonflame is faster;
    // the Scarf turns it around.
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
