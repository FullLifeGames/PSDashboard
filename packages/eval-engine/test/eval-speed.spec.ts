import { test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { effectiveSpeed, movesFirst, withEvaluationSpeeds } from '../src/speed';

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

describe('effectiveSpeed asks the simulator (round 60, T95)', () => {
  test('stages apply as the sim floors them', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    const mon = battle.sides[0].active[0]!;
    expect(effectiveSpeed(mon)).toBe(mon.storedStats.spe);
    mon.boosts.spe = 2;
    expect(effectiveSpeed(mon)).toBe(Math.floor(mon.storedStats.spe * 2));
    mon.boosts.spe = -1;
    expect(effectiveSpeed(mon)).toBe(Math.floor(mon.storedStats.spe / 1.5));
  });

  test('Slush Rush doubles in gen 9 snow (the hand list checked \'snow\', the sim writes \'snowscape\')', () => {
    const battle = makeBattle(
      [makeSet('C', 'Cetitan', ['Snowscape', 'Protect'], 100, { ability: 'Slush Rush' })],
      [makeSet('B', 'Blissey', ['Protect'], 100)],
    );
    const cetitan = battle.sides[0].active[0]!;
    const bare = effectiveSpeed(cetitan);
    battle.makeChoices('move snowscape', 'move protect');
    expect(battle.field.weather).toBe('snowscape');
    expect(effectiveSpeed(cetitan)).toBe(bare * 2);
  });

  test('Unburden doubles only once the sim saw the item go', () => {
    const battle = makeBattle(
      [makeSet('A', 'Hawlucha', VANILLA, 50, { ability: 'Unburden', item: 'sitrusberry' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const bird = battle.sides[0].active[0]!;
    const base = effectiveSpeed(bird);
    bird.useItem();
    expect(effectiveSpeed(bird)).toBe(base * 2);
  });

  test('a benched body reads as if on the field, and asking leaves the battle as it was', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('S', 'Talonflame', VANILLA, 50, { item: 'choicescarf' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    const scarfed = battle.sides[0].pokemon.find(p => p.species.id === 'talonflame')!;
    const before = JSON.stringify(battle.toJSON());
    const benched = effectiveSpeed(scarfed);
    expect(JSON.stringify(battle.toJSON())).toBe(before);
    expect(scarfed.isActive).toBe(false);
    battle.makeChoices('switch 2', 'move protect');
    expect(battle.sides[0].active[0]!.species.id).toBe('talonflame');
    expect(effectiveSpeed(scarfed)).toBe(benched);
  });

  test('one static evaluation asks each body once; outside one every call asks', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    const mon = battle.sides[0].active[0]!;
    const getStat = mon.getStat.bind(mon);
    let asked = 0;
    mon.getStat = ((...args: Parameters<typeof getStat>) => { asked++; return getStat(...args); }) as typeof mon.getStat;
    withEvaluationSpeeds(() => [effectiveSpeed(mon), effectiveSpeed(mon)]);
    expect(asked).toBe(1);
    effectiveSpeed(mon);
    effectiveSpeed(mon);
    expect(asked).toBe(3);
  });

  test('paralysis follows the generation (half in gen 9, a quarter in gen 5)', () => {
    const g9 = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    const mon9 = g9.sides[0].active[0]!;
    mon9.setStatus('par');
    expect(Math.abs(effectiveSpeed(mon9) - mon9.storedStats.spe * 0.5)).toBeLessThanOrEqual(1);
    const g5 = makeBattle([makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])], 'gen5customgame');
    const mon5 = g5.sides[0].active[0]!;
    mon5.setStatus('par');
    expect(Math.abs(effectiveSpeed(mon5) - mon5.storedStats.spe * 0.25)).toBeLessThanOrEqual(1);
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
