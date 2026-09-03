import { test, expect } from '@playwright/test';
import { mergeMctsTrees, starvedSupportCells, VERIFY_SAMPLES } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import type { MctsTreeStats } from '../src/types';

/**
 * The MCTS root merge on synthetic trees: pooled cell means and the
 * equilibrium ranking over them, the starved-support verification (round 7:
 * which cells are chance-suspect, how the sampler's values replace them),
 * and the value rule that keeps a rich pool's depth under verification
 * (round 32). Moved here from eval-search.spec.ts when that file reached
 * its size pin.
 */

test.describe('mcts merge pools tree-informed cells', () => {
  const options = (labels: string[]) => labels.map(labelText => ({ choice: labelText, label: labelText }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
  test('the merged ranking solves the pooled matrix', () => {
    const mk = (marginals: Pick<MctsTreeStats, 'p1N' | 'p1W' | 'p2N' | 'p2W'>, cells: MctsTreeStats['cells']): MctsTreeStats => ({
      p1Options: options(['A', 'B']), p2Options: options(['X', 'Y']),
      ...marginals, visits: 10, depth: 2,
      rootValue: 0.1, cells, result: emptyResult,
    });
    const t1 = mk({ p1N: [10, 0], p1W: [6, 0], p2N: [10, 0], p2W: [6, 0] }, [
      { key: 0, visits: 8, total: 4.8, value: 0.5, ended: false },
      { key: 1, visits: 2, total: 0.4, value: 0.2, ended: false },
    ]);
    const t2 = mk({ p1N: [0, 5], p1W: [0, -2], p2N: [5, 0], p2W: [-2, 0] }, [
      { key: 0, visits: 2, total: 1.0, value: 0.5, ended: false },
      { key: 10_000, visits: 3, total: -0.9, value: -0.4, ended: false },
    ]);
    const merged = mergeMctsTrees([t1, t2]);
    expect(merged.matrix).toBeTruthy();
    // Pooled cell means with ONE static prior: (Σtotal + value)/(Σvisits + 1);
    // the (B,Y) cell no tree expanded falls back to the root static.
    expect(merged.matrix!.values[0][0]).toBeCloseTo((4.8 + 1.0 + 0.5) / 11, 10);
    expect(merged.matrix!.values[0][1]).toBeCloseTo((0.4 + 0.2) / 3, 10);
    expect(merged.matrix!.values[1][0]).toBeCloseTo((-0.9 - 0.4) / 4, 10);
    expect(merged.matrix!.values[1][1]).toBeCloseTo(0.1, 10);
    // Row A dominates the pooled game — the equilibrium ranking says so.
    expect(merged.perSide.p1[0].label).toBe('A');
    expect(merged.perSide.p1.length).toBe(2);
    // HYBRID: the merged score is the summed-marginal visit-mean formula —
    // top-visited p1 mean 6/10, top-visited p2 mean (6−2)/15.
    expect(merged.score).toBeCloseTo((6 / 10 + 4 / 15) / 2, 10);
    expect(merged.interval).toBeCloseTo(Math.abs(4 / 15 - 6 / 10), 10);
  });
});

test.describe('starved support cells are verified before the verdict', () => {
  // Draft t56 mechanism in miniature: each root cell fixes ONE chance
  // outcome per tree, so a 1-2 visit cell can carry a lucky sample (the
  // Draco Meteor that missed) and the equilibrium solve trusts it at face
  // value — the sack row dominates on noise. The fix: cells the solve's
  // support leans on with too few pooled visits are re-priced by the matrix
  // mode's multi-seed cell sampler and REPLACE the tree value.
  const options = (labels: string[]) => labels.map(labelText => ({ choice: labelText, label: labelText }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
  const mk = (marginals: Pick<MctsTreeStats, 'p1N' | 'p1W' | 'p2N' | 'p2W'>, cells: MctsTreeStats['cells'], extra: Partial<MctsTreeStats> = {}): MctsTreeStats => ({
    p1Options: options(['Safe', 'Sack']), p2Options: options(['X', 'Y']),
    ...marginals, visits: 25, depth: 2,
    rootValue: 0.5, cells, result: emptyResult, ...extra,
  });
  // Row Safe: well-visited, converged at −0.2. Row Sack: (Sack,X) starved
  // at 2+1 visits with a lucky +0.5; (Sack,Y) never expanded (reads the
  // rosy root static 0.5).
  const t1 = mk({ p1N: [20, 2], p1W: [-4, 1], p2N: [20, 2], p2W: [-4, 1] }, [
    { key: cellKey(0, 0), visits: 12, total: -2.4, value: -0.2, ended: false },
    { key: cellKey(0, 1), visits: 8, total: -1.6, value: -0.2, ended: false },
    { key: cellKey(1, 0), visits: 2, total: 1.0, value: 0.5, ended: false },
  ]);
  const t2 = mk({ p1N: [18, 1], p1W: [-3.6, 0.5], p2N: [18, 1], p2W: [-3.6, 0.5] }, [
    { key: cellKey(0, 0), visits: 10, total: -2.0, value: -0.2, ended: false },
    { key: cellKey(0, 1), visits: 9, total: -1.8, value: -0.2, ended: false },
    { key: cellKey(1, 0), visits: 1, total: 0.5, value: 0.5, ended: false },
  ]);

  test('the unverified solve trusts the lucky starved row (the bug mechanism)', () => {
    const merged = mergeMctsTrees([t1, t2]);
    expect(merged.perSide.p1[0].label).toBe('Sack');
  });

  test('starvedSupportCells flags starved and unexpanded support, not converged cells', () => {
    const merged = mergeMctsTrees([t1, t2]);
    const jobs = starvedSupportCells([t1, t2], merged);
    const pairs = jobs.map(job => `${job.p1Choice}×${job.p2Choice}`);
    expect(pairs).toContain('Sack×X'); // 3 pooled visits < floor
    expect(pairs).toContain('Sack×Y'); // never expanded
    expect(pairs).not.toContain('Safe×X'); // 22 pooled visits — converged
    expect(pairs).not.toContain('Safe×Y'); // 17 pooled visits — converged
    for (const job of jobs) expect(job.samples).toBe(VERIFY_SAMPLES);
  });

  test('verified values replace starved cells and the re-solve demotes the sack', () => {
    const unverified = mergeMctsTrees([t1, t2]);
    const verified = new Map([
      [cellKey(1, 0), { i: 1, j: 0, value: -0.8, ended: false }],
      [cellKey(1, 1), { i: 1, j: 1, value: -0.8, ended: false }],
    ]);
    const merged = mergeMctsTrees([t1, t2], verified);
    expect(merged.matrix!.values[1][0]).toBeCloseTo(-0.8, 10); // replaced, not pooled
    expect(merged.matrix!.values[1][1]).toBeCloseTo(-0.8, 10);
    expect(merged.perSide.p1[0].label).toBe('Safe');
    // HYBRID: the score is the summed-marginal visit-mean — verification
    // must not move it (records stay comparable).
    expect(merged.score).toBeCloseTo(unverified.score, 10);
  });

  test('trees that DISAGREE on a well-visited cell flag it too', () => {
    // Visits measure subtree exploration, not chance samples — a cell with
    // plenty of pooled visits still carries at most one transition outcome
    // per tree. Here (Safe,Y) has 19 pooled visits in both trees but the
    // trees saw opposite outcomes (−0.33 vs +0.36) — chance-suspect.
    const d1 = mk({ p1N: [20, 2], p1W: [-4, 1], p2N: [20, 2], p2W: [-4, 1] }, [
      { key: cellKey(0, 0), visits: 12, total: -2.4, value: -0.2, ended: false },
      { key: cellKey(0, 1), visits: 10, total: -3.3, value: -0.3, ended: false },
      { key: cellKey(1, 0), visits: 20, total: -4.0, value: -0.2, ended: false },
    ]);
    const d2 = mk({ p1N: [18, 1], p1W: [-3.6, 0.5], p2N: [18, 1], p2W: [-3.6, 0.5] }, [
      { key: cellKey(0, 0), visits: 10, total: -2.0, value: -0.2, ended: false },
      { key: cellKey(0, 1), visits: 9, total: 3.3, value: 0.3, ended: false },
      { key: cellKey(1, 0), visits: 20, total: -4.0, value: -0.2, ended: false },
    ]);
    const merged = mergeMctsTrees([d1, d2]);
    const pairs = starvedSupportCells([d1, d2], merged).map(job => `${job.p1Choice}×${job.p2Choice}`);
    expect(pairs).toContain('Safe×Y'); // agreeing visits, disagreeing outcomes
    expect(pairs).not.toContain('Safe×X'); // both trees agree at −0.2
  });

  test('boundary support cells are chance-suspect regardless of visit stats (round 7)', () => {
    // (Safe,X) is rich and agreeing — the visit/spread rules trust it. But
    // as a boundary cell its K fixed outcomes cannot represent an
    // accuracy×killFraction split: suspect by construction.
    const cells = [
      { key: cellKey(0, 0), visits: 12, total: -2.6, value: -0.2, ended: false },
      { key: cellKey(0, 1), visits: 8, total: -1.8, value: -0.2, ended: false },
      { key: cellKey(1, 0), visits: 20, total: -4.2, value: -0.2, ended: false },
      { key: cellKey(1, 1), visits: 20, total: -4.2, value: -0.2, ended: false },
    ];
    const b1 = mk({ p1N: [20, 2], p1W: [-4, 1], p2N: [20, 2], p2W: [-4, 1] }, cells, { boundaryCells: [cellKey(0, 0)] });
    const b2 = mk({ p1N: [18, 1], p1W: [-3.6, 0.5], p2N: [18, 1], p2W: [-3.6, 0.5] }, cells, { boundaryCells: [cellKey(0, 0)] });
    const merged = mergeMctsTrees([b1, b2]);
    const pairs = starvedSupportCells([b1, b2], merged).map(job => `${job.p1Choice}×${job.p2Choice}`);
    expect(pairs).toContain('Safe×X');    // boundary — must be re-priced
    expect(pairs).not.toContain('Safe×Y'); // converged, no boundary flag
  });

  test('a boundary cell that ended the game still verifies; a plain ended cell stays excluded (round 7)', () => {
    // A mutual-kill range ends the game in EVERY drawn class — the ended
    // flag is exactly why the pool cannot see the other class. Non-boundary
    // ended cells keep today's exclusion.
    const cells = [
      { key: cellKey(0, 0), visits: 1, total: 2.0, value: 1, ended: true },
      { key: cellKey(0, 1), visits: 8, total: -1.8, value: -0.2, ended: false },
      { key: cellKey(1, 0), visits: 1, total: 2.0, value: 1, ended: true },
      { key: cellKey(1, 1), visits: 20, total: -4.2, value: -0.2, ended: false },
    ];
    const e1 = mk({ p1N: [20, 2], p1W: [-4, 1], p2N: [20, 2], p2W: [-4, 1] }, cells, { boundaryCells: [cellKey(0, 0)] });
    const e2 = mk({ p1N: [18, 1], p1W: [-3.6, 0.5], p2N: [18, 1], p2W: [-3.6, 0.5] }, cells, { boundaryCells: [cellKey(0, 0)] });
    const merged = mergeMctsTrees([e1, e2]);
    const pairs = starvedSupportCells([e1, e2], merged).map(job => `${job.p1Choice}×${job.p2Choice}`);
    expect(pairs).toContain('Safe×X');     // boundary bypasses the ended exclusion
    expect(pairs).not.toContain('Sack×X'); // starved AND ended, but not boundary — excluded as today
  });

  test('verified-cell diagnostics attach sorted by (i, j) (round 7)', () => {
    // The pooled executor returns chunk results in completion order — an
    // unsorted attach would be run-nondeterministic.
    const diag = (i: number, j: number) => ({
      i, j, p1Choice: 'Sack', p2Choice: 'Y', missing: ['miss'],
      analytic: { miss: 0.2, 'hit-kill': 0.8 }, sampled: { 'hit-kill': 3 },
    });
    const verified = new Map([
      [cellKey(1, 1), { i: 1, j: 1, value: -0.1, ended: false, diagnostic: diag(1, 1) }],
      [cellKey(0, 1), { i: 0, j: 1, value: -0.1, ended: false, diagnostic: diag(0, 1) }],
      [cellKey(1, 0), { i: 1, j: 0, value: -0.1, ended: false }],
    ]);
    const merged = mergeMctsTrees([t1, t2], verified);
    expect(merged.koDiagnostics?.map(d => [d.i, d.j])).toEqual([[0, 1], [1, 1]]);
    // No verify round → no diagnostics key at all.
    expect(mergeMctsTrees([t1, t2]).koDiagnostics).toBeUndefined();
  });

  test('a rich, agreeing boundary cell keeps the tree continuation under the analytic split (round 32)', () => {
    // Four trees played (Safe,X) out to about −0.96 with plenty of visits;
    // the sampler says a 5% kill class exists (−1) and the open class reads
    // a one-ply static of +0.03. Verification must not replace depth with
    // the static (573756 t138): value ≈ 0.05·(−1) + 0.95·(−0.96).
    const rich = (offset: number) => mk({ p1N: [40, 2], p1W: [-38, 1], p2N: [40, 2], p2W: [-38, 1] }, [
      { key: cellKey(0, 0), visits: 30, total: -28.8 - offset * 0.1, value: -0.9, ended: false },
      { key: cellKey(0, 1), visits: 8, total: -1.6, value: -0.2, ended: false },
    ]);
    const trees = [rich(0), rich(1), rich(2), rich(3)];
    const blend = { firstLeaf: 0.03, classes: [
      { weight: 0.05, leafSum: -1, count: 1, hasFirst: false, ended: true },
      { weight: 0.95, leafSum: 0.09, count: 3, hasFirst: true, ended: false },
    ] };
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.02, ended: false, blend }]]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeLessThan(-0.85);
    expect(merged.matrix!.values[0][0]).toBeGreaterThan(-0.97);
  });

  test('a rich cell without a blend keeps the pooled value, a starved one takes the sampler (round 32)', () => {
    // No blend = no priceable roll at the root: the one-ply sampler has
    // nothing the played-out pool lacks, so a rich pool stands untouched. A
    // starved cell (one visit per tree) still takes the sampler as before.
    const richPlain = (offset: number) => mk({ p1N: [30, 3], p1W: [-9, 1.5], p2N: [30, 3], p2W: [-9, 1.5] }, [
      { key: cellKey(0, 0), visits: 20, total: -6 + offset * 0.2, value: -0.3, ended: false },
      { key: cellKey(1, 0), visits: 1, total: 0.5, value: 0.5, ended: false },
    ]);
    const trees = [richPlain(0), richPlain(1), richPlain(2)];
    const pooledOnly = mergeMctsTrees(trees);
    const verified = new Map([
      [cellKey(0, 0), { i: 0, j: 0, value: 0.4, ended: false }],
      [cellKey(1, 0), { i: 1, j: 0, value: -0.8, ended: false }],
    ]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(pooledOnly.matrix!.values[0][0], 10);
    expect(merged.matrix!.values[1][0]).toBeCloseTo(-0.8, 10);
  });

  test('a disagreeing boundary cell keeps the sampler blend (the round-7 case)', () => {
    // One tree rode the other outcome of a root roll: the pool's means are
    // −0.9 / 0.3 / −0.9 and cannot be assigned to classes here, so the
    // sampler's analytic blend stands exactly as before round 32.
    const split = (mean: number) => mk({ p1N: [30, 3], p1W: [30 * mean, 1.5], p2N: [30, 3], p2W: [30 * mean, 1.5] }, [
      { key: cellKey(0, 0), visits: 20, total: 21 * mean - mean, value: mean, ended: false },
    ]);
    const trees = [split(-0.9), split(0.3), split(-0.9)];
    const blend = { firstLeaf: -0.2, classes: [
      { weight: 0.9, leafSum: -0.6, count: 3, hasFirst: true, ended: false },
      { weight: 0.1, leafSum: 0.3, count: 1, hasFirst: false, ended: false },
    ] };
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.15, ended: false, blend }]]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(-0.15, 10);
  });
});
