import { test, expect, describe } from 'vitest';
import { mergeMctsTrees, rowCompletedCells, starvedSupportCells, VERIFY_DISAGREEMENT, VERIFY_SAMPLES, weightedDisagreement } from '../src/mcts-merge';
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

describe('mcts merge pools tree-informed cells', () => {
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

describe('starved support cells are verified before the verdict', () => {
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
      { key: 'hit-kill', weight: 0.05, leafSum: -1, count: 1, hasFirst: false, ended: true },
      { key: 'hit-nokill', weight: 0.95, leafSum: 0.09, count: 3, hasFirst: true, ended: false },
    ] };
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.02, ended: false, blend }]]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeLessThan(-0.85);
    expect(merged.matrix!.values[0][0]).toBeGreaterThan(-0.97);
  });

  test('a played-out cell without a blend keeps the pooled value; a middlegame or starved one takes the sampler (round 32)', () => {
    // Depth outranks the one-ply sampler only where the pool has played the
    // cell out (|continuation| at or beyond the depth floor). A rich
    // middlegame pool at −0.3 keeps the round-7 sampler (655336 t24/t26), a
    // starved cell (one visit per tree) takes the sampler as before.
    const richPlain = (offset: number, mean: number) => mk({ p1N: [30, 3], p1W: [30 * mean, 1.5], p2N: [30, 3], p2W: [30 * mean, 1.5] }, [
      { key: cellKey(0, 0), visits: 20, total: 20 * mean + offset * 0.2, value: mean, ended: false },
      { key: cellKey(1, 0), visits: 1, total: 0.5, value: 0.5, ended: false },
    ]);
    const verified = new Map([
      [cellKey(0, 0), { i: 0, j: 0, value: 0.4, ended: false }],
      [cellKey(1, 0), { i: 1, j: 0, value: -0.8, ended: false }],
    ]);
    const playedOut = [richPlain(0, -0.95), richPlain(1, -0.95), richPlain(2, -0.95)];
    const pooledOnly = mergeMctsTrees(playedOut);
    const merged = mergeMctsTrees(playedOut, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(pooledOnly.matrix!.values[0][0], 10);
    expect(merged.matrix!.values[1][0]).toBeCloseTo(-0.8, 10);
    const middlegame = [richPlain(0, -0.3), richPlain(1, -0.3), richPlain(2, -0.3)];
    expect(mergeMctsTrees(middlegame, verified).matrix!.values[0][0]).toBeCloseTo(0.4, 10);
  });

  test('a rich, agreeing boundary cell below the depth floor keeps the sampler blend (round 32)', () => {
    // 655336 t24: 528 visits agreed at +0.52 for Dragon Claw × Return while
    // the sampler's static read +0.08; a middlegame mean over exploration is
    // not a verdict, so the round-7 sampler stands.
    const mid = (offset: number) => mk({ p1N: [40, 2], p1W: [20, 1], p2N: [40, 2], p2W: [20, 1] }, [
      { key: cellKey(0, 0), visits: 30, total: 15.6 - offset * 0.1, value: 0.5, ended: false },
    ]);
    const trees = [mid(0), mid(1), mid(2), mid(3)];
    const blend = { firstLeaf: 0.08, classes: [{ key: 'hit-nokill', weight: 1, leafSum: 1.12, count: 14, hasFirst: true, ended: false }] };
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: 0.08, ended: false, blend }]]);
    expect(mergeMctsTrees(trees, verified).matrix!.values[0][0]).toBeCloseTo(0.08, 10);
  });

  test('a rich, agreeing cell with two open classes keeps the sampler blend (round 32)', () => {
    // Hit and miss both continue the game. Every tree may have drawn the
    // hit, so the pool's continuation says nothing about the miss class;
    // substituting it would erase the 10% miss (655336 t23, the round-7
    // healing). The sampler's blend stands.
    const rich = (offset: number) => mk({ p1N: [40, 2], p1W: [-38, 1], p2N: [40, 2], p2W: [-38, 1] }, [
      { key: cellKey(0, 0), visits: 30, total: -28.8 - offset * 0.1, value: -0.9, ended: false },
    ]);
    const trees = [rich(0), rich(1), rich(2), rich(3)];
    const blend = { firstLeaf: -0.2, classes: [
      { key: 'hit-nokill', weight: 0.9, leafSum: -0.6, count: 3, hasFirst: true, ended: false },
      { key: 'miss', weight: 0.1, leafSum: 0.3, count: 1, hasFirst: false, ended: false },
    ] };
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.15, ended: false, blend }]]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(-0.15, 10);
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
      { key: 'hit-nokill', weight: 0.9, leafSum: -0.6, count: 3, hasFirst: true, ended: false },
      { key: 'miss', weight: 0.1, leafSum: 0.3, count: 1, hasFirst: false, ended: false },
    ] };
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.15, ended: false, blend }]]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeCloseTo(-0.15, 10);
  });
});

describe('tree disagreement is visit-weighted (round 33)', () => {
  test('a thin outlier tree does not make a cell suspect', () => {
    // 573756 t137 Recover × Struggle: three trees near −0.84 with ~200 visits, one at −0.50 with 54.
    const entries = [
      { mean: -0.84, weight: 188 }, { mean: -0.86, weight: 210 }, { mean: -0.84, weight: 205 }, { mean: -0.50, weight: 55 },
    ];
    expect(weightedDisagreement(entries)).toBeLessThan(VERIFY_DISAGREEMENT);
  });

  test("draft t56's lucky-miss tree still reads as disagreement", () => {
    const entries = [
      { mean: -0.38, weight: 30 }, { mean: 0.37, weight: 30 }, { mean: -0.34, weight: 30 }, { mean: -0.37, weight: 30 },
    ];
    expect(weightedDisagreement(entries)).toBeGreaterThan(VERIFY_DISAGREEMENT);
  });

  test('two equal camps at the old spread sit exactly at the threshold', () => {
    expect(weightedDisagreement([{ mean: 0.1, weight: 10 }, { mean: 0.25, weight: 10 }])).toBeCloseTo(VERIFY_DISAGREEMENT, 10);
  });

  test('a played-out pool with one thin outlier keeps its depth in the merge (573756 t137)', () => {
    // Four trees on (Safe,X): three deep at about −0.94 with 200 visits, one
    // thin at −0.70 with 54; the sampler's one-ply static reads +0.06. The
    // old max−min rule (0.24 > 0.15) handed the cell to the static.
    const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
    const emptyResult = { score: 0, interval: 0, depthCompleted: 2, perSide: { p1: [], p2: [] } };
    const mk = (visits: number, mean: number): MctsTreeStats => ({
      p1Options: options(['Safe', 'Sack']), p2Options: options(['X', 'Y']),
      p1N: [visits, 2], p1W: [visits * mean, 1], p2N: [visits, 2], p2W: [visits * mean, 1],
      visits: visits + 2, depth: 2, rootValue: 0.5, result: emptyResult,
      cells: [{ key: cellKey(0, 0), visits, total: mean * (visits + 1) + 0.8, value: -0.8, ended: false }],
    });
    const trees = [mk(187, -0.93), mk(209, -0.95), mk(204, -0.93), mk(54, -0.70)];
    const verified = new Map([[cellKey(0, 0), { i: 0, j: 0, value: 0.06, ended: false }]]);
    const merged = mergeMctsTrees(trees, verified);
    expect(merged.matrix!.values[0][0]).toBeLessThan(-0.85);
  });
});

describe('per-class continuation (round 33)', () => {
  const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 2, perSide: { p1: [], p2: [] } };
  const mk = (cells: MctsTreeStats['cells']): MctsTreeStats => ({
    p1Options: options(['Safe', 'Sack']), p2Options: options(['X', 'Y']),
    p1N: [40, 2], p1W: [-30, 1], p2N: [40, 2], p2W: [-30, 1],
    visits: 42, depth: 2, rootValue: 0.5, cells, result: emptyResult,
  });
  // Fire Fang × Recover in miniature: hit-nokill (0.95·(1−k)) and miss (0.05) both open.
  // Trees 1–3 drew the hit and played it out to about −0.96; tree 4 drew the miss and sits at +0.2.
  const cell = (visits: number, mean: number, classKey?: string) => ({
    key: cellKey(0, 0), visits, total: mean * (visits + 1) - (-0.1), value: -0.1, ended: false,
    ...(classKey ? { classKey } : {}),
  });
  const blend = { firstLeaf: -0.1, classes: [
    { key: 'hit-nokill', weight: 0.8, leafSum: -0.3, count: 3, hasFirst: true, ended: false },
    { key: 'miss', weight: 0.2, leafSum: 0.6, count: 3, hasFirst: false, ended: false },
  ] };

  test('a rich hit class keeps its tree depth while the thin miss class takes the sampler mean', () => {
    const trees = [
      mk([cell(120, -0.96, 'hit-nokill')]), mk([cell(110, -0.95, 'hit-nokill')]),
      mk([cell(130, -0.97, 'hit-nokill')]), mk([cell(40, 0.2, 'miss')]),
    ];
    const merged = mergeMctsTrees(trees, new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.04, ended: false, blend }]]));
    // 0.8 · pooled hit continuation (≈ −0.96) + 0.2 · sampler miss mean (0.2)
    expect(merged.matrix!.values[0][0]).toBeCloseTo(0.8 * -0.96 + 0.2 * 0.2, 1);
    // The old one-open-class rule kept the sampler's −0.15 here: two open classes, no assignment.
    expect(merged.matrix!.values[0][0]).toBeLessThan(-0.6);
  });

  test('unkeyed trees join the only open class, never a two-class blend', () => {
    const unkeyed = [mk([cell(120, -0.96)]), mk([cell(110, -0.95)]), mk([cell(130, -0.97)])];
    const oneOpen = { firstLeaf: -0.1, classes: [
      { key: 'hit-kill', weight: 0.3, leafSum: -1, count: 1, hasFirst: false, ended: true },
      { key: 'hit-nokill', weight: 0.7, leafSum: -0.3, count: 3, hasFirst: true, ended: false },
    ] };
    const one = mergeMctsTrees(unkeyed, new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.37, ended: false, blend: oneOpen }]]));
    expect(one.matrix!.values[0][0]).toBeCloseTo(0.3 * -1 + 0.7 * -0.96, 1);
    const two = mergeMctsTrees(unkeyed, new Map([[cellKey(0, 0), { i: 0, j: 0, value: -0.04, ended: false, blend }]]));
    // The sampler's own blend mean: 0.8 · (−0.3/3) + 0.2 · (0.6/3).
    expect(two.matrix!.values[0][0]).toBeCloseTo(-0.04, 10);
  });
});

describe('row completion for the verify step (round 33)', () => {
  const options = (labels: string[]) => labels.map(label => ({ choice: label, label }));
  const emptyResult = { score: 0, interval: 0, depthCompleted: 2, perSide: { p1: [], p2: [] } };
  // Row A: (A,X) rich at 60 pooled visits, (A,Y) starved (one visit per
  // tree), (A,Z) middling (15 pooled: trusted, not rich). Row B: rich all along.
  const cell = (i: number, j: number, visits: number, mean: number) =>
    ({ key: cellKey(i, j), visits, total: mean * (visits + 1) - mean, value: mean, ended: false });
  const mk = (): MctsTreeStats => ({
    p1Options: options(['A', 'B']), p2Options: options(['X', 'Y', 'Z']),
    p1N: [26, 60], p1W: [-5, -12], p2N: [40, 21, 25], p2W: [-8, -4, -5],
    visits: 86, depth: 2, rootValue: 0.1, result: emptyResult,
    cells: [
      cell(0, 0, 20, -0.2), cell(0, 1, 1, 0.4), cell(0, 2, 5, -0.2),
      cell(1, 0, 20, -0.2), cell(1, 1, 20, -0.2), cell(1, 2, 20, -0.2),
    ],
  });
  const trees = [mk(), mk(), mk()];

  test('support cells sharing a row or column with a rich cell join the verify jobs behind the starved ones', () => {
    const merged = mergeMctsTrees(trees);
    const starved = starvedSupportCells(trees, merged);
    const starvedPairs = starved.map(job => `${job.p1Choice}×${job.p2Choice}`);
    expect(starvedPairs).toEqual(['A×Y']);
    const jobs = rowCompletedCells(trees, merged, starved);
    const pairs = jobs.map(job => `${job.p1Choice}×${job.p2Choice}`);
    expect(pairs.slice(0, starved.length)).toEqual(starvedPairs); // originals first
    expect(pairs).toContain('A×Z');     // same row as the rich (A,X), not rich itself
    expect(pairs).not.toContain('A×X'); // rich cells are never re-priced here
    expect(pairs).not.toContain('B×Y'); // rich
    expect(jobs.length).toBeLessThanOrEqual(12);
    for (const job of jobs) expect(job.samples).toBe(VERIFY_SAMPLES);
    // No starved jobs: nothing to complete.
    expect(rowCompletedCells(trees, merged, [])).toEqual([]);
  });

  test('a deepened value replaces the one-ply sampler below the depth floor', () => {
    const merged = mergeMctsTrees(trees, new Map([[cellKey(0, 1), { i: 0, j: 1, value: -0.11, deepened: 0.21, ended: false }]]));
    expect(merged.matrix!.values[0][1]).toBeCloseTo(0.21, 10);
  });

  test('a blended cell re-blends the deepened first-seed child through its class', () => {
    const blend = { firstLeaf: -0.1, classes: [
      { key: 'hit-nokill', weight: 0.8, leafSum: -0.3, count: 3, hasFirst: true, ended: false },
      { key: 'miss', weight: 0.2, leafSum: 0.6, count: 3, hasFirst: false, ended: false },
    ] };
    const merged = mergeMctsTrees(trees, new Map([[cellKey(0, 1), { i: 0, j: 1, value: -0.04, deepened: 0.5, ended: false, blend }]]));
    // hasFirst class mean becomes (−0.3 − (−0.1) + 0.5) / 3 = 0.1; the miss class keeps 0.2.
    expect(merged.matrix!.values[0][1]).toBeCloseTo(0.8 * 0.1 + 0.2 * 0.2, 10);
  });
});
