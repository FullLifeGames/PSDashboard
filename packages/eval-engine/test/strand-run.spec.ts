import { describe, expect, test } from 'vitest';
import { cellKey } from '../src/rank';
import { solveMatrixGame } from '../src/ranking/solve';
import { gradedGrid, gradedRanking, type AnswerSide, type SideGrade } from '../src/search/answers';
import { classTrusted } from '../src/mcts-merge';
import { STRAND_CAP_DOUBLES, strandCap } from '../src/search/strand-round';
import { strandRound, type StrandRoundInput } from '../src/search/strand-run';
import { VERIFY_SAMPLES } from '../src/verify-select';
import type {
  CellBlendClass, ClassPricing, EvalCellJob, EvalCellValue, EvalResult, EvalSettings, MctsTreeStats, RankedChoice,
} from '../src/types';

/**
 * Round 89 (T322, #59), block 2 stage 3: the strand round in the orchestrator, read through a stub executor. Scene: a side
 * played row a1 while row a0 was better; the verify round priced a 30 to 50 percent class of the played row's cell (or of
 * the best row's) shallow. The round screens the grid the grade reads (the matrix, or the side's answered grid for a doubles
 * side the answer round re-ranked), asks the executor for a strand job per cell, and writes the record the grade will read
 * (`EvalResult.strands`). The rows use hand-built matrices, so the numbers are exact; the real boards are in
 * `strand-run-boards.spec.ts`.
 */

const cls = (key: string, weight: number, value: number, priced: ClassPricing, extra: Partial<CellBlendClass> = {}): CellBlendClass => ({
  key, weight, leafSum: value, count: 1, hasFirst: false, ended: false, priced, ...extra,
});
const cell = (i: number, j: number, classes: CellBlendClass[]): EvalCellValue => ({ i, j, value: 0, ended: false, blend: { classes, firstLeaf: 0 } });
const verifiedOf = (...cells: EvalCellValue[]) => new Map(cells.map(value => [cellKey(value.i, value.j), value]));

/** Three p1 rows (a0 best, a1 played, a2 weak) against two columns of mix 0.6 and 0.4: evB 0.42, evP 0.04, r 0.38 (mistake, d 0.18). */
const VALUES = [[0.5, 0.3], [0, 0.1], [-0.5, -0.5]];
const X = [0.2, 0.1, 0.7];
const Y = [0.6, 0.4];
const A = ['a0', 'a1', 'a2'];
const B = ['b0', 'b1'];

const ranked = (choices: string[], evs: number[], floors: number[]): RankedChoice[] => choices
  .map((choice, index) => ({ choice, label: choice.toUpperCase(), worstCase: floors[index], expected: evs[index], ev: evs[index], punishedBy: null }))
  .sort((a, b) => b.ev - a.ev || b.worstCase - a.worstCase);

/** The result a merged search holds for the grid: the rankings of both sides over it, with the equilibrium mixes handed in. */
function resultOf(values: number[][], mixes: { p1: number[]; p2: number[] }, score = 0): EvalResult {
  const p1Ev = values.map(row => row.reduce((sum, v, j) => sum + v * mixes.p2[j], 0));
  const p2Ev = values[0].map((_, j) => -values.reduce((sum, row, i) => sum + row[j] * mixes.p1[i], 0));
  return {
    score, interval: 0, depthCompleted: 1,
    perSide: {
      p1: ranked(A.slice(0, values.length), p1Ev, values.map(row => Math.min(...row))),
      p2: ranked(B.slice(0, values[0].length), p2Ev, values[0].map((_, j) => -Math.max(...values.map(row => row[j])))),
    },
    matrix: {
      p1Labels: A.slice(0, values.length).map(a => a.toUpperCase()), p2Labels: B.slice(0, values[0].length).map(b => b.toUpperCase()),
      p1Choices: A.slice(0, values.length), p2Choices: B.slice(0, values[0].length), values, mixes,
    },
  };
}

/** Trees that carry the root options, the legal lists of a doubles root and the given tree cells (a cell with a class key joins the pool of that class). */
function treesOf(over: Partial<MctsTreeStats> = {}): MctsTreeStats[] {
  return [{
    p1Options: A.map(choice => ({ choice, label: choice.toUpperCase() })), p2Options: B.map(choice => ({ choice, label: choice.toUpperCase() })),
    cells: [], ...over,
  } as unknown as MctsTreeStats];
}

const SETTINGS: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: true, sleepClause: true, ruleset: 'standard' };

interface Stub { jobs: EvalCellJob[][]; executor: { evalCells: (jobs: EvalCellJob[]) => Promise<EvalCellValue[]> } }

/** An executor that answers each strand job with the values the test names per class key (p1's view). */
function stub(values: Record<string, number>): Stub {
  const record: Stub = {
    jobs: [],
    executor: {
      evalCells: async jobs => {
        record.jobs.push(jobs);
        return jobs.map(job => ({ i: job.i, j: job.j, value: 0, ended: false, strandValues: Object.fromEntries((job.strands ?? []).filter(key => key in values).map(key => [key, values[key]])) }));
      },
    },
  };
  return record;
}

const FLINCH = 'p1b:ironhead>p2a=hit-nokill+flinch';
const MISS = 'p2a:thunderbolt>p1b=miss';

function input(over: Partial<StrandRoundInput> = {}): StrandRoundInput {
  return {
    trees: treesOf(), result: resultOf(VALUES, { p1: X, p2: Y }), settings: SETTINGS, answered: {}, played: { p1: 1 },
    verified: verifiedOf(cell(1, 0, [cls(FLINCH, 0.5, -0.2, 'light')]), cell(0, 0, [cls(MISS, 0.3, 0.4, 'light')])),
    ...over,
  };
}

describe('strandRound (T322 block 2, stage 3)', () => {
  test('o1/o2: a screened strand and its partner go out as one strand job per cell, and the record carries the searched regret', async () => {
    const { executor, jobs } = stub({ [FLINCH]: 0.4, [MISS]: 0.4 });
    const strands = await strandRound(executor, input());
    expect(jobs).toHaveLength(1);
    const asked = jobs[0].map(job => ({ i: job.i, j: job.j, p1Choice: job.p1Choice, p2Choice: job.p2Choice, strands: job.strands, samples: job.samples }));
    expect(asked).toEqual([
      { i: 0, j: 0, p1Choice: 'a0', p2Choice: 'b0', strands: [MISS], samples: VERIFY_SAMPLES },
      { i: 1, j: 0, p1Choice: 'a1', p2Choice: 'b0', strands: [FLINCH], samples: VERIFY_SAMPLES },
    ]);
    // The jobs deepen like the verify round's (the strand price is the full depth-1 search).
    expect(jobs[0].every(job => job.deepen?.depth === 1 && job.deepen.samples === 1)).toBe(true);
    // evP 0.04 + 0.6 * 0.5 * (0.4 + 0.2) = 0.22; evB 0.42 + 0.6 * 0.3 * (0.4 - 0.4) = 0.42; r' = 0.20.
    expect(strands?.p2).toBeUndefined();
    const record = strands!.p1!;
    expect(record.played).toBe('a1');
    expect(record.best).toBe('a0');
    expect(record.playedEv).toBeCloseTo(0.22, 12);
    expect(record.bestEv).toBeCloseTo(0.42, 12);
    expect(record.regret).toBeCloseTo(0.2, 12);
    expect(record.regretBefore).toBeCloseTo(0.38, 12);
    expect(record.strands).toEqual([
      { role: 'P', classKey: FLINCH, chance: 0.5, column: 'B0', before: -0.2, searched: 0.4 },
      { role: 'B', classKey: MISS, chance: 0.3, column: 'B0', before: 0.4, searched: 0.4 },
    ]);
  });

  test('o1: a strand is no regret change by itself: the record leaves the result, the matrix and the rankings to the caller', async () => {
    const given = input();
    const before = structuredClone(given.result);
    await strandRound(stub({ [FLINCH]: 0.4, [MISS]: 0.4 }).executor, given);
    expect(given.result).toEqual(before);
  });

  test('o2: the cap per turn holds (doubles 4 sub-searches, singles 6), counted in classes', async () => {
    // A doubles root (legal lists shipped) with six passing classes in the played row's cells: only the cap's worth goes out.
    const many = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'];
    const wide = verifiedOf(cell(1, 0, many.map((key, n) => cls(key, 0.16 - n * 0.001, -1, 'light'))));
    const doubles = input({ verified: wide, trees: treesOf({ p1Legal: [], p2Legal: [] }) });
    const asked = stub(Object.fromEntries(many.map(key => [key, 0])));
    await strandRound(asked.executor, doubles);
    expect(asked.jobs.flat().flatMap(job => job.strands ?? [])).toHaveLength(STRAND_CAP_DOUBLES);
    expect(strandCap('doubles')).toBe(STRAND_CAP_DOUBLES);
    const singles = stub(Object.fromEntries(many.map(key => [key, 0])));
    await strandRound(singles.executor, input({ verified: wide }));
    expect(singles.jobs.flat().flatMap(job => job.strands ?? [])).toHaveLength(6);
  });

  test('o4: without a played row no job goes out and no record is made', async () => {
    const asked = stub({ [FLINCH]: 0.4 });
    expect(await strandRound(asked.executor, input({ played: {} }))).toBeUndefined();
    expect(asked.jobs).toEqual([]);
  });

  test('no job for a side that played its best row, for a side without a tier, or without a verified cell', async () => {
    const asked = stub({ [FLINCH]: 0.4 });
    // p1 played the best row: P = B.
    expect(await strandRound(asked.executor, input({ played: { p1: 0 } }))).toBeUndefined();
    // a gap below the lowest tier line.
    const close = resultOf([[0.5, 0.3], [0.48, 0.3], [-0.5, -0.5]], { p1: X, p2: Y });
    expect(await strandRound(asked.executor, input({ result: close }))).toBeUndefined();
    // no verified cell at all (the plain verify cells carry no blend).
    expect(await strandRound(asked.executor, input({ verified: new Map() }))).toBeUndefined();
    expect(asked.jobs).toEqual([]);
  });

  test('a class the trees carry deep is not searched (the merge reads the trees there)', async () => {
    const deep = { key: cellKey(1, 0), visits: 400, total: 40, value: 0, ended: false, classes: [{ key: FLINCH, weight: 0.5, visits: 400, total: -80, value: 0, ended: false }] };
    const asked = stub({ [FLINCH]: 0.4, [MISS]: 0.4 });
    await strandRound(asked.executor, input({ trees: treesOf({ cells: [deep] as unknown as MctsTreeStats['cells'] }) }));
    const classes = asked.jobs.flat().flatMap(job => job.strands ?? []);
    expect(classes).not.toContain(FLINCH);
  });

  test('a side whose best row the grade names differently is skipped (the record would not match the grade)', async () => {
    const asked = stub({ [FLINCH]: 0.4, [MISS]: 0.4 });
    const flipped = resultOf(VALUES, { p1: X, p2: Y });
    flipped.perSide.p1 = [flipped.perSide.p1[1], flipped.perSide.p1[0], flipped.perSide.p1[2]];
    expect(await strandRound(asked.executor, input({ result: flipped }))).toBeUndefined();
    expect(asked.jobs).toEqual([]);
  });

  test('o3: a failing executor, or a stop request, leaves no record', async () => {
    const failing = { evalCells: async () => { throw new Error('worker lost'); } };
    expect(await strandRound(failing, input())).toBeUndefined();
    const asked = stub({ [FLINCH]: 0.4 });
    expect(await strandRound(asked.executor, input(), { shouldStop: () => true })).toBeUndefined();
    // A stop that comes while the jobs run drops the record too.
    let calls = 0;
    expect(await strandRound(stub({ [FLINCH]: 0.4 }).executor, input(), { shouldStop: () => ++calls > 1 })).toBeUndefined();
  });

  test('both sides: a search the sides share is asked once, and each side reads the value in its own sign', async () => {
    // p2 (mix X) played b0 against the better b1: regret 0.16, d 0.06. Its P cell (0, 0) is p1's B cell: the same class.
    const PART = 'p1a:surf>p2b=hit-nokill|miss';
    const x = [0.8, 0, 0.2];
    const verified = verifiedOf(
      cell(1, 0, [cls(FLINCH, 0.5, -0.2, 'light')]), cell(0, 0, [cls(MISS, 0.3, 0.4, 'light')]), cell(0, 1, [cls(PART, 0.4, 0.1, 'light')]),
    );
    const asked = stub({ [FLINCH]: 0.4, [MISS]: 0.4, [PART]: -0.5 });
    const strands = await strandRound(asked.executor, input({ verified, result: resultOf(VALUES, { p1: x, p2: Y }), played: { p1: 1, p2: 0 } }));
    const searches = asked.jobs.flat().flatMap(job => (job.strands ?? []).map(key => `${job.i}:${job.j}:${key}`));
    expect(searches.sort()).toEqual([`0:0:${MISS}`, `0:1:${PART}`, `1:0:${FLINCH}`].sort());
    expect(strands?.p1?.regret).toBeCloseTo(0.2, 12);
    const record = strands!.p2!;
    expect([record.played, record.best]).toEqual(['b0', 'b1']);
    // PART read 0.1 and now reads -0.5 for p1: -0.1 and +0.5 for p2, evB -0.14 + 0.8 * 0.4 * 0.6 = 0.052; MISS keeps its value; evP -0.3; no third row.
    expect(record.bestEv).toBeCloseTo(0.052, 12);
    expect(record.playedEv).toBeCloseTo(-0.3, 12);
    expect(record.regret).toBeCloseTo(0.352, 12);
    expect(record.strands.map(strand => [strand.role, strand.classKey, strand.before, strand.searched])).toEqual([
      ['P', MISS, -0.4, -0.4], ['B', PART, -0.1, 0.5],
    ]);
  });
});

describe('the answered grid (D3)', () => {
  /** p1's rows a0, a1 against the listed b0, b1 and an added answer b2 that refutes a0 and holds a1. */
  const listedValues = [[0.5, 0.3], [0, 0.1]];
  const view: AnswerSide = {
    side: 'p1',
    rows: [{ choice: 'a0', label: 'A0' }, { choice: 'a1', label: 'A1' }],
    answers: [{ choice: 'b0', label: 'B0' }, { choice: 'b1', label: 'B1' }, { choice: 'b2', label: 'B2' }],
    listed: 2,
  };
  const added: EvalCellValue[] = [{ i: 0, j: 2, value: -0.9, ended: false }, { i: 1, j: 2, value: 0.5, ended: false }];
  const tree = { rootValue: 0, p1Options: view.rows, p2Options: view.answers.slice(0, 2), cells: [] } as unknown as MctsTreeStats;

  test('gradedGrid is the grid gradedRanking ranks: its rows read the ranking back through the solved mix', () => {
    const result = resultOf(listedValues, { p1: [0.5, 0.5], p2: [0.5, 0.5] });
    const { grid, answers } = gradedGrid(view, result, [2], added);
    expect(answers.map(answer => answer.choice)).toEqual(['b0', 'b1', 'b2']);
    expect(grid).toEqual([[0.5, 0.3, -0.9], [0, 0.1, 0.5]]);
    const mix = solveMatrixGame(grid).p2Mix;
    const ranking = gradedRanking(view, result, tree, [2], added);
    for (const row of ranking) {
      const own = grid[view.rows.findIndex(option => option.choice === row.choice)];
      expect(row.ev).toBeCloseTo(own.reduce((sum, v, j) => sum + v * mix[j], 0), 12);
    }
  });

  test('a side the answer round re-ranked is screened on its answered grid and mix, not on the matrix', async () => {
    // On the matrix alone p1 played a1 against the best a0 (regret over 0.1), and the cells carry strands. On the answered grid
    // the added answer makes a1 the best row, so the played row has no regret and nothing goes out.
    const result = resultOf(listedValues, { p1: [0.5, 0.5], p2: [0.5, 0.5] });
    const answered = gradedRanking(view, result, tree, [2], added);
    expect(answered[0].choice).toBe('a1');
    const grade: SideGrade = { view, added: [2], values: added };
    const asked = stub({ [FLINCH]: 0.4, [MISS]: 0.4 });
    const given: StrandRoundInput = {
      ...input({ result: { ...result, perSide: { ...result.perSide, p1: answered } }, trees: treesOf({ p1Options: view.rows, p2Options: view.answers.slice(0, 2) } as unknown as Partial<MctsTreeStats>) }),
      answered: { p1: grade },
    };
    expect(await strandRound(asked.executor, given)).toBeUndefined();
    expect(asked.jobs).toEqual([]);
    // The same cells without the answer: p1's matrix ranking names a0 best and the strands go out.
    const plain = stub({ [FLINCH]: 0.4, [MISS]: 0.4 });
    const without = await strandRound(plain.executor, input({ result, trees: given.trees }));
    expect(without?.p1?.best).toBe('a0');
  });
});

describe('classTrusted (the merge rule, once)', () => {
  const tree = (visits: number): MctsTreeStats => ({
    p1Options: [], p2Options: [],
    cells: [{ key: cellKey(1, 0), visits, total: 0, value: 0, ended: false, classes: [{ key: 'miss', weight: 0.3, visits, total: 0, value: 0, ended: false }] }],
  } as unknown as MctsTreeStats);
  const blend = { classes: [cls('miss', 0.3, 0, 'light'), cls('hit', 0.7, 0, 'full')], firstLeaf: 0 };

  test('a lone tree stands from the endgame visits; a thin pool does not', () => {
    expect(classTrusted([tree(400)], cellKey(1, 0), blend, 'miss')).toBe(true);
    expect(classTrusted([tree(20)], cellKey(1, 0), blend, 'miss')).toBe(false);
    expect(classTrusted([tree(400)], cellKey(0, 0), blend, 'miss')).toBe(false);
  });
});
