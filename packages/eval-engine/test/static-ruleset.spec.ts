import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CHAMPIONS_DOUBLES_FEATURE_WEIGHTS, CHAMPIONS_FEATURE_WEIGHTS, DOUBLES_FEATURE_WEIGHTS, FEATURE_WEIGHTS,
  VGC_DOUBLES_FEATURE_WEIGHTS, createMatchupCache, evaluatePosition, featureWeights,
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

/**
 * Round 65: the static weighs its features with the table of the replay's
 * rule set (Pokémon Champions or standard) and game type; the host names
 * the rule set (EvalSettings.ruleset), every search carries it to its
 * leaves through the matchup cache, and executors are bound to one.
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

/** The Champions tables with some weights of their own for one call (both game types). */
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

  // Round 65 gate (2b): VGC keeps the hand doubles table while Doubles OU takes its fit; a VGC singles game reads the singles table.
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
  });

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
  });

  // Review fix: the greedy replacement after a knock-out (matrix cells, a pivot without a follow-up, prover cells, the repair on deserialization) weighs by the rule set the position carries from its root.
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
