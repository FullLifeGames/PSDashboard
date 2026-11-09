import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeTurn } from '../src/analysis';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import type { EvalCellValue, EvalSettings, MctsTreeStats } from '../src/types';
import type { PlayedTurn } from '../src/played';

/**
 * Round 89 (T322, #59): the trust rule of the blend path on the trees of production searches. Each merge fixture holds
 * the trees of one search (stripped to what the merge reads) and its verified cells, captured on 8976c749 by the
 * round's probe `t322-capture.vt.ts`; replaying `mergeMctsTrees` reproduces the capture's game value before the rule
 * and gives the rule's value after it. The scenes are the ones the issue names: the flagship Doubles OU 2694111300
 * turn 13 (Swords Dance into Thunderbolt, read by its distance to the reference -0.983 of 16 trees of 9,600
 * iterations, round 86's A12 and A14), the players' pools of 573756 t138 and draft t56, and 655336 t24, where the
 * depth floor kept the sampler and the verdict kept Dragon Dance level with Dragon Claw.
 */

interface Fixture {
  scene: string;
  trees: MctsTreeStats[];
  verified: (EvalCellValue & { i: number; j: number })[];
  gameValue?: number;
}

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/merge/${name}.json`, import.meta.url), 'utf-8')) as Fixture;

/** The merged value of the cell with these labels (a label pair names one verified cell of each fixture). */
function merged(name: string, p1: string, p2: string): { value: number; game: number } {
  const fx = fixture(name);
  const verified = new Map(fx.verified.map(cell => [cellKey(cell.i, cell.j), cell]));
  const result = mergeMctsTrees(fx.trees, verified);
  const tree = fx.trees[0];
  const i = tree.p1Options.findIndex(option => option.label === p1);
  const j = tree.p2Options.findIndex(option => option.label === p2);
  expect(i, `${p1} in ${name}`).toBeGreaterThanOrEqual(0);
  expect(j, `${p2} in ${name}`).toBeGreaterThanOrEqual(0);
  return { value: result.matrix!.values[i][j], game: result.gameValue };
}

describe('merge scenes under the trust rule (round 89, T322)', () => {
  test('Doubles OU 2694111300 t13: Swords Dance into Thunderbolt sits by the reference -0.983', () => {
    // The base reads -0.938 (distance 0.045); the rule reads -0.940. A tree of 600 iterations lies 0.03 to 0.04 short of
    // its asymptote (A14), so the row reads the distance and not the reference's own standard error.
    const { value } = merged('do2694111300t13', 'Swords Dance', 'Thunderbolt');
    expect(Math.abs(value - -0.983)).toBeLessThan(0.05);
    expect(Math.abs(merged('do2694111300t13', 'Kowtow Cleave', 'Thunderbolt').value - -0.983)).toBeLessThan(0.06);
  });

  test('573756 t138: the played-out pools stand (the game reads -0.970)', () => {
    expect(Math.abs(merged('s573756t138', 'Toxic', 'Close Combat').game - -0.970)).toBeLessThan(0.005);
  });

  test('draft t56: Ice Beam into Draco Meteor keeps its value', () => {
    expect(Math.abs(merged('sdraftt56', 'Ice Beam', 'Draco Meteor').value - -0.568)).toBeLessThan(0.01);
  });
});

interface PositionFixture {
  serialized: string;
  keepPlayed: EvalSettings['keepPlayed'];
  replaySettings: { tera: EvalSettings['tera']; sleepClause: boolean; ruleset: string };
}

describe('655336 t24: Dragon Dance stays level with Dragon Claw (round 89, T322)', () => {
  const position = JSON.parse(
    readFileSync(new URL('./fixtures/merge/s655336t24-pos.json', import.meta.url), 'utf-8'),
  ) as PositionFixture;

  test('the played Dragon Dance is no misplay and sits near the best row', { timeout: 300_000 }, async () => {
    const settings: EvalSettings = {
      depth: 1, samples: 1, mode: 'mcts', tera: position.replaySettings.tera, sleepClause: position.replaySettings.sleepClause,
      keepPlayed: position.keepPlayed ?? undefined, ruleset: position.replaySettings.ruleset,
    };
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(position.serialized), settings);
    const played = position.keepPlayed as unknown as PlayedTurn;
    const analysis = analyzeTurn({
      turn: 24, result, played, playedOutcome: null, scoreBefore: result.score, scoreAfter: null, sacks: {},
    });
    const row = (label: string) => result.perSide.p1.find(choice => choice.label === label)!.ev;
    // The base reads Dragon Dance 0.299 against Dragon Claw -0.323 (regret 0, no tier). The rule lifts the Dragon Dance
    // pool to 0.408 and Dragon Claw to -0.018, so the played row stays the best one and its lead does not widen.
    expect(analysis.p1.tier).toBeUndefined();
    expect(analysis.p1.regret).toBeLessThan(0.05);
    expect(row('Dragon Dance') - row('Dragon Claw')).toBeLessThan(0.62);
  });
});
