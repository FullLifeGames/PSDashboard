import { test, expect } from '@playwright/test';
import {
  applyTrendExtrapolation, applyTrendTiebreak, cellKey, rankFromMatrix, selectTieProbeCells,
  solveMatrixGame, toResult, TIE_EPSILON, TREND_LAMBDA, TREND_MARGIN, type ValueMatrix,
} from '../src/rank';

// Pins the regret-matching solver against games with known solutions. The
// solver is pure math (no sim), deterministic, and reads the AVERAGE
// strategies — the only thing regret matching guarantees converges.
test.describe('zero-sum matrix game solver', () => {
  test('matching pennies solves to the uniform mix at value 0', () => {
    const { value, p1Mix, p2Mix } = solveMatrixGame([[1, -1], [-1, 1]]);
    expect(Math.abs(value)).toBeLessThan(0.02);
    expect(p1Mix[0]).toBeGreaterThan(0.45);
    expect(p1Mix[0]).toBeLessThan(0.55);
    expect(p2Mix[0]).toBeGreaterThan(0.45);
    expect(p2Mix[0]).toBeLessThan(0.55);
  });

  test('a dominant row takes the whole mix', () => {
    const { value, p1Mix } = solveMatrixGame([[1, 1], [0, 0]]);
    expect(p1Mix[0]).toBeGreaterThan(0.95);
    expect(value).toBeGreaterThan(0.95);
  });

  test('a known mixed game hits its analytic solution', () => {
    // [[2,−1],[−1,1]]: p1 plays row 0 with 2/5, game value 1/5.
    const { value, p1Mix } = solveMatrixGame([[2, -1], [-1, 1]]);
    expect(Math.abs(value - 0.2)).toBeLessThan(0.02);
    expect(Math.abs(p1Mix[0] - 0.4)).toBeLessThan(0.03);
  });

  test('a pure saddle point is found exactly', () => {
    // Row 1 / col 0 is a saddle at 2: max of row minima, min of col maxima.
    const { value, p1Mix, p2Mix } = solveMatrixGame([[1, 3], [2, 4]]);
    expect(Math.abs(value - 2)).toBeLessThan(0.02);
    expect(p1Mix[1]).toBeGreaterThan(0.95);
    expect(p2Mix[0]).toBeGreaterThan(0.95);
  });

  test('degenerate shapes do not crash', () => {
    expect(solveMatrixGame([[0.3]]).value).toBeCloseTo(0.3, 10);
    expect(solveMatrixGame([]).p1Mix).toEqual([]);
    expect(solveMatrixGame([[]]).p2Mix).toEqual([]);
  });

  test('the solver is deterministic', () => {
    const first = solveMatrixGame([[0.4, -0.2, 0.1], [-0.1, 0.3, -0.3], [0.0, 0.1, 0.2]]);
    const second = solveMatrixGame([[0.4, -0.2, 0.1], [-0.1, 0.3, -0.3], [0.0, 0.1, 0.2]]);
    expect(second).toEqual(first);
  });
});

test.describe('equilibrium-aware ranking', () => {
  const matrixOf = (values: number[][]): ValueMatrix => ({
    p1Options: values.map((_, i) => ({ choice: `p1c${i}`, label: `P1 ${i}` })),
    p2Options: (values[0] ?? []).map((_, j) => ({ choice: `p2c${j}`, label: `P2 ${j}` })),
    values,
    ended: values.map(row => row.map(() => false)),
  });
  // Rows A/B: a mixed rock-paper pair worth 0.2 at equilibrium; row C: a flat
  // 0.05 floor. Pure maximin ranks C first — the equilibrium knows the A/B
  // mix is worth four times as much.
  const mixedSpot = [
    [0.6, -0.2],
    [-0.2, 0.6],
    [0.05, 0.05],
  ];

  test('ranking prefers equilibrium EV over the pure floor', () => {
    const ranked = rankFromMatrix(matrixOf(mixedSpot), 0);
    expect(ranked.p1[0].choice).toBe('p1c0');
    expect(ranked.p1[0].ev).toBeGreaterThan(0.15);
    expect(ranked.p1.find(choice => choice.choice === 'p1c2')!.ev).toBeCloseTo(0.05, 2);
    expect(ranked.gameValue).toBeCloseTo(0.2, 1);
    // The floors stay reported — they are the safety column.
    expect(ranked.p1[0].worstCase).toBeCloseTo(-0.2, 10);
    expect(Math.max(...ranked.p1.map(choice => choice.worstCase))).toBeCloseTo(0.05, 10);
    // p2's evs are own-perspective: every column loses ≈0.2 against the mix.
    for (const choice of ranked.p2) expect(choice.ev).toBeLessThan(-0.1);
  });

  test('the result score is the game value clamped into the maximin interval', () => {
    const result = toResult(rankFromMatrix(matrixOf(mixedSpot), 0), 1);
    expect(result.gameValue).toBeCloseTo(0.2, 1);
    expect(result.score).toBeCloseTo(result.gameValue!, 10);
    // Maximin guarantees unchanged: v1 = 0.05 (row C floor), v2 = 0.6.
    expect(result.interval).toBeCloseTo(0.55, 2);
  });

  test('a saddle point keeps the classic ordering and score', () => {
    // One dominant row: ev-ranking and floor-ranking agree, score = saddle.
    const result = toResult(rankFromMatrix(matrixOf([[0.3, 0.4], [0.1, 0.2]]), 0), 1);
    expect(result.perSide.p1[0].choice).toBe('p1c0');
    expect(result.score).toBeCloseTo(0.3, 2);
    expect(result.perSide.p1[0].ev).toBeCloseTo(0.3, 2);
  });
});

test.describe('horizon-trend tiebreak', () => {
  const matrixOf = (values: number[][], ended?: boolean[][]): ValueMatrix => ({
    p1Options: values.map((_, i) => ({ choice: `p1c${i}`, label: `P1 ${i}` })),
    p2Options: (values[0] ?? []).map((_, j) => ({ choice: `p2c${j}`, label: `P2 ${j}` })),
    values,
    ended: ended ?? values.map(row => row.map(() => false)),
  });
  const resultOf = (matrix: ValueMatrix) => toResult(rankFromMatrix(matrix, 0), 1);

  test('a bleeding top row yields the tie to a building runner-up — ordering only', () => {
    // Rows 0/1 tie by EV against the single reply; row 2 is far behind.
    const matrix = matrixOf([[0.1], [0.1], [-0.5]]);
    const result = resultOf(matrix);
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c0', 'p1c1', 'p1c2']);
    const before = { score: result.score, evs: new Map(result.perSide.p1.map(c => [c.choice, c.ev])) };

    const trends = new Map([[cellKey(0, 0), -0.05], [cellKey(1, 0), +0.05]]);
    applyTrendTiebreak(matrix, result, trends);
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c1', 'p1c0', 'p1c2']);
    // Order is ALL the tiebreak may touch: score, EVs, floors stay.
    expect(result.score).toBe(before.score);
    for (const choice of result.perSide.p1) expect(choice.ev).toBe(before.evs.get(choice.choice));
  });

  test('a trend spread below the margin leaves the order alone', () => {
    const matrix = matrixOf([[0.1], [0.1]]);
    const result = resultOf(matrix);
    applyTrendTiebreak(matrix, result, new Map([
      [cellKey(0, 0), -TREND_MARGIN / 4], [cellKey(1, 0), +TREND_MARGIN / 4],
    ]));
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c0', 'p1c1']);
  });

  test('rows outside the tie epsilon never reorder, whatever their trends', () => {
    const matrix = matrixOf([[0.1], [0.1 - TIE_EPSILON * 2]]);
    const result = resultOf(matrix);
    applyTrendTiebreak(matrix, result, new Map([[cellKey(0, 0), -0.5], [cellKey(1, 0), +0.5]]));
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c0', 'p1c1']);
  });

  test('a missing trend forfeits the reorder instead of comparing asymmetrically', () => {
    const matrix = matrixOf([[0.1], [0.1]]);
    const result = resultOf(matrix);
    applyTrendTiebreak(matrix, result, new Map([[cellKey(0, 0), -0.5]]));
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c0', 'p1c1']);
  });

  test('p2 ties read the p1-perspective trends negated', () => {
    // One p1 row, two tied p2 replies. Cell (0,0) IMPROVING for p1 (+0.06)
    // is p2c0 bleeding; cell (0,1) falling for p1 is p2c1 building.
    const matrix = matrixOf([[-0.1, -0.1]]);
    const result = resultOf(matrix);
    expect(result.perSide.p2.map(choice => choice.choice)).toEqual(['p2c0', 'p2c1']);
    applyTrendTiebreak(matrix, result, new Map([[cellKey(0, 0), +0.06], [cellKey(0, 1), -0.06]]));
    expect(result.perSide.p2.map(choice => choice.choice)).toEqual(['p2c1', 'p2c0']);
  });

  test('a core tied with its own gimmick variant is not a tie — plain stays first', () => {
    // 'move x' vs 'move x terastallize': a resource-spend question, not a
    // stall-vs-progress one. The group dedupes to one core → no reorder, no
    // probes — whatever the trends say.
    const matrix: ValueMatrix = {
      p1Options: [
        { choice: 'move seismictoss', label: 'Seismic Toss' },
        { choice: 'move seismictoss terastallize', label: 'Tera + Seismic Toss' },
      ],
      p2Options: [{ choice: 'move x', label: 'X' }],
      values: [[0.1], [0.1]],
      ended: [[false], [false]],
    };
    const result = toResult(rankFromMatrix(matrix, 0), 1);
    expect(selectTieProbeCells(matrix, result, new Map())).toEqual([]);
    applyTrendTiebreak(matrix, result, new Map([[cellKey(0, 0), -0.5], [cellKey(1, 0), +0.5]]));
    expect(result.perSide.p1.map(choice => choice.choice))
      .toEqual(['move seismictoss', 'move seismictoss terastallize']);
  });

  test('a skipped gimmick duplicate keeps its slot while the cores reorder around it', () => {
    // Tie of [core A, tera A, core B]: only A and B compete; B's building
    // trend wins slot 0, tera-A stays parked in the middle.
    const matrix: ValueMatrix = {
      p1Options: [
        { choice: 'move a', label: 'A' },
        { choice: 'move a terastallize', label: 'Tera + A' },
        { choice: 'move b', label: 'B' },
      ],
      p2Options: [{ choice: 'move x', label: 'X' }],
      values: [[0.1], [0.1], [0.1]],
      ended: [[false], [false], [false]],
    };
    const result = toResult(rankFromMatrix(matrix, 0), 1);
    expect(selectTieProbeCells(matrix, result, new Map())).toEqual([[0, 0], [2, 0]]);
    applyTrendTiebreak(matrix, result, new Map([[cellKey(0, 0), -0.05], [cellKey(2, 0), +0.05]]));
    expect(result.perSide.p1.map(choice => choice.choice))
      .toEqual(['move b', 'move a terastallize', 'move a']);
  });

  test('selectTieProbeCells wants only unpriced, unfinished decisive cells of real ties', () => {
    const matrix = matrixOf([[0.1], [0.1], [-0.5]]);
    const result = resultOf(matrix);
    // Both tied rows' decisive cells (punisher = modal = the only column).
    expect(selectTieProbeCells(matrix, result, new Map())).toEqual([[0, 0], [1, 0]]);
    // Already-priced cells drop out.
    expect(selectTieProbeCells(matrix, result, new Map([[cellKey(0, 0), 0.02]]))).toEqual([[1, 0]]);
    // Terminal cells are exact — never probed.
    const ended = matrixOf([[0.1], [0.1], [-0.5]], [[true], [false], [false]]);
    expect(selectTieProbeCells(ended, resultOf(ended), new Map())).toEqual([[1, 0]]);
    // No tie, no probes.
    const clear = matrixOf([[0.3], [0.1]]);
    expect(selectTieProbeCells(clear, resultOf(clear), new Map())).toEqual([]);
  });
});

test.describe('horizon-trend extrapolation (2b)', () => {
  const matrixOf = (values: number[][], ended?: boolean[][]): ValueMatrix => ({
    p1Options: values.map((_, i) => ({ choice: `p1c${i}`, label: `P1 ${i}` })),
    p2Options: (values[0] ?? []).map((_, j) => ({ choice: `p2c${j}`, label: `P2 ${j}` })),
    values,
    ended: ended ?? values.map(row => row.map(() => false)),
  });
  const resultOf = (matrix: ValueMatrix) => toResult(rankFromMatrix(matrix, 0), 1);

  test('tied bleed-vs-build rows separate BY VALUE — score and mixes stay (no re-solve)', () => {
    const matrix = matrixOf([[0.1], [0.1], [-0.5]]);
    const result = resultOf(matrix);
    const scoreBefore = result.score;
    const trends = new Map([[cellKey(0, 0), -0.05], [cellKey(1, 0), +0.05]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    // Row shifts are λ·trend of the single decisive cell.
    expect(matrix.values[0][0]).toBeCloseTo(0.075, 10);
    expect(matrix.values[1][0]).toBeCloseTo(0.125, 10);
    expect(matrix.values[2][0]).toBe(-0.5);
    // The ranked list re-sorts by the corrected values in place…
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c1', 'p1c0', 'p1c2']);
    expect(result.perSide.p1[0].ev - result.perSide.p1[1].ev).toBeCloseTo(0.05, 10);
    expect(result.perSide.p1[0].worstCase).toBeCloseTo(0.125, 10);
    // …while the solved score does NOT move: re-solving would let the game
    // absorb the correction (the opponent re-weights toward the corrected
    // row's punishers — measured self-defeating at T50 for every λ).
    expect(result.score).toBe(scoreBefore);
  });

  test('a p2 group shifts its displayed values in p2 perspective', () => {
    // One p1 row, two tied p2 replies. Cell (0,0) falling for p1 (−0.06) is
    // p2c0 BUILDING: its p2-perspective ev must rise.
    const matrix = matrixOf([[-0.1, -0.1]]);
    const result = resultOf(matrix);
    const trends = new Map([[cellKey(0, 0), -0.06], [cellKey(0, 1), +0.06]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    const p2 = result.perSide.p2;
    expect(p2[0].choice).toBe('p2c0');
    expect(p2.find(choice => choice.choice === 'p2c0')!.ev).toBeCloseTo(0.13, 10);
    expect(p2.find(choice => choice.choice === 'p2c1')!.ev).toBeCloseTo(0.07, 10);
  });

  test('corrections are row-uniform: every cell of a corrected row shifts by the same delta', () => {
    // p2's columns are far apart (no p2 tie group) so the deltas are purely
    // p1's row shifts. Row-uniformity is the depth-symmetry guarantee: under
    // any fixed opposing strategy it adds a constant to the opponent's EVs,
    // so their comparisons never distort directly.
    const matrix = matrixOf([[0.1, 0.4], [0.1, 0.4]]);
    const result = resultOf(matrix);
    const trends = new Map([[cellKey(0, 0), -0.06], [cellKey(1, 0), +0.06]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    const delta0 = matrix.values[0].map((cell, j) => cell - [0.1, 0.4][j]);
    const delta1 = matrix.values[1].map((cell, j) => cell - [0.1, 0.4][j]);
    expect(delta0[0]).toBeCloseTo(delta0[1], 10);
    expect(delta1[0]).toBeCloseTo(delta1[1], 10);
    expect(delta0[0]).toBeLessThan(0);
    expect(delta1[0]).toBeGreaterThan(0);
  });

  test('an unpriced cell forfeits its whole group while the other side still corrects', () => {
    const matrix = matrixOf([[0.1, 0.1], [0.1, 0.1]]);
    const result = resultOf(matrix);
    // p2's group cells (0,0)/(0,1) priced; p1's row 1 cell (1,0) missing.
    const trends = new Map([[cellKey(0, 0), -0.06], [cellKey(0, 1), +0.06]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    // Columns shifted (p2 group complete), rows did not (p1 group forfeited):
    // every cell's delta depends on its column only.
    const colDelta = [matrix.values[0][0] - 0.1, matrix.values[0][1] - 0.1];
    expect(matrix.values[1][0] - 0.1).toBeCloseTo(colDelta[0], 10);
    expect(matrix.values[1][1] - 0.1).toBeCloseTo(colDelta[1], 10);
    expect(colDelta[0]).not.toBeCloseTo(colDelta[1], 5);
  });

  test('shifts below the noise floor stay unapplied', () => {
    // Decided positions tie structurally with near-zero trends; folding
    // sampling noise into values would churn endgame rankings.
    const matrix = matrixOf([[0.1], [0.1]]);
    const result = resultOf(matrix);
    const trends = new Map([[cellKey(0, 0), -0.008], [cellKey(1, 0), +0.008]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(false);
    expect(matrix.values[0][0]).toBe(0.1);
    expect(matrix.values[1][0]).toBe(0.1);
  });

  test('λ = 0 is the identity and reports nothing applied', () => {
    const matrix = matrixOf([[0.1], [0.1]]);
    const result = resultOf(matrix);
    const trends = new Map([[cellKey(0, 0), -0.05], [cellKey(1, 0), +0.05]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0)).toBe(false);
    expect(matrix.values[0][0]).toBe(0.1);
    expect(matrix.values[1][0]).toBe(0.1);
  });

  test('corrected values clamp to the wp-unit range', () => {
    const matrix = matrixOf([[0.99], [0.99]]);
    const result = resultOf(matrix);
    const trends = new Map([[cellKey(0, 0), +0.2], [cellKey(1, 0), +0.1]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    expect(matrix.values[0][0]).toBe(1);
    expect(matrix.values[1][0]).toBe(1);
  });

  test('a terminal decisive cell prices as trend 0, not as missing coverage', () => {
    const matrix = matrixOf([[0.1], [0.1]], [[true], [false]]);
    const result = resultOf(matrix);
    // Row 0's only decisive cell is terminal → aggregate 0 → no shift; row 1
    // still shifts — the group stays complete.
    const trends = new Map([[cellKey(1, 0), +0.06]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    expect(matrix.values[0][0]).toBe(0.1);
    expect(matrix.values[1][0]).toBeCloseTo(0.13, 10);
  });

  test('no tie groups, no corrections', () => {
    const matrix = matrixOf([[0.3], [0.1]]);
    const result = resultOf(matrix);
    expect(applyTrendExtrapolation(matrix, result, new Map([[cellKey(0, 0), -0.5]]), 0.5)).toBe(false);
    expect(matrix.values[0][0]).toBe(0.3);
  });

  test('the default λ is the swept 0.5', () => {
    expect(TREND_LAMBDA).toBe(0.5);
  });
});
