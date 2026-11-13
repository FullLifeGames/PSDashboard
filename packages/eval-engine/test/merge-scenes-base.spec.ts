import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import type { EvalCellValue, MctsTreeStats } from '../src/types';

/**
 * Round 89 (T322, #59): the merge on the trees of production searches. Each merge fixture holds the trees of one search
 * (stripped to what the merge reads) and its verified cells, captured on 8976c749 by the round's probe
 * `t322-capture.vt.ts` (the trees carry no `classWeight`, so block 1's keyed cell stays out and the rows replay the base
 * merge). Replaying `mergeMctsTrees` reproduces the capture's game value. The scenes are the ones the issue names: the
 * flagship Doubles OU 2694111300 turn 13 (Swords Dance into Thunderbolt, read by its distance to the reference -0.983 of 16
 * trees of 9,600 iterations, round 86's A12 and A14) and the players' pools of 573756 t138 and draft t56. The trust rule
 * these rows were written for failed its bar and left the lane (A10); the rows stay as guards of the base merge.
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

describe('merge scenes on production trees (round 89, T322)', () => {
  test('Doubles OU 2694111300 t13: Swords Dance into Thunderbolt sits by the reference -0.983', () => {
    // The merge reads -0.938 (distance 0.045). A tree of 600 iterations lies 0.03 to 0.04 short of its asymptote (A14),
    // so the row reads the distance and not the reference's own standard error.
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
