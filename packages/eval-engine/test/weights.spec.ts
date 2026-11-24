import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHAMPIONS_DOUBLES_FEATURE_WEIGHTS,
  CHAMPIONS_FEATURE_WEIGHTS,
  DOUBLES_FEATURE_WEIGHTS,
  FEATURE_WEIGHTS,
  VGC_DOUBLES_FEATURE_WEIGHTS,
  createMatchupCache,
  evaluatePosition,
  featureWeights,
  EVAL_WEIGHTS,
  evalFeatures,
  type EvalFeatures,
} from '../src/eval-function';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { forkBattle } from '../src/forward/position';
import { repairFaintedActives } from '../src/forward/switches';
import { createLocalExecutor, searchPosition } from '../src/search';
import { mctsSearch } from '../src/mcts';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { forcedWinInput } from '../src/search/forced-win-apply';
import type { EvalSettings } from '../src/types';
import type { StaticRuleset } from '../src/eval-function';
import type { Battle } from '@pkmn/sim';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * The static weighs its features with the table of the replay's rule set (Pokémon Champions or standard) and game type; the host names the rule set
 * (EvalSettings.ruleset), every search carries it to its leaves through the matchup cache, and executors are bound to one.
 */

const position = (name: string) =>
  (JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as { serialized: string }).serialized;
const SINGLES = 'gen9ou-2658658993-t2';
const DOUBLES = 'gen9doublesou-2663093831-t12';

/** Until their own fit the Champions tables copy the standard ones; a test gives them a matchup weight of their own. */
function withChampionsMatchup<T>(value: number, run: () => T): T {
  const saved = [CHAMPIONS_FEATURE_WEIGHTS.matchup, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS.matchup];
  CHAMPIONS_FEATURE_WEIGHTS.matchup = value;
  CHAMPIONS_DOUBLES_FEATURE_WEIGHTS.matchup = value;
  try {
    return run();
  } finally {
    [CHAMPIONS_FEATURE_WEIGHTS.matchup, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS.matchup] = saved;
  }
}

function withChampionsTables<T>(weights: Partial<typeof FEATURE_WEIGHTS>, run: () => T): T {
  const saved = [{ ...CHAMPIONS_FEATURE_WEIGHTS }, { ...CHAMPIONS_DOUBLES_FEATURE_WEIGHTS }];
  Object.assign(CHAMPIONS_FEATURE_WEIGHTS, weights);
  Object.assign(CHAMPIONS_DOUBLES_FEATURE_WEIGHTS, weights);
  try {
    return run();
  } finally {
    Object.assign(CHAMPIONS_FEATURE_WEIGHTS, saved[0]);
    Object.assign(CHAMPIONS_DOUBLES_FEATURE_WEIGHTS, saved[1]);
  }
}

async function withChampionsMatchupAsync<T>(value: number, run: () => Promise<T>): Promise<T> {
  const saved = [CHAMPIONS_FEATURE_WEIGHTS.matchup, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS.matchup];
  CHAMPIONS_FEATURE_WEIGHTS.matchup = value;
  CHAMPIONS_DOUBLES_FEATURE_WEIGHTS.matchup = value;
  try {
    return await run();
  } finally {
    [CHAMPIONS_FEATURE_WEIGHTS.matchup, CHAMPIONS_DOUBLES_FEATURE_WEIGHTS.matchup] = saved;
  }
}

const settings = (ruleset: StaticRuleset, extra: Partial<EvalSettings> = {}): EvalSettings =>
  ({ depth: 1, samples: 1, ruleset, prove: false, ...extra });

describe('static rule set', () => {
  test('featureWeights picks the table of the rule set and the game type', () => {
    expect(featureWeights(false)).toBe(FEATURE_WEIGHTS);
    expect(featureWeights(true)).toBe(DOUBLES_FEATURE_WEIGHTS);
    expect(featureWeights(false, 'champions')).toBe(CHAMPIONS_FEATURE_WEIGHTS);
    expect(featureWeights(true, 'champions')).toBe(CHAMPIONS_DOUBLES_FEATURE_WEIGHTS);
    expect(featureWeights(true, 'vgc')).toBe(VGC_DOUBLES_FEATURE_WEIGHTS);
    expect(featureWeights(false, 'vgc')).toBe(FEATURE_WEIGHTS);
  });

  // VGC keeps the hand doubles table while Doubles OU takes its fit; a VGC singles game reads the singles table.
  test('a VGC cache weighs doubles by the VGC table and singles by the singles table', () => {
    const doubles = positionBattle(createRootPosition(position(DOUBLES)));
    expect(evaluatePosition(doubles, createMatchupCache('vgc'))).not.toBe(evaluatePosition(doubles, createMatchupCache('standard')));
    const singles = positionBattle(createRootPosition(position(SINGLES)));
    expect(evaluatePosition(singles, createMatchupCache('vgc'))).toBe(evaluatePosition(singles, createMatchupCache('standard')));
  });

  test('the static weighs by the rule set its cache names, a plain Map reads as standard', () => {
    for (const name of [SINGLES, DOUBLES]) {
      const battle = positionBattle(createRootPosition(position(name)));
      const standard = evaluatePosition(battle, createMatchupCache('standard'));
      expect(evaluatePosition(battle, new Map())).toBe(standard);
      const champions = withChampionsMatchup(FEATURE_WEIGHTS.matchup + 400, () => evaluatePosition(battle, createMatchupCache('champions')));
      expect(champions).not.toBe(standard);
      expect(withChampionsMatchup(FEATURE_WEIGHTS.matchup + 400, () => evaluatePosition(battle, createMatchupCache('standard')))).toBe(standard);
    }
  });

  test('the matrix search and the tree read the rule set at their leaves', () => {
    for (const name of [SINGLES, DOUBLES]) {
      const serialized = position(name);
      const matrix = (ruleset: StaticRuleset) => searchPosition(serialized, settings(ruleset)).score;
      const tree = (ruleset: StaticRuleset) => mctsSearch(serialized, settings(ruleset, { mode: 'mcts' })).score;
      const [matrixStandard, treeStandard] = [matrix('standard'), tree('standard')];
      withChampionsMatchup(FEATURE_WEIGHTS.matchup + 400, () => {
        expect(matrix('champions')).not.toBe(matrixStandard);
        expect(tree('champions')).not.toBe(treeStandard);
        expect(matrix('standard')).toBe(matrixStandard);
      });
    }
    // Three matrix searches and two trees per game type take 25 s with the speed layer forced off on a quiet
    // machine (11 s with it on) and run past the default 60 s in the full EVAL_SIM_FAST=0 suite.
  }, 180_000);

  test('a local executor serves its cells under the rule set it is bound to', async () => {
    const serialized = position(DOUBLES);
    const choices = await createLocalExecutor(serialized).choices(true);
    const job = { i: 0, j: 0, p1Choice: choices.p1[0].choice, p2Choice: choices.p2[0].choice, samples: 1 };
    const standard = (await createLocalExecutor(serialized, 'standard').evalCells([job]))[0].value;
    const champions = await withChampionsMatchupAsync(FEATURE_WEIGHTS.matchup + 400, async () =>
      (await createLocalExecutor(serialized, 'champions').evalCells([job]))[0].value);
    expect(champions).not.toBe(standard);
  });

  test('the orchestrated trees read the rule set of the executor and the settings', async () => {
    const serialized = position(SINGLES);
    const run = (ruleset: StaticRuleset) =>
      searchTreesOrchestrated(createLocalTreeExecutor(serialized, ruleset), settings(ruleset, { mode: 'mcts' }));
    const standard = (await run('standard')).score;
    const champions = await withChampionsMatchupAsync(FEATURE_WEIGHTS.matchup + 400, async () => (await run('champions')).score);
    expect(champions).not.toBe(standard);
    // Two orchestrated trees take 80 to 108 s with the speed layer forced off on devbox; 180 s is its neighbour's bound.
  }, 180_000);

  // The greedy replacement after a knock-out (matrix cells, a pivot without a follow-up, prover cells, the repair on deserialization) weighs by the rule set the position carries from its root.
  test('the greedy replacement after a knock-out reads the rule set of its position', () => {
    const serialized = position('gen9ou-2658663776-t2');
    const replacement = (ruleset: StaticRuleset) => {
      const battle = forkBattle(createRootPosition(serialized, ruleset), '1,2,3,4');
      const active = battle.sides[0].active[0];
      active.hp = 0;
      active.fainted = true;
      repairFaintedActives(battle);
      return battle.sides[0].active[0].species.name;
    };
    const standard = replacement('standard');
    const skewed = { matchup: 2000, bodies: 20 };
    expect(withChampionsTables(skewed, () => replacement('champions'))).not.toBe(standard);
    expect(withChampionsTables(skewed, () => replacement('standard'))).toBe(standard);
  });

  test('the prover input carries the rule set', () => {
    const result = searchPosition(position(SINGLES), settings('champions'));
    expect(forcedWinInput(result, settings('champions')).ruleset).toBe('champions');
    expect(forcedWinInput(result, { depth: 1, samples: 1 }).ruleset).toBeUndefined();
  });
});

const FORMAT = 'gen9doublescustomgame';
const KEYS = Object.keys(VGC_DOUBLES_FEATURE_WEIGHTS) as (keyof EvalFeatures)[];

const scoreOf = (battle: Battle, weights: Record<keyof EvalFeatures, number>): number => {
  const features = evalFeatures(battle, createMatchupCache('vgc'));
  const diff = KEYS.reduce((sum, key) => sum + weights[key] * features[key], 0);
  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  return Math.tanh((diff / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp))) * EVAL_WEIGHTS.scale);
};

/** Mirror teams that trade hits at equal speed, so that a doubled speed on one side turns the move order of every race. */
function board(tailwindOnP1: boolean): Battle {
  const mon = () => set('Garchomp', ['earthquake', 'outrage'], { ability: 'Rough Skin', item: 'Leftovers', evs: { hp: 252, atk: 252, def: 4, spa: 0, spd: 0, spe: 0 } });
  const battle = battleOf(FORMAT, [mon(), mon()], [mon(), mon()]);
  if (tailwindOnP1) battle.sides[0].addSideCondition('tailwind', battle.sides[0].active[0]!);
  return battle;
}

describe('the SV VGC table (round 69, T144)', () => {
  test('tailwind and coverage are 0, the refit columns carry the fit, the rest stays', () => {
    const w = VGC_DOUBLES_FEATURE_WEIGHTS;
    expect([w.tailwind, w.coverage]).toEqual([0, 0]);
    expect([w.bodies, w.screens, w.matchup, w.trickRoom]).toEqual([177, 48, 169, 54]);
    // Held at the hand values: hazards (R2 flagged), choice mismatch (hold). The pair cell is 0: its 0/1 gate made the VGC score fall as a foe took damage in 24 of 103 HP series.
    expect([w.hazards, w.choiceMismatch, w.pairFocus]).toEqual([0.75, 40, 0]);
    // The damped boost column replaces the flat one (REPLACEMENT, 20 of 20 seeds once drops count).
    expect([w.boosts, w.boostsBiting]).toEqual([0, 16]);
    expect([w.sweepFastKo, w.sweepFastChip, w.sweepSlowKo, w.sweepSlowChip, w.pairRedirect, w.statusFix]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('the other tables keep their Tailwind and Coverage', () => {
    expect(FEATURE_WEIGHTS.tailwind).toBe(8);
    expect(FEATURE_WEIGHTS.coverage).toBe(40);
  });

  test('the flag follows the simulator: Tailwind lasts four turns, the turn it is set included', () => {
    const user = set('Whimsicott', ['tailwind', 'splash'], { ability: 'Prankster' });
    const battle = battleOf(FORMAT, [user, set('Snorlax', ['splash'])], [set('Snorlax', ['splash']), set('Snorlax', ['splash'])]);
    const flags: number[] = [];
    for (let turn = 0; turn < 5; turn++) {
      battle.choose('p1', turn === 0 ? 'move 1, move 1' : 'move 2, move 1');
      battle.choose('p2', 'move 1, move 1');
      flags.push(evalFeatures(battle, createMatchupCache('vgc')).tailwind);
    }
    expect(flags).toEqual([1, 1, 1, 0, 0]);
  });

  test('a one-sided Tailwind is read by the flag and by the matchup, and the VGC score has no weight on the flag', () => {
    const plain = board(false);
    const fast = board(true);
    const cache = () => createMatchupCache('vgc');
    const [off, on] = [evalFeatures(plain, cache()), evalFeatures(fast, cache())];
    // The flag is the simulator's side condition.
    expect(off.tailwind).toBe(0);
    expect(on.tailwind).toBe(1);
    // The matchup already moves with the doubled speed, in the Tailwind side's favour.
    expect(on.matchup).toBeGreaterThan(off.matchup);
    // The score is the weighted sum at the table, where the flag has no weight.
    expect(evaluatePosition(fast, cache())).toBeCloseTo(scoreOf(fast, VGC_DOUBLES_FEATURE_WEIGHTS), 12);
    // With a flag weight the same board would read higher (the flag priced the speed twice).
    expect(scoreOf(fast, { ...VGC_DOUBLES_FEATURE_WEIGHTS, tailwind: 68 })).toBeGreaterThan(evaluatePosition(fast, cache()));
    expect(VGC_DOUBLES_FEATURE_WEIGHTS.tailwind).toBe(0);
  });
});
