import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition, EVAL_WEIGHTS, hazardCost, matchupTerms } from '../src/lib/eval/eval-function';

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

  test('an attack boost flips the matchup term, not just the flat bonus', () => {
    // A Tackle mirror is a dead-even 7-turn race. +2 Atk halves the race one
    // way: the flat boost weight alone would be worth ~0.10 here — winning
    // every pair through the boosted matchup term is worth far more.
    const battle = makeBattle([makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])]);
    expect(evaluatePosition(battle)).toBe(0);
    battle.sides[0].active[0]!.boostBy({ atk: 2 });
    expect(evaluatePosition(battle)).toBeGreaterThan(0.3);
  });

  test('a defense boost blunts a physical race', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])]);
    battle.sides[1].active[0]!.boostBy({ def: 2 });
    expect(evaluatePosition(battle)).toBeLessThan(-0.3);
  });

  test('a speed boost breaks an even race in the matchup term', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])]);
    battle.sides[0].active[0]!.boostBy({ spe: 1 });
    expect(evaluatePosition(battle)).toBeGreaterThan(0.3);
  });

  test('boost stages follow the diminishing schedule with an offense/defense split', () => {
    // +2 is worth exactly twice +1; the tail flattens hard (+6 ≪ 3×(+2));
    // defensive stages read at half the offensive weight.
    expect(EVAL_WEIGHTS.boostSchedule[2]).toBe(2 * EVAL_WEIGHTS.boostSchedule[1]);
    expect(EVAL_WEIGHTS.boostSchedule[6]).toBeLessThan(2 * EVAL_WEIGHTS.boostSchedule[2]);
    expect(EVAL_WEIGHTS.boostStage.defensive).toBeLessThan(EVAL_WEIGHTS.boostStage.offensive);
    // Monotone: every extra stage still helps.
    for (let stage = 1; stage < 6; stage++) {
      expect(EVAL_WEIGHTS.boostSchedule[stage + 1]).toBeGreaterThan(EVAL_WEIGHTS.boostSchedule[stage]);
    }
  });

  test('the flat boost term applies the schedule (accuracy stages, matchup-invisible)', () => {
    // Accuracy stages never touch the matchup term, so the mirror isolates
    // the flat term exactly: the +2/+1 ratio is the schedule's 2.0.
    const at = (stage: number) => {
      const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
      battle.sides[0].active[0]!.boostBy({ accuracy: stage as 1 | 2 | 6 });
      return evaluatePosition(battle);
    };
    const v1 = at(1);
    const v2 = at(2);
    const v6 = at(6);
    expect(v1).toBeGreaterThan(0);
    // tanh curvature shaves a hair off the exact 2.0 ratio.
    expect(v2 / v1).toBeCloseTo(2, 1);
    expect(v6).toBeLessThan(2 * v2);
  });

  test('the same teams score better with the favorable matchup active', () => {
    // Machamp wins its pairs, Pikachu (Growl only) loses its own. The teams
    // are identical either way — only who stands on the field differs. The
    // team-wide matchup term alone scored both arrangements identically;
    // the active-pair emphasis makes the on-field pressure count.
    const machampActive = makeBattle(
      [makeSet('Machamp', 'Machamp', ['Karate Chop']), makeSet('Pikachu', 'Pikachu', ['Growl'])],
      [makeSet('Chansey', 'Chansey', ['Tackle']), makeSet('Snorlax', 'Snorlax', ['Tackle'])],
    );
    const pikachuActive = makeBattle(
      [makeSet('Pikachu', 'Pikachu', ['Growl']), makeSet('Machamp', 'Machamp', ['Karate Chop'])],
      [makeSet('Chansey', 'Chansey', ['Tackle']), makeSet('Snorlax', 'Snorlax', ['Tackle'])],
    );
    expect(evaluatePosition(machampActive)).toBeGreaterThan(evaluatePosition(pikachuActive));
  });

  test('a shared matchup cache stays exact across boost changes', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])]);
    const cache = createMatchupCache();
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));
    // The memo covers only the boost-independent part — after stages change,
    // the cached path must track a fresh computation exactly.
    battle.sides[0].active[0]!.boostBy({ atk: 2 });
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));
  });

  test('hazards hurt the side they lie on', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
    battle.sides[1].addSideCondition('stealthrock', battle.sides[0].active[0]!);
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('residual items price into the body score', () => {
    const withItem = (item?: string) => {
      const battle = makeBattle(
        [makeSet('A', 'Rotom-Wash', VANILLA, 50, item ? { item } : {})],
        [makeSet('B', 'Snorlax', VANILLA)],
      );
      return evaluatePosition(battle);
    };
    // Black Sludge slowly kills a non-Poison holder; on a Poison type it heals.
    expect(withItem('Black Sludge')).toBeLessThan(withItem());
    expect(withItem('Sticky Barb')).toBeLessThan(withItem());
    expect(withItem('Leftovers')).toBeGreaterThan(withItem());

    const poisonHolder = (item?: string) => {
      const battle = makeBattle(
        [makeSet('A', 'Amoonguss', VANILLA, 50, item ? { item } : {})],
        [makeSet('B', 'Snorlax', VANILLA)],
      );
      return evaluatePosition(battle);
    };
    expect(poisonHolder('Black Sludge')).toBeGreaterThan(poisonHolder());
  });

  test('coverage penalizes an enemy that nobody answers, max-based', () => {
    const answered = makeBattle(
      [makeSet('Sala', 'Salazzle', ['Sludge Wave', 'Flamethrower'])],
      [makeSet('Don', 'Rhydon', ['Earthquake']), makeSet('Clef', 'Clefable', VANILLA)],
    );
    const unanswered = makeBattle(
      [makeSet('Sala', 'Salazzle', ['Sludge Wave', 'Flamethrower'])],
      [makeSet('Clef', 'Clefable', VANILLA), makeSet('Corv', 'Corviknight', VANILLA)],
    );
    const covAnswered = matchupTerms(answered).coverage;
    const covUnanswered = matchupTerms(unanswered).coverage;
    // Salazzle unanswered → coverage favors p1; Rhydon answering pulls it back toward zero.
    expect(covUnanswered).toBeGreaterThan(covAnswered);
    expect(covUnanswered).toBeGreaterThan(0);

    // Max-based: a second copy of MY mon changes nothing — the enemy's best
    // answer margin is a max, not a sum over my team.
    const dupSala = makeBattle(
      [
        makeSet('Sala', 'Salazzle', ['Sludge Wave', 'Flamethrower']),
        makeSet('Sala2', 'Salazzle', ['Sludge Wave', 'Flamethrower']),
      ],
      [makeSet('Don', 'Rhydon', ['Earthquake']), makeSet('Clef', 'Clefable', VANILLA)],
    );
    expect(matchupTerms(dupSala).coverage).toBeCloseTo(covAnswered, 5);
  });

  test('Stealth Rock is worth more against a rock-weak team than a resisting one', () => {
    const weak = makeBattle(
      [makeSet('A1', 'Charizard', VANILLA), makeSet('A2', 'Volcarona', VANILLA)],
      [makeSet('B1', 'Charizard', VANILLA), makeSet('B2', 'Volcarona', VANILLA)],
    );
    const resist = makeBattle(
      [makeSet('A1', 'Lucario', VANILLA), makeSet('A2', 'Excadrill', VANILLA)],
      [makeSet('B1', 'Lucario', VANILLA), makeSet('B2', 'Excadrill', VANILLA)],
    );
    weak.sides[1].addSideCondition('stealthrock', weak.sides[0].active[0]!);
    resist.sides[1].addSideCondition('stealthrock', resist.sides[0].active[0]!);
    // Mirrors: base score 0; the whole score IS the hazard delta.
    expect(evaluatePosition(weak)).toBeGreaterThan(evaluatePosition(resist));
    expect(evaluatePosition(resist)).toBeGreaterThan(0);
  });

  test('hazard cost skips Boots and Magic Guard and caps at hazardCap', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Volcarona', VANILLA, 50, { item: 'Heavy-Duty Boots' })],
    );
    battle.sides[1].addSideCondition('stealthrock', battle.sides[0].active[0]!);
    expect(hazardCost(battle.sides[1], battle)).toBe(0);

    const stacked = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      Array.from({ length: 6 }, (_, i) => makeSet(`B${i}`, 'Volcarona', VANILLA)),
    );
    const source = stacked.sides[0].active[0]!;
    stacked.sides[1].addSideCondition('stealthrock', source);
    for (let i = 0; i < 3; i++) stacked.sides[1].addSideCondition('spikes', source);
    stacked.sides[1].addSideCondition('toxicspikes', source);
    stacked.sides[1].addSideCondition('stickyweb', source);
    expect(hazardCost(stacked.sides[1], stacked)).toBe(EVAL_WEIGHTS.hazardCap);
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
