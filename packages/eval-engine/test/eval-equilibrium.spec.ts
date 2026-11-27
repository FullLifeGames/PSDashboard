import { readFileSync } from 'node:fs';
import { test, expect, describe } from 'vitest';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/search';
import type { EvalResult, EvalSettings } from '../src/types';
import {
  applyTrendExtrapolation, applyTrendTiebreak, cellKey, rankFromMatrix, selectTieProbeCells,
  solveMatrixGame, toResult, TIE_EPSILON, TREND_MARGIN, type ValueMatrix,
} from '../src/rank';

// Reads the average strategies: the only thing regret matching guarantees converges.
describe('zero-sum matrix game solver', () => {
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

describe('equilibrium-aware ranking', () => {
  const matrixOf = (values: number[][]): ValueMatrix => ({
    p1Options: values.map((_, i) => ({ choice: `p1c${i}`, label: `P1 ${i}` })),
    p2Options: (values[0] ?? []).map((_, j) => ({ choice: `p2c${j}`, label: `P2 ${j}` })),
    values,
    ended: values.map(row => row.map(() => false)),
  });
  // Rows A/B: a mixed pair worth 0.2 at equilibrium; row C: a flat 0.05 floor.
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
    expect(ranked.p1[0].worstCase).toBeCloseTo(-0.2, 10);
    expect(Math.max(...ranked.p1.map(choice => choice.worstCase))).toBeCloseTo(0.05, 10);
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
    const result = toResult(rankFromMatrix(matrixOf([[0.3, 0.4], [0.1, 0.2]]), 0), 1);
    expect(result.perSide.p1[0].choice).toBe('p1c0');
    expect(result.score).toBeCloseTo(0.3, 2);
    expect(result.perSide.p1[0].ev).toBeCloseTo(0.3, 2);
  });
});

describe('horizon-trend tiebreak', () => {
  const matrixOf = (values: number[][], ended?: boolean[][]): ValueMatrix => ({
    p1Options: values.map((_, i) => ({ choice: `p1c${i}`, label: `P1 ${i}` })),
    p2Options: (values[0] ?? []).map((_, j) => ({ choice: `p2c${j}`, label: `P2 ${j}` })),
    values,
    ended: ended ?? values.map(row => row.map(() => false)),
  });
  const resultOf = (matrix: ValueMatrix) => toResult(rankFromMatrix(matrix, 0), 1);

  test('a bleeding top row yields the tie to a building runner-up — ordering only', () => {
    const matrix = matrixOf([[0.1], [0.1], [-0.5]]);
    const result = resultOf(matrix);
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c0', 'p1c1', 'p1c2']);
    const before = { score: result.score, evs: new Map(result.perSide.p1.map(c => [c.choice, c.ev])) };

    const trends = new Map([[cellKey(0, 0), -0.05], [cellKey(1, 0), +0.05]]);
    applyTrendTiebreak(matrix, result, trends);
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c1', 'p1c0', 'p1c2']);
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
    const matrix = matrixOf([[-0.1, -0.1]]);
    const result = resultOf(matrix);
    expect(result.perSide.p2.map(choice => choice.choice)).toEqual(['p2c0', 'p2c1']);
    applyTrendTiebreak(matrix, result, new Map([[cellKey(0, 0), +0.06], [cellKey(0, 1), -0.06]]));
    expect(result.perSide.p2.map(choice => choice.choice)).toEqual(['p2c1', 'p2c0']);
  });

  test('a core tied with its own gimmick variant is not a tie — plain stays first', () => {
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
    expect(selectTieProbeCells(matrix, result, new Map())).toEqual([[0, 0], [1, 0]]);
    expect(selectTieProbeCells(matrix, result, new Map([[cellKey(0, 0), 0.02]]))).toEqual([[1, 0]]);
    const ended = matrixOf([[0.1], [0.1], [-0.5]], [[true], [false], [false]]);
    expect(selectTieProbeCells(ended, resultOf(ended), new Map())).toEqual([[1, 0]]);
    const clear = matrixOf([[0.3], [0.1]]);
    expect(selectTieProbeCells(clear, resultOf(clear), new Map())).toEqual([]);
  });
});

describe('horizon-trend extrapolation (2b)', () => {
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
    // Row shift = lambda * trend of the single decisive cell.
    expect(matrix.values[0][0]).toBeCloseTo(0.075, 10);
    expect(matrix.values[1][0]).toBeCloseTo(0.125, 10);
    expect(matrix.values[2][0]).toBe(-0.5);
    expect(result.perSide.p1.map(choice => choice.choice)).toEqual(['p1c1', 'p1c0', 'p1c2']);
    expect(result.perSide.p1[0].ev - result.perSide.p1[1].ev).toBeCloseTo(0.05, 10);
    expect(result.perSide.p1[0].worstCase).toBe(0.1);
    // The solved score stays: re-solving lets the opponent re-weight toward the corrected row's punishers.
    expect(result.score).toBe(scoreBefore);
  });

  test('a p2 group shifts its displayed values in p2 perspective', () => {
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
    const trends = new Map([[cellKey(0, 0), -0.06], [cellKey(0, 1), +0.06]]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    const colDelta = [matrix.values[0][0] - 0.1, matrix.values[0][1] - 0.1];
    expect(matrix.values[1][0] - 0.1).toBeCloseTo(colDelta[0], 10);
    expect(matrix.values[1][1] - 0.1).toBeCloseTo(colDelta[1], 10);
    expect(colDelta[0]).not.toBeCloseTo(colDelta[1], 5);
  });

  test('shifts below the noise floor stay unapplied', () => {
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
});

describe('the floor of a trend-corrected row stays its lowest cell', () => {
  function expectFloorsInTable(result: EvalResult): number {
    const table = result.matrix!;
    let rows = 0;
    for (const side of ['p1', 'p2'] as const) {
      const choices = side === 'p1' ? table.p1Choices : table.p2Choices;
      const labels = side === 'p1' ? table.p2Labels : table.p1Labels;
      for (const row of result.perSide[side]) {
        const index = choices.indexOf(row.choice);
        const line = side === 'p1' ? table.values[index] : table.values.map(values => -values[index]);
        const floor = Math.min(...line);
        expect(row.worstCase, `${side} ${row.label}`).toBe(floor);
        expect(row.punishedBy, `${side} ${row.label}`).toBe(labels[line.indexOf(floor)]);
        rows++;
      }
    }
    return rows;
  }

  test('both sides: tied rows keep floor and punisher while ev takes the shift', () => {
    const matrix: ValueMatrix = {
      p1Options: [{ choice: 'p1c0', label: 'P1 0' }, { choice: 'p1c1', label: 'P1 1' }],
      p2Options: [{ choice: 'p2c0', label: 'P2 0' }, { choice: 'p2c1', label: 'P2 1' }],
      values: [[0.1, 0.1], [0.1, 0.1]],
      ended: [[false, false], [false, false]],
    };
    const result = toResult(rankFromMatrix(matrix, 0), 1);
    const before = new Map(['p1', 'p2'].flatMap(side =>
      result.perSide[side as 'p1' | 'p2'].map(row => [`${side} ${row.choice}`, { ...row }] as const)));
    const trends = new Map([
      [cellKey(0, 0), -0.2], [cellKey(0, 1), -0.2], [cellKey(1, 0), +0.2], [cellKey(1, 1), 0],
    ]);
    expect(applyTrendExtrapolation(matrix, result, trends, 0.5)).toBe(true);
    expectFloorsInTable(result);
    for (const side of ['p1', 'p2'] as const) {
      const moved = result.perSide[side].filter(row => row.ev !== before.get(`${side} ${row.choice}`)!.ev);
      expect(moved.length, side).toBeGreaterThan(0);
      for (const row of result.perSide[side]) {
        expect(row.expected, `${side} ${row.choice}`).toBe(before.get(`${side} ${row.choice}`)!.expected);
      }
    }
  });

  const position = JSON.parse(readFileSync(
    new URL('./fixtures/positions/smogtours-gen6ou-649664-t14-g1.json', import.meta.url), 'utf-8')) as {
    serialized: string; tera: boolean; sleepClause: boolean; ruleset: EvalSettings['ruleset']; keepPlayed: EvalSettings['keepPlayed'];
  };
  const settings: EvalSettings = {
    depth: 1, samples: 1, mode: 'matrix', tera: position.tera, sleepClause: position.sleepClause,
    ruleset: position.ruleset, keepPlayed: position.keepPlayed, prove: false,
  };

  test('singles matrix turn, sync and orchestrated: every row reads a cell of the table', async () => {
    const sync = searchPosition(position.serialized, settings);
    expect(expectFloorsInTable(sync)).toBeGreaterThan(0);
    const orchestrated = await searchOrchestrated(createLocalExecutor(position.serialized, position.ruleset), settings);
    expectFloorsInTable(orchestrated);
    expect(orchestrated.perSide).toEqual(sync.perSide);
  }, 120_000);

  test('doubles lead matrix: every lead row reads a cell of the table', () => {
    const set = (name: string, species: string, moves: string[]): PokemonSet => ({
      name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100, gender: '',
    });
    const team = (moves: string[]) => Teams.pack([
      set('A', 'Machamp', moves), set('B', 'Snorlax', moves), set('C', 'Blissey', moves), set('D', 'Chansey', moves),
    ]);
    const preview = new Battle({
      formatid: toID('gen9doublescustomgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: team(['Karate Chop', 'Growl']) },
      p2: { name: 'Beta', team: team(['Tackle', 'Growl']) },
    });
    const result = searchPosition(JSON.stringify(State.serializeBattle(preview)), { depth: 1, samples: 1, tera: false });
    expect(result.perSide.p1[0].label).toMatch(/^Lead /);
    expect(expectFloorsInTable(result)).toBeGreaterThan(0);
  }, 120_000);
});
