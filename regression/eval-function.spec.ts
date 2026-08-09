import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  createMatchupCache, DOUBLES_FEATURE_WEIGHTS, evalFeatures, evaluatePosition, EVAL_WEIGHTS,
  FEATURE_WEIGHTS, featureWeights, hazardCost, matchupTerms, pairThreat, type EvalFeatures,
} from '../src/lib/eval/eval-function';

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

function makeDoublesBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[]): Battle {
  const battle = new Battle({
    formatid: toID('gen9doublescustomgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 12');
    battle.choose('p2', 'team 12');
  }
  return battle;
}

test.describe('win-condition sweep feature', () => {
  test('sweep prices gained coverage, not stages', () => {
    // +2 Dragapult vs two hard hitters it outspeeds: unboosted they 2HKO it
    // before its 3HKO lands (they win the pair); at +2 Darts reaches the
    // 2HKO, the KO race ties, and speed flips both pairs — pure gained
    // coverage.
    const sweepy = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    sweepy.sides[0].active[0]!.boosts.atk = 2;
    // +2 into a wall that still hard-counters: no gained coverage.
    const walled = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('Wall', 'Clefable', ['Moonblast', 'Moonlight'])], // Fairy: immune to Dragon Darts
    );
    walled.sides[0].active[0]!.boosts.atk = 2;
    expect(evalFeatures(sweepy).sweep).toBeGreaterThan(0.3);
    expect(evalFeatures(walled).sweep).toBeCloseTo(0, 5);
    // Weight 0 keeps runtime scores unchanged until adoption.
    expect(FEATURE_WEIGHTS.sweep).toBe(0);
  });
});

test.describe('evaluatePosition', () => {
  test('doubles positions score with the doubles-fitted weights', () => {
    // Per-gametype calibration (2026-08-08 corpus fit): speed control is
    // worth far more in doubles. The doubles dot product must use the
    // doubles weight table, verified against a hand-computed score.
    expect(featureWeights(true)).toEqual(DOUBLES_FEATURE_WEIGHTS);
    expect(featureWeights(false)).toEqual(FEATURE_WEIGHTS);
    expect(DOUBLES_FEATURE_WEIGHTS.tailwind).toBeGreaterThan(FEATURE_WEIGHTS.tailwind);
    expect(DOUBLES_FEATURE_WEIGHTS.trickRoom).toBeGreaterThan(FEATURE_WEIGHTS.trickRoom);

    const doubles = makeDoublesBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('A2', 'Charizard', VANILLA)],
      [makeSet('B', 'Dragapult', VANILLA), makeSet('B2', 'Volcarona', VANILLA)],
    );
    doubles.sides[0].addSideCondition('tailwind', doubles.sides[0].active[0]!);
    const features = evalFeatures(doubles);
    const teamSize = Math.max(doubles.sides[0].pokemon.length, doubles.sides[1].pokemon.length, 1);
    const normalizer = teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp);
    const diff = (Object.keys(DOUBLES_FEATURE_WEIGHTS) as (keyof EvalFeatures)[])
      .reduce((sum, key) => sum + DOUBLES_FEATURE_WEIGHTS[key] * features[key], 0);
    expect(evaluatePosition(doubles)).toBeCloseTo(Math.tanh((diff / normalizer) * EVAL_WEIGHTS.scale), 10);
  });

  test('pinned scores survive the feature-vector refactor', () => {
    // Contract for the WP 7 featureization: same battles, same numbers.
    const hazardous = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('A2', 'Charizard', VANILLA)],
      [makeSet('B', 'Dragapult', VANILLA), makeSet('B2', 'Volcarona', VANILLA)],
    );
    hazardous.sides[1].addSideCondition('stealthrock', hazardous.sides[0].active[0]!);
    hazardous.sides[0].active[0]!.boosts.atk = 2;
    hazardous.sides[1].active[0]!.setStatus('tox');

    const races = makeBattle(
      [makeSet('Sala', 'Salazzle', ['Sludge Wave', 'Flamethrower'])],
      [makeSet('Clef', 'Clefable', ['Calm Mind', 'Moonlight', 'Moonblast', 'Stored Power'], 50, { item: 'Choice Scarf' })],
    );

    const trickroom = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Dragapult', VANILLA)]);
    trickroom.field.addPseudoWeather('trickroom', trickroom.sides[0].active[0]!);

    expect(evaluatePosition(hazardous)).toBeCloseTo(0.8043935326321168, 6);
    expect(evaluatePosition(races)).toBeCloseTo(0.9672891743979647, 6);
    expect(evaluatePosition(trickroom)).toBeCloseTo(0.1243530017715962, 6);
  });

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
    // The RAW schedule is exactly 2.0 at +2; at the corpus-fitted boost
    // weight the tanh curvature bends the score-space ratio toward ~1.9.
    expect(v2 / v1).toBeGreaterThan(1.7);
    expect(v2 / v1).toBeLessThanOrEqual(2);
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

  test('Toxic puts boosts on a timer: statused boost value is discounted', () => {
    const scoreWith = (boosted: boolean, status?: 'tox') => {
      const battle = makeBattle(
        [makeSet('A', 'Clefable', VANILLA)],
        [makeSet('B', 'Snorlax', VANILLA)],
      );
      const clef = battle.sides[0].active[0]!;
      if (boosted) {
        clef.boosts.def = 2;
        clef.boosts.spd = 2;
      }
      if (status) clef.setStatus(status);
      return evaluatePosition(battle);
    };
    // The DELTA the boosts add must roughly halve under Toxic. Tanh curvature
    // alone shifts it ~2% — assert the discount, not the curvature.
    const healthyDelta = scoreWith(true) - scoreWith(false);
    const toxedDelta = scoreWith(true, 'tox') - scoreWith(false, 'tox');
    expect(toxedDelta).toBeLessThan(healthyDelta * 0.6);
    expect(toxedDelta).toBeGreaterThan(0);
  });

  test('a choice-locked attacker threatens only its locked move', () => {
    const battle = makeBattle(
      [makeSet('Tran', 'Heatran', ['Flamethrower', 'Earth Power'], 50, { item: 'Choice Specs', ability: 'Flash Fire' })],
      [makeSet('Skarm', 'Skarmory', VANILLA, 50, { ability: 'Sturdy' })],
    );
    const cache = createMatchupCache();
    const attacker = () => battle.sides[0].active[0]!;
    const defender = () => battle.sides[1].active[0]!;

    const before = pairThreat(attacker(), defender(), battle);
    expect(before.special).toBeGreaterThan(0); // Flamethrower threatens Skarmory

    // Prime the cache with the unlocked threat, then lock into Earth Power
    // (Skarmory is immune): the collapsed threat must not be served stale.
    const scoreBefore = evaluatePosition(battle, cache);
    battle.choose('p1', 'move earthpower');
    battle.choose('p2', 'move protect');
    expect(attacker().volatiles['choicelock']).toBeTruthy();

    const locked = pairThreat(attacker(), defender(), battle);
    expect(locked.special).toBe(0);
    expect(locked.physical).toBe(0);
    expect(evaluatePosition(battle, cache)).toBeLessThan(scoreBefore);
  });

  test('a Choice item on a status-heavy holder is a liability', () => {
    const clefWith = (item?: string) => {
      const battle = makeBattle(
        [makeSet('Clef', 'Clefable', ['Calm Mind', 'Moonlight', 'Moonblast', 'Stored Power'], 50, item ? { item } : {})],
        [makeSet('B', 'Snorlax', VANILLA)],
      );
      return evaluatePosition(battle);
    };
    // Half its moveset is dead behind a Choice lock — the sweep plan is over.
    // Itemless baseline isolates the mismatch penalty from item multipliers.
    expect(clefWith('Choice Scarf')).toBeLessThan(clefWith());

    const pultWith = (item?: string) => {
      const battle = makeBattle(
        [makeSet('Pult', 'Dragapult', ['Draco Meteor', 'Shadow Ball', 'Flamethrower', 'Thunderbolt'], 50, item ? { item } : {})],
        [makeSet('B', 'Snorlax', VANILLA)],
      );
      return evaluatePosition(battle);
    };
    // Four attacks: the Choice item is what it is for — no penalty.
    expect(pultWith('Choice Specs')).toBeGreaterThanOrEqual(pultWith());
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
