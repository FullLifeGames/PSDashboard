import { test, expect } from '@playwright/test';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  createMatchupCache, DOUBLES_FEATURE_WEIGHTS, evalFeatures, evaluatePosition, EVAL_WEIGHTS,
  FEATURE_WEIGHTS, featureWeights, hazardCost, hazardRemovalEquity, matchupTerms, pairThreat, raceClocks,
  strandedMons, unansweredMons,
  type EvalFeatures, type RaceSide,
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

test.describe('full-HP matchup damping', () => {
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

test.describe('stranded bench pricing', () => {
  // p1: active Snorlax (full HP ⇒ bodies 1.0) + bench Charizard (4x rock
  // weak ⇒ rocks entry fraction 0.5). p2: lone Snorlax ⇒ bodies 1.0.
  // features.bodies = p1 − p2 = the Charizard contribution alone.
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
    // Stranded: hp 24% ≤ rocks 50%. Contribution (100·0.5 + 100·0)/200 = 0.25.
    const strandedFeatures = evalFeatures(battleAt(0.24));
    expect(strandedFeatures.bodies).toBeCloseTo(0.25, 2);
    // Surviving re-entry (60% > 50%): classic (100 + 100·0.6)/200 = 0.8.
    expect(evalFeatures(battleAt(0.6)).bodies).toBeCloseTo(0.8, 2);
  });

  test('Heavy-Duty Boots and Magic Guard mons are never stranded', () => {
    // Entry fraction 0 by hazardEntryFraction — classic (100 + 24)/200.
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
    // The active Snorlax carries Rapid Spin: the piece can wait for removal.
    expect(evalFeatures(battleAt(0.24, {}, ['Rapid Spin', 'Protect'])).bodies).toBeCloseTo(0.62, 2);
  });

  test('active mons are never stranded and stranded mons leave hazardCost', () => {
    const battle = battleAt(0.24);
    const stranded = strandedMons(battle.sides[0], battle);
    expect([...stranded].every(pokemon => !pokemon.isActive)).toBe(true);
    expect(stranded.size).toBe(1);
    // Dedupe: the stranded piece's future entry damage is priced in bodies
    // at certainty — the victim-term must not charge the same event.
    expect(hazardCost(battle.sides[0], battle, stranded))
      .toBeLessThan(hazardCost(battle.sides[0], battle));
  });
});

test.describe('win-condition sweep cells', () => {
  test('a fast non-OHKO flip lands in fastChip alone', () => {
    // +2 Dragapult vs Talonflame + Weavile. Measured pair fractions (empirical
    // pin 2026-08-24): Darts→Talon 0.3534 (+2: 0.7067), Darts→Weavile 0.3942
    // (+2: 0.7884), Flare Blitz→Pult 0.292, Night Slash→Pult 0.8887; speeds
    // 162/146/145. Only the WEAVILE pair flips: unboosted Pult loses the 3v2
    // race, at +2 the race ties 2-2 and speed decides. (The Talonflame pair
    // never flips — unboosted Pult already wins 3v4.) Boosted Darts (0.7884)
    // don't reach full-HP Weavile, so the flip is fast but not in KO range:
    // fastChip = 1 flip / 2 targets × hp 1.0 = 0.5, every other cell 0.
    const sweepy = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    sweepy.sides[0].active[0]!.boosts.atk = 2;
    const features = evalFeatures(sweepy);
    expect(features.sweepFastChip).toBeCloseTo(0.5, 5);
    expect(features.sweepFastKo).toBeCloseTo(0, 5);
    expect(features.sweepSlowKo).toBeCloseTo(0, 5);
    expect(features.sweepSlowChip).toBeCloseTo(0, 5);
  });

  test('an Iron Ball moves the flips into the slow cells', () => {
    // An Iron Ball (speed 162→81, now slowest) breaks the tie-WIN the fast
    // flip rode on, so the full-HP board prices at zero — slow flips need
    // strict turn wins. Two boards produce them (fractions as pinned above):
    // slowChip: Pult chipped to 136/195 (0.6974) — Flare Blitz now 3HKOs it,
    //   boosted Darts win 2v3 strictly, unboosted 3v3 ties and the slower
    //   side loses → the Talonflame pair flips, no KO range (0.7067 < 1.0).
    //   slowChip = 1/2 × 0.6974 ≈ 0.3487. (Weavile 1HKOs the chipped Pult —
    //   that pair stops flipping.)
    const chipped = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'], 50, { item: 'ironball' })],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    const pult = chipped.sides[0].active[0]!;
    pult.boosts.atk = 2;
    pult.hp = Math.floor(pult.maxhp * 0.7);
    const chippedCells = evalFeatures(chipped);
    expect(chippedCells.sweepSlowChip).toBeGreaterThan(0);
    expect(chippedCells.sweepSlowChip).toBeCloseTo(0.5 * (pult.hp / pult.maxhp), 5);
    expect(chippedCells.sweepFastChip).toBeCloseTo(0, 5);
    expect(chippedCells.sweepFastKo).toBeCloseTo(0, 5);
    expect(chippedCells.sweepSlowKo).toBeCloseTo(0, 5);
    // slowKo: full-HP Pult, targets at 0.6 — boosted Darts (0.7884) cover
    //   Weavile's 0.5989, unboosted ties 2-2 and the slower side loses →
    //   the Weavile flip lands in slowKo = 1/2 × hp 1.0 = 0.5.
    const koBoard = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'], 50, { item: 'ironball' })],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    koBoard.sides[0].active[0]!.boosts.atk = 2;
    for (const target of koBoard.sides[1].pokemon) {
      target.hp = Math.max(1, Math.floor(target.maxhp * 0.6));
    }
    const koCells = evalFeatures(koBoard);
    expect(koCells.sweepSlowKo).toBeCloseTo(0.5, 5);
    expect(koCells.sweepFastKo).toBeCloseTo(0, 5);
    expect(koCells.sweepFastChip).toBeCloseTo(0, 5);
    expect(koCells.sweepSlowChip).toBeCloseTo(0, 5);
  });

  test('a target inside boosted KO range moves its flip into a Ko cell', () => {
    // fastKo is the glass-cannon race won purely by moving first: the target
    // must OHKO the sweeper back (else the unboosted 2HKO still wins the
    // pair and the flip dies). Empirical pin (fractions as above): Pult at
    // 156/195 (0.8, inside Night Slash's 0.8887), Weavile at 106/177
    // (0.5989, inside boosted Darts' 0.7884 but above unboosted 0.3942) —
    // boosted races 1-1 and speed decides, unboosted needs 2 turns and
    // loses. fastKo = 1 flip / 2 targets × hp 0.8 = 0.4. (Talonflame's pair:
    // unboosted Pult wins 2v3 outright — no flip.)
    const sweepy = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('A', 'Talonflame', ['Flare Blitz']), makeSet('B', 'Weavile', ['Night Slash'])],
    );
    const pult = sweepy.sides[0].active[0]!;
    pult.boosts.atk = 2;
    pult.hp = Math.floor(pult.maxhp * 0.8);
    for (const target of sweepy.sides[1].pokemon) {
      target.hp = Math.max(1, Math.floor(target.maxhp * 0.6));
    }
    const features = evalFeatures(sweepy);
    expect(features.sweepFastKo).toBeGreaterThan(0);
    expect(features.sweepFastKo + features.sweepFastChip).toBeCloseTo(0.4, 5);
  });

  test('a walled boost prices at zero in every cell, weights stay 0', () => {
    const walled = makeBattle(
      [makeSet('Pult', 'Dragapult', ['Dragon Darts', 'Dragon Dance'])],
      [makeSet('Wall', 'Clefable', ['Moonblast', 'Moonlight'])], // Fairy: immune to Dragon Darts
    );
    // Flip core unchanged: without a positive offensive stage every cell is 0.
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
    // Re-pinned for the round-11 race clocks (was 0.9672891743979647): the
    // Moonlight Clefable's wall is finite now, so the Salazzle side gains.
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

  test('grounding is the sim\'s: Gravity grounds fliers; Toxic Spikes immunity is dex-typed', () => {
    const flier = () => makeBattle(
      [makeSet('A', 'Snorlax', VANILLA)],
      [makeSet('B', 'Talonflame', VANILLA)],
    );
    const airborne = flier();
    airborne.sides[1].addSideCondition('spikes', airborne.sides[0].active[0]!);
    expect(hazardCost(airborne.sides[1], airborne)).toBe(0);
    // Under Gravity the same Flying-type pays Spikes on entry.
    const grounded = flier();
    grounded.sides[1].addSideCondition('spikes', grounded.sides[0].active[0]!);
    grounded.field.addPseudoWeather('gravity', grounded.sides[0].active[0]!);
    expect(hazardCost(grounded.sides[1], grounded)).toBeGreaterThan(0);
    // A benched Levitate mon still prices as airborne (its ability applies
    // the moment it enters, even though the sim ignores inactive abilities).
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

    // Toxic Spikes: Poison- and Steel-types are immune by the TYPE CHART,
    // everything grounded and typeless-of-those pays.
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
    // Volcarona dominates its pairs from the bench — but with rocks up it
    // enters at half HP, so its pressure must read weaker. The wincon-vs-
    // hazards interaction (endgame: hazards effectively disable a benched
    // sweeper) was invisible to the additive model.
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
    // Rocks on Volcarona's side weaken p1's matchup pressure…
    expect(matchupOf(rocked)).toBeLessThan(matchupOf(clean));
    // …but Heavy-Duty Boots restore it exactly (no entry cost).
    expect(matchupOf(booted)).toBeCloseTo(matchupOf(clean), 8);
    // Active mons pay no entry cost: single-mon sides are unaffected.
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
    // A Defogger on the suffering side: the option to clear is worth the
    // discounted net relief (the T14 Talonflame case — the switch INTO the
    // Defogger must not read as walking deeper into the hazard cost).
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

    // Defog is double-edged: when the side's OWN hazards on the opponent's
    // board are worth more than its suffering, the option is never exercised
    // — equity 0, full price stands. (Snorlax suffers cheap neutral rocks;
    // the opposing board holds rocks that bleed 4x-weak Volcarona.)
    const doubleEdged = makeBattle(
      [makeSet('A', 'Snorlax', ['Defog', 'Protect'])],
      [makeSet('B', 'Volcarona', VANILLA), makeSet('C', 'Talonflame', VANILLA)],
    );
    doubleEdged.sides[0].addSideCondition('stealthrock', doubleEdged.sides[1].active[0]!);
    doubleEdged.sides[1].addSideCondition('stealthrock', doubleEdged.sides[0].active[0]!);
    expect(hazardCost(doubleEdged.sides[0], doubleEdged))
      .toBeLessThan(hazardCost(doubleEdged.sides[1], doubleEdged));
    expect(hazardRemovalEquity(doubleEdged.sides[0], doubleEdged)).toBe(0);

    // Rapid Spin only clears the spinner's OWN side — the same board grants
    // full (discounted) relief because nothing of value is lost.
    const spinner = makeBattle(
      [makeSet('A', 'Snorlax', ['Rapid Spin', 'Protect'])],
      [makeSet('B', 'Volcarona', VANILLA), makeSet('C', 'Talonflame', VANILLA)],
    );
    spinner.sides[0].addSideCondition('stealthrock', spinner.sides[1].active[0]!);
    spinner.sides[1].addSideCondition('stealthrock', spinner.sides[0].active[0]!);
    expect(hazardRemovalEquity(spinner.sides[0], spinner))
      .toBeCloseTo(hazardCost(spinner.sides[0], spinner) * EVAL_WEIGHTS.hazardRemovalDiscount, 8);

    // A fainted remover holds no option.
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

test.describe('effective speed in the eval (round 9)', () => {
  test('a Scarf breaks a mirror matchup tie', () => {
    // Identical Talonflame mirror: same damage both ways, no priority moves,
    // equal turns — the pair sign is decided by speed alone. Bare mirror
    // ties (sign 0 ⇒ matchup 0); a Scarf on p2 makes p2 faster ⇒ matchup < 0.
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
    // Snorlax mirror under TR: bare mirror ties (<= keeps +1 for p1); an
    // Iron Ball on p2 makes p2 the slower side ⇒ TR favors p2 (−1).
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

test.describe('PP truth in the threat model (round 11)', () => {
  // PP is read LIVE from the sim's move slots, never derived from dex base
  // PP: pools differ across rule sets (Showdown effectively always runs
  // maxed PP Ups; Pokémon Champions runs different counts), and the sim's
  // replay bookkeeping is the only ground truth.
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
    // 573756 t134–139: p2's Toxapex played its whole set to 0 PP and could
    // only Struggle, yet kept pricing as a full healer-wall. A heal move
    // with no PP left is no heal move.
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
    // Draining a move between evaluations must not serve the stale threat.
    battle.sides[0].active[0]!.moveSlots[0].pp = 0;
    expect(evaluatePosition(battle, cache)).toBe(evaluatePosition(battle));
  });

  test.describe('unanswered mons (round 13)', () => {
    test('a mon no living enemy out-races is unanswered', () => {
      // A level-100 Mewtwo one-shots both bodies; their Tackles never win a
      // race against it. 648453 t13's principle: any successful entry of an
      // unanswered mon turns profit — the opponent can only sacrifice.
      const battle = makeBattle(
        [makeSet('Mewtwo', 'Mewtwo', ['Psystrike'], 100)],
        [makeSet('Rattata', 'Rattata', ['Tackle']), makeSet('Raticate', 'Raticate', ['Tackle'])],
      );
      expect(unansweredMons(battle)).toEqual({ p1: ['Mewtwo'], p2: [] });
    });

    test('a dead-even mirror names nobody — a wall that holds the pair is an answer', () => {
      // The Snorlax Tackle mirror is a 7-turn race both ways: neither mon
      // BEATS the other, and holding the pair is answer enough.
      const battle = makeBattle(
        [makeSet('A', 'Snorlax', ['Tackle'])],
        [makeSet('B', 'Snorlax', ['Tackle'])],
      );
      expect(unansweredMons(battle)).toEqual({ p1: [], p2: [] });
    });

    test('a benched answer pays the entry toll; the same answer active stands (round 13 gate)', () => {
      // The switch-in economy behind 648453 t13: a benched twin would hold
      // the standing mirror, but it answers by SWITCHING IN — eating one
      // free hit on the way — and from tolled HP it loses the race. The
      // same twin already active pays no toll and the patt stands.
      const benched = makeBattle(
        [makeSet('Mewtwo', 'Mewtwo', ['Psystrike'], 100)],
        [makeSet('Rattata', 'Rattata', ['Tackle']), makeSet('Twin', 'Mewtwo', ['Psystrike'], 100)],
      );
      expect(unansweredMons(benched)).toEqual({ p1: ['Mewtwo'], p2: [] });

      const active = makeBattle(
        [makeSet('Mewtwo', 'Mewtwo', ['Psystrike'], 100)],
        [makeSet('Twin', 'Mewtwo', ['Psystrike'], 100), makeSet('Rattata', 'Rattata', ['Tackle'])],
      );
      expect(unansweredMons(active)).toEqual({ p1: [], p2: [] });
    });
  });
});

test.describe('the healer wall is a finite race (round 11)', () => {
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
    // 0.45 ≤ 0.5: the wall holds — the healer keeps spare-turn offense.
    expect(raceClocks(attacker, healer).effFracB).toBeGreaterThan(0);
    // 0.45 + 1/16 > 0.5: sustain loses ground — the healer is pinned.
    expect(raceClocks(attacker, burned).effFracB).toBe(0);
    expect(raceClocks(attacker, burned).turnsA)
      .toBeLessThan(raceClocks(attacker, healer).turnsA);
  });

  test("the walling healer's counter-offense runs on spare turns only", () => {
    const attacker = side({ frac: 0.45 });
    const healer = side({ frac: 0.2, ...recoverer, ppBudget: 60 });
    // Under 0.45 pressure it heals 90% of turns: 0.2 × 0.1 ⇒ 50 turns.
    expect(raceClocks(attacker, healer).turnsB).toBe(50);
    // Unpressured it attacks freely: ceil(1 / 0.2) = 5.
    expect(raceClocks(side({}), healer).turnsB).toBe(5);
  });

  test('heal rates are per move, read from the dex ratio', () => {
    // A weaker heal move (Life-Dew-class 1/4) walls less than Recover: the
    // same 0.4 pressure leaves spare turns at rate 1/2 but pins at 1/4.
    const attacker = side({ frac: 0.4 });
    const strong = side({ frac: 0.2, healRate: 1 / 2, healAbsorb: 8, ppBudget: 60 });
    const weak = side({ frac: 0.2, healRate: 1 / 4, healAbsorb: 4, ppBudget: 60 });
    expect(raceClocks(attacker, strong).effFracB).toBeGreaterThan(0);
    expect(raceClocks(attacker, weak).effFracB).toBe(0);
  });

  test('held heal PP realizes only at the pin efficiency — healing now beats holding (round 12)', () => {
    // Under 1.0 incoming a rate-1/2 healer heals at a net loss: its held
    // PP realize at healRate/incoming = 1/2 efficiency, while HP already
    // on the body counts in full. Same hp+absorb total (3.0 bars), but the
    // body that already healed survives longer — the conservation that
    // priced 655336 t26's Slack Off a mere 0.041 over a free-turn Protect
    // is broken on purpose.
    const attacker = side({ frac: 1.0 });
    const held = side({ frac: 0.2, healRate: 0.5, healAbsorb: 2 });
    const healed = side({ hp: 1.5, frac: 0.2, healRate: 0.5, healAbsorb: 1.5 });
    expect(raceClocks(attacker, held).turnsA).toBe(2);
    expect(raceClocks(attacker, healed).turnsA).toBe(3);
    // Below the heal rate there is no pin and the absorb realizes in full.
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
    // Fresh PP and no burn: the wall holds and the chip race favors Toxapex.
    expect(endgame(false, 16)).toBeGreaterThan(0);
    // The real t138: burn breaks the sustain and 3 Recover PP cannot absorb
    // 2HKO-class pressure — the last pair belongs to the attacker.
    expect(endgame(true, 3)).toBeLessThan(0);
  });
});
