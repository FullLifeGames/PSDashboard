import { afterEach, test, expect, describe } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  createMatchupCache, DOUBLES_FEATURE_WEIGHTS, evalFeatures, evaluatePosition, EVAL_WEIGHTS,
  FEATURE_WEIGHTS, featureWeights, hazardCost, hazardRemovalEquity, matchupTerms, pairThreat, raceClocks,
  strandedMons, unansweredMons,
  type EvalFeatures, type RaceSide,
} from '../src/eval-function';
import { setStaticForm } from '../src/score/phase-form';

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

describe('full-HP matchup damping', () => {
  test('matchupEarlyDamp scales the matchup feature at full rosters only', () => {
    const battle = makeBattle(
      [makeSet('Sala', 'Salazzle', ['Sludge Wave', 'Flamethrower'])],
      [makeSet('Clef', 'Clefable', ['Moonblast', 'Moonlight'])],
    );
    const undamped = evalFeatures(battle).matchup;
    const prior = EVAL_WEIGHTS.matchupEarlyDamp;
    (EVAL_WEIGHTS as { matchupEarlyDamp: number }).matchupEarlyDamp = 0.5;
    try {
      expect(evalFeatures(battle).matchup).toBeCloseTo(undamped * 0.5, 8);
    } finally {
      (EVAL_WEIGHTS as { matchupEarlyDamp: number }).matchupEarlyDamp = prior;
    }
  });
});

describe('stranded bench pricing', () => {
  const battleAt = (
    hpFrac: number,
    extras: { item?: string; ability?: string } = {},
    activeMoves: string[] = VANILLA,
  ) => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', activeMoves), makeSet('C', 'Charizard', VANILLA, 50, extras)],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    battle.sides[0].addSideCondition('stealthrock', battle.sides[1].active[0]!);
    const bench = battle.sides[0].pokemon.find(p => p.species.id === 'charizard')!;
    bench.hp = Math.max(1, Math.floor(bench.maxhp * hpFrac));
    return battle;
  };

  test('a bench mon that cannot survive re-entry keeps only its damped alive share', () => {
    // Stranded: hp 24% <= rocks 50%. Contribution (100 * 0.5 + 100 * 0) / 200 = 0.25.
    const strandedFeatures = evalFeatures(battleAt(0.24));
    expect(strandedFeatures.bodies).toBeCloseTo(0.25, 2);
    // Surviving re-entry (60% > 50%): classic (100 + 100 * 0.6) / 200 = 0.8.
    expect(evalFeatures(battleAt(0.6)).bodies).toBeCloseTo(0.8, 2);
  });

  test('Heavy-Duty Boots and Magic Guard mons are never stranded', () => {
    // Entry fraction 0 by hazardEntryFraction: classic (100 + 24) / 200.
    expect(evalFeatures(battleAt(0.24, { item: 'heavydutyboots' })).bodies).toBeCloseTo(0.62, 2);
    expect(evalFeatures(battleAt(0.24, { ability: 'Magic Guard' })).bodies).toBeCloseTo(0.62, 2);
  });

  test('a spikes-only board never strands an airborne bench mon', () => {
    const battle = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('C', 'Rotom-Wash', VANILLA, 50, { ability: 'Levitate' })],
      [makeSet('B', 'Snorlax', VANILLA)],
    );
    battle.sides[0].addSideCondition('spikes', battle.sides[1].active[0]!);
    const bench = battle.sides[0].pokemon.find(p => p.species.id === 'rotomwash')!;
    bench.hp = Math.max(1, Math.floor(bench.maxhp * 0.05));
    expect(strandedMons(battle.sides[0], battle).size).toBe(0);
  });

  test('a living removal carrier lifts the stranded discount for the whole side', () => {
    expect(evalFeatures(battleAt(0.24, {}, ['Rapid Spin', 'Protect'])).bodies).toBeCloseTo(0.62, 2);
  });

  test('active mons are never stranded and stranded mons leave hazardCost', () => {
    const battle = battleAt(0.24);
    const stranded = strandedMons(battle.sides[0], battle);
    expect([...stranded].every(pokemon => !pokemon.isActive)).toBe(true);
    expect(stranded.size).toBe(1);
    // The stranded piece's entry damage is priced in bodies at certainty; the victim term must not charge it again.
    expect(hazardCost(battle.sides[0], battle, stranded))
      .toBeLessThan(hazardCost(battle.sides[0], battle));
  });
});

describe('win-condition sweep cells', () => {
  test('a fast non-OHKO flip lands in fastChip alone', () => {
    // fastChip = 1 flip / 2 targets * hp 1.0 = 0.5, every other cell 0.
    const sweepy = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    sweepy.sides[0].active[0]!.boosts.atk = 2;
    for (const foe of sweepy.sides[1].pokemon) foe.boosts.def = 2;
    const features = evalFeatures(sweepy);
    expect(features.sweepFastChip).toBeCloseTo(0.5, 5);
    expect(features.sweepFastKo).toBeCloseTo(0, 5);
    expect(features.sweepSlowKo).toBeCloseTo(0, 5);
    expect(features.sweepSlowChip).toBeCloseTo(0, 5);
  });

  test('an Iron Ball moves the flips into the slow cells', () => {
    //   slowChip = 1/2 * 0.6974 = 0.3487. (Weavile 1HKOs the chipped Pult, so that pair stops flipping.)
    const chipped = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'], 50, { item: 'ironball' })],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    const pult = chipped.sides[0].active[0]!;
    pult.boosts.atk = 2;
    pult.hp = Math.floor(pult.maxhp * 0.7);
    for (const foe of chipped.sides[1].pokemon) foe.boosts.def = 2;
    const chippedCells = evalFeatures(chipped);
    expect(chippedCells.sweepSlowChip).toBeGreaterThan(0);
    expect(chippedCells.sweepSlowChip).toBeCloseTo(0.5 * (pult.hp / pult.maxhp), 5);
    expect(chippedCells.sweepFastChip).toBeCloseTo(0, 5);
    expect(chippedCells.sweepFastKo).toBeCloseTo(0, 5);
    expect(chippedCells.sweepSlowKo).toBeCloseTo(0, 5);
    // slowKo = 1/2 * hp 1.0 = 0.5 (the Weavile flip).
    const koBoard = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'], 50, { item: 'ironball' })],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    koBoard.sides[0].active[0]!.boosts.atk = 2;
    for (const target of koBoard.sides[1].pokemon) { target.hp = Math.max(1, Math.floor(target.maxhp * 0.6)); target.boosts.def = 2; }
    const koCells = evalFeatures(koBoard);
    expect(koCells.sweepSlowKo).toBeCloseTo(0.5, 5);
    expect(koCells.sweepFastKo).toBeCloseTo(0, 5);
    expect(koCells.sweepFastChip).toBeCloseTo(0, 5);
    expect(koCells.sweepSlowChip).toBeCloseTo(0, 5);
  });

  test('a target inside boosted KO range moves its flip into a Ko cell', () => {
    // fastKo = 1 flip / 2 targets * hp 0.8 = 0.4.
    const sweepy = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    const pult = sweepy.sides[0].active[0]!;
    pult.boosts.atk = 2;
    pult.hp = Math.floor(pult.maxhp * 0.8);
    for (const target of sweepy.sides[1].pokemon) { target.hp = Math.max(1, Math.floor(target.maxhp * 0.6)); target.boosts.def = 2; }
    const features = evalFeatures(sweepy);
    expect(features.sweepFastKo).toBeGreaterThan(0);
    expect(features.sweepFastKo + features.sweepFastChip).toBeCloseTo(0.4, 5);
  });

  test('a walled boost prices at zero in every cell, weights stay 0', () => {
    const walled = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('Wall', 'Clefable', ['Moonblast', 'Moonlight'])],
    );
    const unboosted = evalFeatures(walled);
    expect(unboosted.sweepFastKo + unboosted.sweepFastChip +
      unboosted.sweepSlowKo + unboosted.sweepSlowChip).toBeCloseTo(0, 5);
    walled.sides[0].active[0]!.boosts.atk = 2;
    const features = evalFeatures(walled);
    expect(features.sweepFastKo).toBeCloseTo(0, 5);
    expect(features.sweepFastChip).toBeCloseTo(0, 5);
    expect(features.sweepSlowKo).toBeCloseTo(0, 5);
    expect(features.sweepSlowChip).toBeCloseTo(0, 5);
    expect(FEATURE_WEIGHTS.sweepFastKo).toBe(0);
    expect(FEATURE_WEIGHTS.sweepFastChip).toBe(0);
    expect(FEATURE_WEIGHTS.sweepSlowKo).toBe(0);
    expect(FEATURE_WEIGHTS.sweepSlowChip).toBe(0);
  });
});

describe('evaluatePosition', () => {
  afterEach(() => setStaticForm(null));

  test('doubles positions score with the doubles-fitted weights', () => {
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
    setStaticForm(false);
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

    expect(evaluatePosition(hazardous)).toBeCloseTo(0.7446947493564187, 6);
    expect(evaluatePosition(races)).toBeCloseTo(0.9722131704913529, 6);
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

  test('boosts on the active help when a move reads the stage', () => {
    const battle = makeBattle([makeSet('A', 'Snorlax', ['Tackle'])], [makeSet('B', 'Snorlax', ['Tackle'])]);
    battle.sides[0].active[0]!.boostBy({ atk: 2 });
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('an attack boost flips the matchup term, not just the flat bonus', () => {
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

  test('the flat boost term applies the schedule (accuracy stages, matchup-invisible)', () => {
    // The +2/+1 ratio is the schedule's 2.0, read on the boosts column.
    const at = (stage: number) => {
      const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)]);
      battle.sides[0].active[0]!.boostBy({ accuracy: stage as 1 | 2 | 6 });
      return evalFeatures(battle).boosts;
    };
    const v1 = at(1);
    const v2 = at(2);
    const v6 = at(6);
    expect(v1).toBeGreaterThan(0);
    expect(v2 / v1).toBeCloseTo(2, 10);
    expect(v6).toBeLessThan(2 * v2);
  });

  test('the same teams score better with the favorable matchup active', () => {
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
      return evalFeatures(battle).boosts;
    };
    // The delta the boosts add must roughly halve under Toxic, read on the boosts column (no tanh curvature).
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
    expect(before.special).toBeGreaterThan(0);

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
    expect(clefWith('Choice Scarf')).toBeLessThan(clefWith());

    const pultWith = (item?: string) => {
      const battle = makeBattle(
        [makeSet('Pult', 'Dragapult', ['Draco Meteor', 'Shadow Ball', 'Flamethrower', 'Thunderbolt'], 50, item ? { item } : {})],
        [makeSet('B', 'Snorlax', VANILLA)],
      );
      return evaluatePosition(battle);
    };
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
    expect(covUnanswered).toBeGreaterThan(covAnswered);
    expect(covUnanswered).toBeGreaterThan(0);

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
    expect(evaluatePosition(weak)).toBeGreaterThan(evaluatePosition(resist));
    expect(evaluatePosition(resist)).toBeGreaterThan(0);
  });

  test('grounding is the sim\'s: Gravity grounds fliers; Toxic Spikes immunity is dex-typed', () => {
    const flier = () => makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Talonflame', VANILLA)],
    );
    const airborne = flier();
    airborne.sides[1].addSideCondition('spikes', airborne.sides[0].active[0]!);
    expect(hazardCost(airborne.sides[1], airborne)).toBe(0);
    const grounded = flier();
    grounded.sides[1].addSideCondition('spikes', grounded.sides[0].active[0]!);
    grounded.field.addPseudoWeather('gravity', grounded.sides[0].active[0]!);
    expect(hazardCost(grounded.sides[1], grounded)).toBeGreaterThan(0);
    // A benched Levitate mon still prices as airborne: its ability applies on entry, though the sim ignores it.
    const bench = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Snorlax', VANILLA), makeSet('C', 'Rotom-Heat', VANILLA, 50, { ability: 'Levitate' })],
    );
    bench.sides[1].addSideCondition('spikes', bench.sides[0].active[0]!);
    const spikesCost = hazardCost(bench.sides[1], bench);
    const withoutLevitate = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Snorlax', VANILLA), makeSet('C', 'Rotom-Heat', VANILLA)],
    );
    withoutLevitate.sides[1].addSideCondition('spikes', withoutLevitate.sides[0].active[0]!);
    expect(spikesCost).toBeLessThan(hazardCost(withoutLevitate.sides[1], withoutLevitate));

    const toxicCost = (species: string) => {
      const battle = makeBattle([makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', species, VANILLA)]);
      battle.sides[1].addSideCondition('toxicspikes', battle.sides[0].active[0]!);
      return hazardCost(battle.sides[1], battle);
    };
    expect(toxicCost('Muk')).toBe(0);
    expect(toxicCost('Klefki')).toBe(0);
    expect(toxicCost('Snorlax')).toBeGreaterThan(0);
  });

  test('entry cost discounts a benched mon\'s matchup pressure; Boots negate it', () => {
    const board = (item = '') => makeBattle(
      [makeSet('A', 'Snorlax', VANILLA), makeSet('Volc', 'Volcarona', ['Flamethrower', 'Quiver Dance'], 50, item ? { item } : {})],
      [makeSet('B', 'Scizor', ['Bullet Punch', 'Swords Dance']), makeSet('C', 'Ferrothorn', ['Power Whip'])],
    );
    const clean = board();
    const rocked = board();
    rocked.sides[0].addSideCondition('stealthrock', rocked.sides[1].active[0]!);
    const booted = board('Heavy-Duty Boots');
    booted.sides[0].addSideCondition('stealthrock', booted.sides[1].active[0]!);

    const matchupOf = (battle: Battle) => matchupTerms(battle).matchup;
    expect(matchupOf(rocked)).toBeLessThan(matchupOf(clean));
    expect(matchupOf(booted)).toBeCloseTo(matchupOf(clean), 8);
    const activesOnly = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Scizor', ['Bullet Punch'])],
    );
    const activesRocked = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Scizor', ['Bullet Punch'])],
    );
    activesRocked.sides[0].addSideCondition('stealthrock', activesRocked.sides[1].active[0]!);
    expect(matchupOf(activesRocked)).toBeCloseTo(matchupOf(activesOnly), 8);
  });

  test('hazard removal is an OPTION on the net board state', () => {
    const board = (mon: ReturnType<typeof makeSet>) => makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Volcarona', VANILLA), mon],
    );
    const withDefog = board(makeSet('C', 'Talonflame', ['Defog', 'Roost']));
    withDefog.sides[1].addSideCondition('stealthrock', withDefog.sides[0].active[0]!);
    const cost = hazardCost(withDefog.sides[1], withDefog);
    expect(cost).toBeGreaterThan(0);
    expect(hazardRemovalEquity(withDefog.sides[1], withDefog))
      .toBeCloseTo(cost * EVAL_WEIGHTS.hazardRemovalDiscount, 8);

    const doubleEdged = makeBattle(
      [makeSet('A', 'Snorlax', ['Defog', 'Protect'])],
      [makeSet('B', 'Volcarona', VANILLA), makeSet('C', 'Talonflame', VANILLA)],
    );
    doubleEdged.sides[0].addSideCondition('stealthrock', doubleEdged.sides[1].active[0]!);
    doubleEdged.sides[1].addSideCondition('stealthrock', doubleEdged.sides[0].active[0]!);
    expect(hazardCost(doubleEdged.sides[0], doubleEdged))
      .toBeLessThan(hazardCost(doubleEdged.sides[1], doubleEdged));
    expect(hazardRemovalEquity(doubleEdged.sides[0], doubleEdged)).toBe(0);

    const spinner = makeBattle(
      [makeSet('A', 'Snorlax', ['Rapid Spin', 'Protect'])],
      [makeSet('B', 'Volcarona', VANILLA), makeSet('C', 'Talonflame', VANILLA)],
    );
    spinner.sides[0].addSideCondition('stealthrock', spinner.sides[1].active[0]!);
    spinner.sides[1].addSideCondition('stealthrock', spinner.sides[0].active[0]!);
    expect(hazardRemovalEquity(spinner.sides[0], spinner))
      .toBeCloseTo(hazardCost(spinner.sides[0], spinner) * EVAL_WEIGHTS.hazardRemovalDiscount, 8);

    withDefog.sides[1].pokemon[1].faint();
    withDefog.sides[1].pokemon[1].hp = 0;
    expect(hazardRemovalEquity(withDefog.sides[1], withDefog)).toBe(0);
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
    const battle = makeBattle(
      [makeSet('A', 'Pikachu', ['Quick Attack'])],
      [makeSet('B', 'Pikachu', ['Tackle'])],
    );
    expect(evaluatePosition(battle)).toBeGreaterThan(0);
  });

  test('a healer walls an attacker that cannot 2HKO', () => {
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

    const four = five.slice(0, 4);
    expect(evaluatePosition(makeBattle(four, six))).toBeLessThan(oneDown);
  });
});

describe('effective speed in the eval', () => {
  test('a Scarf breaks a mirror matchup tie', () => {
    const tie = makeBattle(
      [makeSet('T1', 'Talonflame', ['Flare Blitz'])],
      [makeSet('T2', 'Talonflame', ['Flare Blitz'])],
    );
    expect(evalFeatures(tie).matchup).toBeCloseTo(0, 8);
    const scarfed = makeBattle(
      [makeSet('T1', 'Talonflame', ['Flare Blitz'])],
      [makeSet('T2', 'Talonflame', ['Flare Blitz'], 50, { item: 'choicescarf' })],
    );
    expect(evalFeatures(scarfed).matchup).toBeLessThan(0);
  });

  test('the Trick Room sign reads effective speed', () => {
    const mirror = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)], [makeSet('B', 'Snorlax', VANILLA)],
    );
    mirror.field.addPseudoWeather('trickroom', mirror.sides[0].active[0]!);
    expect(evalFeatures(mirror).trickRoom).toBe(1);
    const balled = makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Snorlax', VANILLA, 50, { item: 'ironball' })],
    );
    balled.field.addPseudoWeather('trickroom', balled.sides[0].active[0]!);
    expect(evalFeatures(balled).trickRoom).toBe(-1);
  });
});

describe('PP truth in the threat model', () => {
  // PP comes from the sim's move slots, not the Dex base PP: Showdown runs maxed PP Ups, Champions other counts.
  test('pairThreat ignores move slots with no PP left', () => {
    const battle = makeBattle(
      [makeSet('A', 'Golem', ['Earthquake', 'Protect'])],
      [makeSet('B', 'Weezing', ['Sludge Bomb'], 50, { ability: 'Neutralizing Gas' })],
    );
    const attacker = battle.sides[0].active[0]!;
    const defender = battle.sides[1].active[0]!;
    expect(pairThreat(attacker, defender, battle).physical).toBeGreaterThan(0);
    for (const slot of attacker.moveSlots) slot.pp = 0;
    expect(pairThreat(attacker, defender, battle).physical).toBe(0);
  });

  test('a drained healer no longer walls', () => {
    const attacker = makeSet('A', 'Pikachu', ['Tackle'], 30);
    const walled = makeBattle([attacker], [makeSet('B', 'Blissey', ['Soft-Boiled'], 100)]);
    const drained = makeBattle([attacker], [makeSet('B', 'Blissey', ['Soft-Boiled'], 100)]);
    for (const slot of drained.sides[1].active[0]!.moveSlots) slot.pp = 0;
    expect(evaluatePosition(drained)).toBeGreaterThan(evaluatePosition(walled));
  });

  test('the matchup cache tracks PP transitions', () => {
    const battle = makeBattle(
      [makeSet('A', 'Golem', ['Earthquake'])],
      [makeSet('B', 'Weezing', ['Sludge Bomb'], 50, { ability: 'Neutralizing Gas' })],
    );
    const cache = createMatchupCache();
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));
    battle.sides[0].active[0]!.moveSlots[0].pp = 0;
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));
  });

  describe('unanswered mons', () => {
    test('a mon no living enemy out-races is unanswered', () => {
      const battle = makeBattle(
        [makeSet('Mewtwo', 'Mewtwo', ['Psystrike'], 100)],
        [makeSet('Rattata', 'Rattata', ['Tackle']), makeSet('Raticate', 'Raticate', ['Tackle'])],
      );
      expect(unansweredMons(battle)).toEqual({
        p1: ['Mewtwo'], p2: [],
        decided: { side: 'p1', species: 'Mewtwo' },
      });
    });

    test('a dead-even mirror names nobody — a wall that holds the pair is an answer', () => {
      const battle = makeBattle(
        [makeSet('A', 'Snorlax', ['Tackle'])],
        [makeSet('B', 'Snorlax', ['Tackle'])],
      );
      expect(unansweredMons(battle)).toEqual({ p1: [], p2: [] });
    });

    test('a benched answer pays the entry toll; the same answer active stands', () => {
      const benched = makeBattle(
        [makeSet('Mewtwo', 'Mewtwo', ['Psystrike'], 100)],
        [makeSet('Rattata', 'Rattata', ['Tackle']), makeSet('Twin', 'Mewtwo', ['Psystrike'], 100)],
      );
      expect(unansweredMons(benched)).toEqual({ p1: ['Mewtwo'], p2: [] });

      const active = makeBattle(
        [makeSet('Mewtwo', 'Mewtwo', ['Psystrike'], 100)],
        [makeSet('Twin', 'Mewtwo', ['Psystrike'], 100), makeSet('Rattata', 'Rattata', ['Tackle'])],
      );
      expect(unansweredMons(active)).toEqual({
        p1: [], p2: [],
        p1Entry: [{ species: 'Mewtwo', heldBy: 'Mewtwo' }],
      });
    });
  });

  describe('the switch-in stage and the coin-flip check', () => {
    test('pairThreat carries the accuracy of its category-max move', () => {
      const battle = makeBattle(
        [makeSet('A', 'Machamp', ['Dynamic Punch', 'Tackle'])],
        [makeSet('B', 'Snorlax', ['Tackle'])],
      );
      const chancy = pairThreat(battle.sides[0].active[0]!, battle.sides[1].active[0]!, battle);
      expect(chancy.physicalAcc).toBeCloseTo(0.5, 5);
      const plain = pairThreat(battle.sides[1].active[0]!, battle.sides[0].active[0]!, battle);
      expect(plain.physicalAcc).toBe(1);
    });

    test('a coin-flip nuke is no answer; the sure nuke still holds the pair', () => {
      const flip = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [makeSet('A', 'Machamp', ['Dynamic Punch']), makeSet('F', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(flip)).toEqual({
        p1: ['Tauros'], p2: [],
        decided: { side: 'p1', species: 'Tauros' },
      });

      const sure = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [makeSet('A', 'Machamp', ['Close Combat']), makeSet('F', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(sure)).toEqual({
        p1: [], p2: ['Machamp'],
        p1Entry: [{ species: 'Tauros', heldBy: 'Machamp' }],
        decided: { side: 'p2', species: 'Machamp' },
      });
    });

    test("the fresh entry's Fake Out chips the standing answer for free", () => {
      const plain = makeBattle(
        [makeSet('X', 'Lopunny', ['Body Slam'])],
        [makeSet('A', 'Snorlax', ['Strength']), makeSet('F', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(plain)).toEqual({
        p1: [], p2: ['Snorlax'],
        p1Entry: [{ species: 'Lopunny', heldBy: 'Snorlax' }],
        decided: { side: 'p2', species: 'Snorlax' },
      });

      const flinch = makeBattle(
        [makeSet('X', 'Lopunny', ['Fake Out', 'Body Slam'])],
        [makeSet('A', 'Snorlax', ['Strength']), makeSet('F', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(flinch)).toEqual({
        p1: ['Lopunny'], p2: ['Snorlax'],
        decided: { side: 'p2', species: 'Snorlax' },
      });
    });
  });

  describe('the decided sweep and the near-decided roll', () => {
    test('winning every fresh pair is not a decided sweep', () => {
      const battle = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [makeSet('A', 'Machamp', ['Dynamic Punch']), makeSet('B', 'Machamp', ['Dynamic Punch'])],
      );
      const profile = unansweredMons(battle);
      expect(profile.p1).toEqual(['Tauros']);
      expect(profile.decided).toBeUndefined();
    });

    test('clearing the rest in sequence while surviving is decided', () => {
      const battle = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [makeSet('A', 'Caterpie', ['Tackle'], 5), makeSet('B', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(battle).decided).toEqual({ side: 'p1', species: 'Tauros' });
    });

    test('a slow grind is not decided even when every pair is won', () => {
      const battle = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [
          makeSet('A', 'Klefki', ['Tackle']),
          makeSet('B', 'Klefki', ['Tackle']),
          makeSet('C', 'Klefki', ['Tackle']),
        ],
      );
      expect(unansweredMons(battle).decided).toBeUndefined();
    });

    test('a 1v1 endgame is decided for the clear pair winner', () => {
      const battle = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [makeSet('A', 'Machamp', ['Dynamic Punch'])],
      );
      expect(unansweredMons(battle).decided).toEqual({ side: 'p1', species: 'Tauros' });
    });

    test('a pinned healer does not block the sweep; a two-wall standoff stays open', () => {
      const cracked = makeBattle(
        [makeSet('X', 'Garchomp', ['Earthquake'])],
        [makeSet('A', 'Toxapex', ['Recover', 'Scald'], 30), makeSet('F', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(cracked).decided).toEqual({ side: 'p1', species: 'Garchomp' });

      const walled = makeBattle(
        [makeSet('X', 'Chansey', ['Soft-Boiled', 'Tackle'])],
        [makeSet('A', 'Toxapex', ['Recover', 'Scald']), makeSet('F', 'Caterpie', ['Tackle'], 5)],
      );
      expect(unansweredMons(walled).decided).toBeUndefined();
    });

    test('a high-odds kill that unlocks the sweep reads as near-decided', () => {
      // The odds are the boundary event: accuracy * kill share.
      const battle = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'], 50, { item: 'choiceband' })],
        [makeSet('A', 'Alakazam', ['Psychic']), makeSet('B', 'Machamp', ['Dynamic Punch'])],
      );
      const profile = unansweredMons(battle);
      expect(profile.decided).toBeUndefined();
      expect(profile.nearDecided?.side).toBe('p1');
      expect(profile.nearDecided?.species).toBe('Tauros');
      expect(profile.nearDecided?.removes).toBe('Alakazam');
      expect(profile.nearDecided?.odds ?? 0).toBeGreaterThanOrEqual(0.9);
    });

    test('a coin-flip kill is no near-decided', () => {
      const battle = makeBattle(
        [makeSet('X', 'Tauros', ['Double-Edge'])],
        [makeSet('A', 'Machamp', ['Dynamic Punch']), makeSet('B', 'Machamp', ['Dynamic Punch'])],
      );
      expect(unansweredMons(battle).nearDecided).toBeUndefined();
    });
  });
});

describe('the healer wall is a finite race', () => {
  const side = (partial: Partial<RaceSide>): RaceSide =>
    ({ hp: 1, frac: 0, residual: 0, healRate: 0, healAbsorb: 0, ppBudget: 64, ...partial });
  // A 16-PP Recover-class healer: rate 1/2 per turn, 8 bars of total fuel.
  const recoverer = { healRate: 0.5, healAbsorb: 8 };

  test('heal PP absorbs as survival and the PP budget caps every clock', () => {
    const attacker = side({ frac: 0.3, ppBudget: 16 });
    // 16 Recover PP absorb 8 extra bars: 30 turns needed > 16 attacking PP.
    expect(raceClocks(attacker, side(recoverer)).turnsA).toBe(Infinity);
    // 2 PP absorb 1 extra bar: 7 turns, within budget.
    expect(raceClocks(attacker, side({ healRate: 0.5, healAbsorb: 1 })).turnsA).toBe(7);
  });

  test('a status residual crumbles a borderline wall', () => {
    const attacker = side({ frac: 0.45 });
    const healer = side({ frac: 0.2, ...recoverer, ppBudget: 60 });
    const burned = { ...healer, residual: 1 / 16 };
    // 0.45 <= 0.5: the wall holds and the healer keeps spare-turn offense.
    expect(raceClocks(attacker, healer).effFracB).toBeGreaterThan(0);
    // 0.45 + 1/16 > 0.5: sustain loses ground and the healer is pinned.
    expect(raceClocks(attacker, burned).effFracB).toBe(0);
    expect(raceClocks(attacker, burned).turnsA)
      .toBeLessThan(raceClocks(attacker, healer).turnsA);
  });

  test("the walling healer's counter-offense runs on spare turns only", () => {
    const attacker = side({ frac: 0.45 });
    const healer = side({ frac: 0.2, ...recoverer, ppBudget: 60 });
    // Under 0.45 pressure it heals 90% of turns: 0.2 * 0.1 gives 50 turns.
    expect(raceClocks(attacker, healer).turnsB).toBe(50);
    // Unpressured it attacks freely: ceil(1 / 0.2) = 5.
    expect(raceClocks(side({}), healer).turnsB).toBe(5);
  });

  test('heal rates are per move, read from the dex ratio', () => {
    const attacker = side({ frac: 0.4 });
    const strong = side({ frac: 0.2, healRate: 1 / 2, healAbsorb: 8, ppBudget: 60 });
    const weak = side({ frac: 0.2, healRate: 1 / 4, healAbsorb: 4, ppBudget: 60 });
    expect(raceClocks(attacker, strong).effFracB).toBeGreaterThan(0);
    expect(raceClocks(attacker, weak).effFracB).toBe(0);
  });

  test('held heal PP realizes only at the pin efficiency — healing now beats holding', () => {
    const attacker = side({ frac: 1.0 });
    const held = side({ frac: 0.2, healRate: 0.5, healAbsorb: 2 });
    const healed = side({ hp: 1.5, frac: 0.2, healRate: 0.5, healAbsorb: 1.5 });
    expect(raceClocks(attacker, held).turnsA).toBe(1);
    expect(raceClocks(attacker, healed).turnsA).toBe(2);
    const gentle = side({ frac: 0.4 });
    expect(raceClocks(gentle, held).turnsA).toBe(8);
  });

  test('573756 t138: a burned, PP-drained wall loses the last-pair race', () => {
    const endgame = (burned: boolean, recoverPP: number) => {
      const battle = makeBattle(
        [makeSet('Pex', 'Toxapex', ['Recover', 'Knock Off', 'Haze', 'Toxic'], 100)],
        [makeSet('Yak', 'Zapdos-Galar', ['Stomping Tantrum'], 100)],
      );
      const pex = battle.sides[0].active[0]!;
      const yak = battle.sides[1].active[0]!;
      pex.hp = Math.floor(pex.maxhp * 0.88);
      yak.hp = Math.floor(yak.maxhp * 0.18);
      if (burned) pex.setStatus('brn');
      pex.moveSlots[0].pp = recoverPP;
      return evalFeatures(battle).matchup;
    };
    expect(endgame(false, 16)).toBeGreaterThan(0);
    expect(endgame(true, 3)).toBeLessThan(0);
  });
});
