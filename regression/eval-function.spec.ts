import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition } from '../src/lib/eval/eval-function';

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

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9customgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  // Custom Game opens at team preview — commit the default order so the
  // leads are actually on the field.
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const VANILLA = ['Protect', 'Substitute'];

test.describe('evaluatePosition', () => {
  test('a mirror position evaluates to zero', () => {
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', VANILLA)],
      [makeSet('Snorlax', 'Snorlax', VANILLA)],
    );
    expect(evaluatePosition(battle)).toBe(0);
  });

  test('more HP and more bodies are better', () => {
    const battle = makeBattle(
      [makeSet('Snorlax', 'Snorlax', VANILLA), makeSet('Chansey', 'Chansey', VANILLA)],
      [makeSet('Snorlax', 'Snorlax', VANILLA), makeSet('Chansey', 'Chansey', VANILLA)],
    );
    const p2Active = battle.sides[1].active[0]!;
    p2Active.hp = Math.floor(p2Active.maxhp / 2);
    const halfHp = evaluatePosition(battle);
    expect(halfHp).toBeGreaterThan(0);

    const p2Bench = battle.sides[1].pokemon[1];
    p2Bench.hp = 0;
    p2Bench.fainted = true;
    expect(evaluatePosition(battle)).toBeGreaterThan(halfHp);
  });

  test('status hurts, toxic more than burn', () => {
    const brn = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    brn.sides[1].active[0]!.setStatus('brn');
    const brnScore = evaluatePosition(brn);
    expect(brnScore).toBeGreaterThan(0);

    const tox = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    tox.sides[1].active[0]!.setStatus('tox');
    expect(evaluatePosition(tox)).toBeGreaterThan(brnScore);
  });

  test('boosts on the active help', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    battle.sides[0].active[0]!.boostBy({ atk: 2 });
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('hazards hurt the side they lie on', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    battle.sides[1].addSideCondition('stealthrock', battle.sides[0].active[0]!);
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('tailwind helps its side, trick room helps the slower side', () => {
    const tailwind = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    tailwind.sides[0].addSideCondition('tailwind', tailwind.sides[0].active[0]!);
    expect(evaluatePosition(tailwind)).toBeGreaterThan(0);

    // p1 Snorlax (slow) vs p2 Dragapult (fast): trick room favors p1.
    const tr = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Dragapult', VANILLA)]);
    const before = evaluatePosition(tr);
    tr.field.addPseudoWeather('trickroom', tr.sides[0].active[0]!);
    expect(evaluatePosition(tr)).toBeGreaterThan(before);
  });

  test('an ended battle scores ±1', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    battle.win(battle.sides[0]);
    expect(evaluatePosition(battle)).toBe(1);
  });

  test('deterministic: same battle scores identically twice', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Chansey', VANILLA)]);
    expect(evaluatePosition(battle)).toBe(evaluatePosition(battle));
  });

  test('type dominance shows before any damage is dealt', () => {
    // Flamethrower hits Venusaur for 2x with STAB; Vine Whip is resisted to
    // 0.25x by Charizard — the fire side dominates every matchup at full HP.
    const battle = makeBattle(
      [makeSet('A', 'Charizard', ['Flamethrower']), makeSet('B', 'Charizard', ['Flamethrower'])],
      [makeSet('C', 'Venusaur', ['Vine Whip']), makeSet('D', 'Venusaur', ['Vine Whip'])],
    );
    expect(evaluatePosition(battle)).toBeGreaterThan(0.1);
  });

  test('damage taken lowers a matchup advantage without flipping it', () => {
    const full = makeBattle(
      [makeSet('A', 'Charizard', ['Flamethrower']), makeSet('B', 'Charizard', ['Flamethrower'])],
      [makeSet('C', 'Venusaur', ['Vine Whip']), makeSet('D', 'Venusaur', ['Vine Whip'])],
    );
    const fullScore = evaluatePosition(full);
    const hurt = makeBattle(
      [makeSet('A', 'Charizard', ['Flamethrower']), makeSet('B', 'Charizard', ['Flamethrower'])],
      [makeSet('C', 'Venusaur', ['Vine Whip']), makeSet('D', 'Venusaur', ['Vine Whip'])],
    );
    const chip = hurt.sides[0].pokemon[1];
    chip.hp = Math.floor(chip.maxhp / 2);
    const hurtScore = evaluatePosition(hurt);
    expect(hurtScore).toBeLessThan(fullScore);
    expect(hurtScore).toBeGreaterThan(0);
  });

  test('a strictly better twin wins the matchup', () => {
    const battle = makeBattle(
      [makeSet('A', 'Pikachu', ['Tackle'], 100)],
      [makeSet('B', 'Pikachu', ['Tackle'], 95)],
    );
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('a Choice Band flips an otherwise dead-even race', () => {
    // A Tackle mirror is a 7-turn race both ways — perfectly even. The band
    // turns one side's 7HKO into a 5HKO.
    const plain = makeBattle(
      [makeSet('A', 'Snorlax', ['Tackle'])],
      [makeSet('B', 'Snorlax', ['Tackle'])],
    );
    expect(evaluatePosition(plain)).toBe(0);
    const banded = makeBattle(
      [makeSet('A', 'Snorlax', ['Tackle'], 50, { item: 'Choice Band' })],
      [makeSet('B', 'Snorlax', ['Tackle'])],
    );
    expect(evaluatePosition(banded)).toBeGreaterThan(0);
  });

  test('Eviolite bulk flips a dead-even race toward the NFE holder', () => {
    // A Chansey Swift mirror is perfectly even; the Eviolite's 1.5x special
    // bulk on one side stretches the race against it beyond the other's.
    const plain = makeBattle(
      [makeSet('A', 'Chansey', ['Swift'])],
      [makeSet('B', 'Chansey', ['Swift'])],
    );
    expect(evaluatePosition(plain)).toBe(0);
    const eviolite = makeBattle(
      [makeSet('A', 'Chansey', ['Swift'])],
      [makeSet('B', 'Chansey', ['Swift'], 50, { item: 'Eviolite' })],
    );
    expect(evaluatePosition(eviolite)).toBeLessThan(0);
  });

  test('an immunity ability blanks the attacking type', () => {
    // Earthquake is Golem's only move; Levitate makes the matchup threatless.
    const plain = makeBattle(
      [makeSet('A', 'Golem', ['Earthquake'])],
      [makeSet('B', 'Weezing', ['Sludge Bomb'], 50, { ability: 'Neutralizing Gas' })],
    );
    const levitating = makeBattle(
      [makeSet('A', 'Golem', ['Earthquake'])],
      [makeSet('B', 'Weezing', ['Sludge Bomb'], 50, { ability: 'Levitate' })],
    );
    expect(evaluatePosition(levitating)).toBeLessThan(evaluatePosition(plain));
  });

  test('priority breaks an otherwise even race', () => {
    // Same species, same base power (40), same speed — Quick Attack's
    // priority is the only difference.
    const battle = makeBattle(
      [makeSet('A', 'Pikachu', ['Quick Attack'])],
      [makeSet('B', 'Pikachu', ['Tackle'])],
    );
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('a healer walls an attacker that cannot 2HKO', () => {
    // The weak attacker 5HKOs at best; Soft-Boiled outheals that forever.
    const attacker = makeSet('A', 'Pikachu', ['Tackle'], 30);
    const noHeal = makeBattle([attacker], [makeSet('B', 'Blissey', ['Protect'], 100)]);
    const healer = makeBattle([attacker], [makeSet('B', 'Blissey', ['Soft-Boiled'], 100)]);
    expect(evaluatePosition(healer)).toBeLessThan(evaluatePosition(noHeal));
  });

  test('a shared matchup cache never changes scores, even as HP changes', () => {
    const battle = makeBattle(
      [makeSet('A', 'Charizard', ['Flamethrower']), makeSet('B', 'Charizard', ['Flamethrower'])],
      [makeSet('C', 'Venusaur', ['Vine Whip']), makeSet('D', 'Venusaur', ['Vine Whip'])],
    );
    const cache = createMatchupCache();
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));

    // The memo must only cover the HP-independent part: after damage, the
    // cached path still tracks the fresh computation exactly.
    const active = battle.sides[1].active[0]!;
    active.hp = Math.floor(active.maxhp / 2);
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));
  });

  test('a one-mon deficit reads clearly through the score scaling', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map(name => makeSet(name, 'Snorlax', VANILLA));
    const six = ['F', 'G', 'H', 'I', 'J', 'K'].map(name => makeSet(name, 'Snorlax', VANILLA));
    const oneDown = evaluatePosition(makeBattle(five, six));
    expect(oneDown).toBeLessThanOrEqual(-0.25);
    expect(oneDown).toBeGreaterThanOrEqual(-0.6);

    // A two-mon deficit is strictly worse.
    const four = five.slice(0, 4);
    expect(evaluatePosition(makeBattle(four, six))).toBeLessThan(oneDown);
  });
});
