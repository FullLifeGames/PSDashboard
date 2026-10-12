import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees } from '../src/mcts-merge';
import { cellKey } from '../src/rank';
import { starvedSupportCells } from '../src/verify-select';
import { createLocalTreeExecutor, answerRound, recheckedRound, type TreeExecutor } from '../src/tree-orchestrator';
import { PROVER_NEAR_TIE } from '../src/search/forced-win-apply';
import {
  ANSWER_DEEP_ROWS, ANSWER_NEAR_ROWS, ANSWER_SIBLING_PROBES, addedAnswers, answerSides, confirmedAnswers, confirmJobs, deepRows,
  confirmedCells, detectionJobs, extensionJobs, gradedRanking, nearRows, refutations, siblingJobs, type AnswerSide,
} from '../src/search/answers';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalCellJob, EvalCellValue, EvalResult, EvalSettings, MctsTreeStats } from '../src/types';

/**
 * Round 69 (T149): the answer round of round 67 (T128) read the top row of each side only, priced the added column by one
 * natural draw, and ran once. 2629703929 t4: six p1 rows lie within 0.012 of each other, so which row stands first (a
 * tree's noise) decided which answers the round found. 912045 t6: the switching row read 0.18 to 0.21 priced by one draw
 * and 0.03 to 0.07 one ply deeper. Now detection and the depth check read the rows within the prover's near tie of the
 * top, the rows that can still decide the ranking price the added answer one deepened ply, and a round that changes the
 * best row sends the new row's unverified cells through one more verify round.
 */

const NAMES = ['R0', 'R1', 'R2', 'R3'];
const evs = [1, 0.995, 0.99, 0.5];

/** Four p1 rows (three within the near tie of the top, one far below), two listed p2 answers and two unlisted ones. */
function scene(order: number[]): { tree: MctsTreeStats; result: EvalResult; view: AnswerSide } {
  const p1 = NAMES.map(name => ({ choice: `move ${name.toLowerCase()} 1, move ${name.toLowerCase()} 2`, label: `${name} A + ${name} B` }));
  const p2 = [{ choice: 'move x 1, move y 1', label: 'X + Y' }, { choice: 'move x 2, move y 2', label: 'X2 + Y2' }];
  const p2Legal = [...p2, { choice: 'move protect, move protect', label: 'Protect + Protect' }, { choice: 'move z 1, move y 1', label: 'Z + Y' }];
  const tree = { p1Options: p1, p2Options: p2, p1Legal: p1, p2Legal, rootValue: 0, koOdds: undefined } as unknown as MctsTreeStats;
  const ranked = order.map(index => ({ choice: p1[index].choice, label: p1[index].label, ev: evs[index], worstCase: evs[index], expected: evs[index], punishedBy: 'X + Y' }));
  const result = {
    score: 0.5, interval: 0, depthCompleted: 1,
    perSide: { p1: ranked, p2: [] },
    matrix: {
      p1Labels: p1.map(o => o.label), p2Labels: p2.map(o => o.label), p1Choices: p1.map(o => o.choice), p2Choices: p2.map(o => o.choice),
      values: p1.map((_, row) => [evs[row], evs[row]]), mixes: { p1: [0.25, 0.25, 0.25, 0.25], p2: [0.5, 0.5] },
    },
  } as unknown as EvalResult;
  const view = answerSides(tree, result)!.find(side => side.side === 'p1')!;
  return { tree, result, view };
}

/** The one-ply price of row r against answer a: Protect (2) refutes R1, Z + Y (3) refutes R2, the listed answers refute nothing. */
const priced = (row: number, answer: number): number => (answer === 2 && row === 1 ? 0.4 : answer === 3 && row === 2 ? 0.7 : 0.98);

const permutations = <T>(items: T[]): T[][] => (items.length <= 1
  ? [items]
  : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest])));
const NEAR_ORDERS = permutations([0, 1, 2]).map(order => [...order, 3]);

const sorted = (jobs: EvalCellJob[]): string[] => jobs.map(job => `${job.i}:${job.j}`).sort();
const detectedOf = (jobs: EvalCellJob[]): EvalCellValue[] => jobs.map(job => ({ i: job.i, j: job.j, value: priced(job.i, job.j), ended: false }));
/** Both stages of detection, priced by `priced`: the best row against every answer, the other near rows against the probes. */
const detect = (view: AnswerSide, result: EvalResult): EvalCellValue[] => {
  const first = detectedOf(detectionJobs(view, result));
  return [...first, ...detectedOf(siblingJobs(view, result, first))];
};

describe('the answer round reads every near-equal row, whatever their order (T149)', () => {
  test('the near rows are the ranked rows within the prover’s near tie of the top, in a canonical order', () => {
    expect(PROVER_NEAR_TIE).toBe(0.02);
    for (const order of NEAR_ORDERS) {
      const { result, view } = scene(order);
      expect(nearRows(view, result)).toEqual([0, 1, 2]);
    }
  });

  test('detection prices the best row against every answer, then the other near rows against the listed answers and the probes, in every order', () => {
    const expected = sorted(scene(NEAR_ORDERS[0]).view.answers.flatMap((_, answer) => [0, 1, 2].map(row => ({ i: row, j: answer }) as EvalCellJob)));
    expect(expected).toHaveLength(12);
    for (const order of NEAR_ORDERS) {
      const { result, view } = scene(order);
      const first = detectionJobs(view, result);
      expect(sorted(first)).toEqual(['0:0', '0:1', '0:2', '0:3']);
      const more = siblingJobs(view, result, detectedOf(first));
      // Two unlisted answers, fewer than the probes: every near row meets every answer.
      expect(sorted([...first, ...more])).toEqual(expected);
      expect([...first, ...more].every(job => job.plain && job.deepen === undefined)).toBe(true);
    }
  });

  test('the other near rows meet only the lowest unlisted answers of the first stage, and no more rows than ANSWER_NEAR_ROWS', () => {
    const { result, tree } = scene([0, 1, 2, 3]);
    const unlisted = Array.from({ length: ANSWER_SIBLING_PROBES + 5 }, (_, k) => ({ choice: `move w${k} 1, move y 1`, label: `W${k} + Y` }));
    const wide = answerSides({ ...tree, p2Legal: [...tree.p2Options, ...unlisted] }, result)!.find(side => side.side === 'p1')!;
    const first = detectionJobs(wide, result);
    expect(first).toHaveLength(2 + unlisted.length);
    // Unlisted answer k reads 0.9 - k / 100 against the best row: the lowest are the last ones.
    const values = detectedOf(first).map(value => (value.j >= 2 ? { ...value, value: 0.9 - (value.j - 2) / 100 } : value));
    const probed = new Set(siblingJobs(wide, result, values).filter(job => job.i === 1).map(job => job.j));
    const lowest = unlisted.map((_, k) => k + 2).slice(-ANSWER_SIBLING_PROBES);
    expect([...probed].sort((a, b) => a - b)).toEqual([0, 1, ...lowest]);
    expect(new Set(siblingJobs(wide, result, values).map(job => job.i))).toEqual(new Set([1, 2].slice(0, ANSWER_NEAR_ROWS - 1)));
  });

  test('an unlisted answer that refutes any near row is added, checked against the highest near row it refutes, in every order', () => {
    for (const order of NEAR_ORDERS) {
      const { result, view } = scene(order);
      const detected = detect(view, result);
      expect(addedAnswers(view, 'protect', result, detected)).toEqual([2, 3]);
      expect(refutations(view, result, detected)).toEqual([{ answer: 2, row: 1 }, { answer: 3, row: 2 }]);
      expect(addedAnswers(view, 'full', result, detected)).toEqual([2, 3]);
    }
  });

  test('the depth check searches each candidate against its row and keeps the ones that still refute it', () => {
    const deepen: EvalSettings = { depth: 1, samples: 1, tera: false };
    for (const order of NEAR_ORDERS) {
      const { result, view } = scene(order);
      const refuting = refutations(view, result, detect(view, result));
      const jobs = confirmJobs(view, refuting, deepen);
      expect(jobs.map(job => [job.p1Choice, job.p2Choice, job.settings])).toEqual([
        [view.rows[1].choice, 'move protect, move protect', deepen], [view.rows[2].choice, 'move z 1, move y 1', deepen],
      ]);
      // R1 reads 0.995 in the matrix against both listed answers: Protect holds it to 0.3 one ply deeper (kept), the
      // search of R2 against Z + Y reads 0.97, which is not 0.05 below its 0.99 (dropped).
      const deep = (score: number) => ({ score, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } }) as EvalResult;
      expect(confirmedAnswers(view, result, refuting, [deep(0.3), deep(0.97)])).toEqual([2]);
    }
  });

  test('the cells the depth check priced are handed on for the kept answers only, for both sides', () => {
    const { result, view } = scene([0, 1, 2, 3]);
    const refuting = [{ answer: 2, row: 1 }, { answer: 3, row: 2 }];
    const deep = [-0.3, 0.9].map(score => ({ score }) as EvalResult);
    expect(confirmedCells(view, refuting, deep, [2])).toEqual([{ i: 1, j: 2, value: -0.3, ended: false }]);
    expect(confirmedCells(view, refuting, deep, [])).toEqual([]);
    const p2 = answerSides(scene([0, 1, 2, 3]).tree, result)!.find(side => side.side === 'p2')!;
    expect(confirmedCells(p2, [{ answer: 2, row: 0 }], [deep[0]], [2])).toEqual([{ i: 2, j: 0, value: -0.3, ended: false }]);
  });

  test('the graded ranking does not depend on the order either', () => {
    const reference = (() => {
      const { result, view, tree } = scene(NEAR_ORDERS[0]);
      return gradedRanking(view, result, tree, [2], [{ i: 1, j: 2, value: 0.4, ended: false }]).map(row => [row.label, row.ev]);
    })();
    for (const order of NEAR_ORDERS) {
      const { result, view, tree } = scene(order);
      const ranked = gradedRanking(view, result, tree, [2], [{ i: 1, j: 2, value: 0.4, ended: false }]);
      expect(ranked.map(row => [row.label, row.ev])).toEqual(reference);
    }
  });

  test('an answer that refutes the best row and a lower near row is checked against the best row', () => {
    for (const order of NEAR_ORDERS) {
      const { result, view } = scene(order);
      const both = (job: EvalCellJob): EvalCellValue => ({ i: job.i, j: job.j, value: job.j === 2 && job.i <= 1 ? 0.4 : 0.98, ended: false });
      expect(refutations(view, result, [...detectionJobs(view, result), ...siblingJobs(view, result, detectedOf(detectionJobs(view, result)))].map(both))).toEqual([{ answer: 2, row: 0 }]);
    }
  });

  test('a row far below the top is never a near row, and a lone best row reads as before', () => {
    const { result, view } = scene([0, 3, 1, 2]);
    for (const row of result.perSide.p1) if (row.choice !== view.rows[0].choice) row.ev = 0.5;
    expect(nearRows(view, result)).toEqual([0]);
    expect(sorted(detectionJobs(view, result))).toEqual(['0:0', '0:1', '0:2', '0:3']);
    expect(siblingJobs(view, result, detectedOf(detectionJobs(view, result)))).toEqual([]);
  });
});

describe('the added column prices the rows that can decide the ranking one ply deeper (T149)', () => {
  const deepen: EvalSettings = { depth: 1, samples: 1, tera: false };

  test('the best row and the near rows are priced one ply deeper, up to ANSWER_DEEP_ROWS; the others by one plain draw', () => {
    expect(ANSWER_DEEP_ROWS).toBeGreaterThanOrEqual(2);
    const { result, view } = scene([0, 1, 2, 3]);
    const rows = deepRows(view, result);
    expect(rows).toEqual([0, 1, 2].slice(0, ANSWER_DEEP_ROWS));
    const jobs = extensionJobs(view, [2], rows, deepen);
    expect(jobs.map(job => [job.i, job.j])).toEqual([[0, 2], [1, 2], [2, 2], [3, 2]]);
    for (const job of jobs) {
      expect(job).toMatchObject({ samples: 1, plain: true });
      expect(job.deepen).toBe(rows.includes(job.i) ? deepen : undefined);
    }
  });

  test('the deep rows are the near rows with the highest values, whatever the order they came in', () => {
    for (const order of NEAR_ORDERS) {
      const { result, view } = scene(order);
      expect(deepRows(view, result)).toEqual([0, 1, 2].slice(0, ANSWER_DEEP_ROWS));
    }
  });

  test('the p2 side prices its added column the same way (columns of the matrix)', () => {
    const { result, tree } = scene([0, 1, 2, 3]);
    const flipped = {
      ...result,
      perSide: { p1: [], p2: [{ choice: 'move x 1, move y 1', label: 'X + Y', ev: -1, worstCase: -1, expected: -1, punishedBy: 'R0' }] },
    } as unknown as EvalResult;
    const view = answerSides(tree, flipped)!.find(side => side.side === 'p2')!;
    const jobs = extensionJobs(view, [2], deepRows(view, flipped), deepen);
    expect(jobs.map(job => [job.i, job.j, job.deepen === deepen])).toEqual([[2, 0, true], [2, 1, false]]);
  });
});

describe('the named scenes read the same answers in every order of their near rows (T149)', () => {
  const scenes = ['gen9vgc2026regi-2629703929-t4', 'smogtours-gen9doublesou-912045-t6'];

  test.each(scenes)('%s: detection, candidates and deep rows of both sides do not depend on the order of the near rows', { timeout: 240_000 }, async name => {
    const position = JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as {
      serialized: string; tera: EvalSettings['tera']; sleepClause: boolean;
    };
    const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause };
    const trees = await Promise.all([0, 1].map(offset => mctsTreeSearch(position.serialized, settings, offset)));
    const merged = mergeMctsTrees(trees);
    const executor = createLocalTreeExecutor(position.serialized);
    for (const view of answerSides(trees[0], merged)!) {
      const near = nearRows(view, merged);
      const first = await executor.evalCells(detectionJobs(view, merged));
      const detected = [...first, ...await executor.evalCells(siblingJobs(view, merged, first))];
      const reference = { refuting: refutations(view, merged, detected), deep: deepRows(view, merged), jobs: sorted(detectionJobs(view, merged)) };
      expect(near.length).toBeGreaterThan(0);
      // Every order of the near rows in the side's ranking (rows beyond the near tie stay behind them).
      const ranked = merged.perSide[view.side];
      const nearChoices = new Set(near.map(row => view.rows[row].choice));
      const head = ranked.filter(row => nearChoices.has(row.choice));
      const tail = ranked.filter(row => !nearChoices.has(row.choice));
      for (const order of permutations(head.slice(0, 4))) {
        const result = { ...merged, perSide: { ...merged.perSide, [view.side]: [...order, ...head.slice(4), ...tail] } } as EvalResult;
        expect({ refuting: refutations(view, result, detected), deep: deepRows(view, result), jobs: sorted(detectionJobs(view, result)) }).toEqual(reference);
      }
    }
  });
});

interface Scripted { calls: EvalCellJob[][]; afterCheck: EvalCellJob[][]; subSearches: number }

describe('a round that changes the best row sends the new row through one more verify round (T149)', () => {
  const position = JSON.parse(readFileSync(new URL('./fixtures/positions/gen9vgc2026regi-2630685175-t7-played.json', import.meta.url), 'utf-8')) as {
    serialized: string; tera: EvalSettings['tera']; sleepClause: boolean; ruleset: StaticRuleset; keepPlayed: NonNullable<EvalSettings['keepPlayed']>;
  };
  const settings: EvalSettings = {
    depth: 1, samples: 1, mode: 'mcts', tera: position.tera, sleepClause: position.sleepClause, ruleset: position.ruleset, keepPlayed: position.keepPlayed,
  };

  /**
   * The local executor with the answer round's prices scripted: p1's best row meets every unlisted answer at -0.9 in
   * detection and the depth check, so an answer is added; in the extension the row `target` keeps 0.99 against it and
   * every other row reads -0.9, so `target` takes the lead. p2 finds no refutation. Every call is recorded; a verify job
   * on a listed cell is priced 0.3.
   */
  async function run(trees: MctsTreeStats[], merged: EvalResult, target: number, verified = new Map<number, EvalCellValue>()) {
    const listed1 = merged.matrix!.p1Choices!.length;
    const listed2 = merged.matrix!.p2Choices!.length;
    const bestRow = merged.matrix!.p1Choices!.indexOf(merged.perSide.p1[0].choice);
    const base = createLocalTreeExecutor(position.serialized, position.ruleset);
    const log: Scripted = { calls: [], afterCheck: [], subSearches: 0 };
    let extension = false; // set once the depth check has run: from then on the plain and deep jobs are the extension's
    const executor = {
      ...base,
      evalCells: async (jobs: EvalCellJob[]): Promise<EvalCellValue[]> => {
        log.calls.push(jobs);
        if (extension) log.afterCheck.push(jobs);
        return jobs.map(job => {
          const p1Side = job.j >= listed2;
          const p2Side = job.i >= listed1;
          if (p2Side) return { i: job.i, j: job.j, value: 0, ended: false };
          if (p1Side) return { i: job.i, j: job.j, value: (extension ? job.i === target : job.i !== bestRow) ? 0.99 : -0.9, ended: false };
          return { i: job.i, j: job.j, value: 0.3, ended: false };
        });
      },
      subSearch: async () => { log.subSearches += 1; extension = true; return { score: -0.9, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } } as unknown as EvalResult; },
    };
    const result = await answerRound(executor, trees, { result: merged, values: verified, focus: {} }, settings);
    return { log, result, bestRow, listed2 };
  }

  /** The calls of the round that are verify cells: the re-check (the extension's deepened cells are plain draws). */
  const rechecks = (log: Scripted) => log.calls.filter(jobs => jobs.some(job => job.deepen !== undefined && !job.plain));

  test('a changed best row triggers exactly one more cells round with the new row’s unverified cells, an unchanged one none', { timeout: 240_000 }, async () => {
    const trees = await Promise.all([0, 1].map(offset => mctsTreeSearch(position.serialized, settings, offset)));
    const merged = mergeMctsTrees(trees);
    expect(answerSides(trees[0], merged)).not.toBeNull();
    const choices = merged.matrix!.p1Choices!;
    const bestRow = choices.indexOf(merged.perSide.p1[0].choice);
    // A row that is not the best one and has starved cells once it leads: the ranking after the flip selects them.
    const leading = (row: number): EvalResult['perSide'] => {
      const lead = merged.perSide.p1.find(entry => entry.choice === choices[row])!;
      return { ...merged.perSide, p1: [lead, ...merged.perSide.p1.filter(entry => entry !== lead)] };
    };
    const target = choices.findIndex((_, row) => row !== bestRow && starvedSupportCells(trees, { ...merged, perSide: leading(row) }, {}).some(job => job.i === row));
    expect(target).toBeGreaterThanOrEqual(0);

    const spy = (log: EvalCellJob[][]): TreeExecutor => ({
      ...createLocalTreeExecutor(position.serialized, position.ruleset),
      evalCells: async jobs => { log.push(jobs); return jobs.map(job => ({ i: job.i, j: job.j, value: 0.3, ended: false })); },
    });
    const round = { result: merged, values: new Map<number, EvalCellValue>(), focus: {} };

    const stayLog: EvalCellJob[][] = [];
    expect(await recheckedRound(spy(stayLog), trees, round, leading(bestRow), () => merged.perSide, settings)).toBeNull();
    expect(stayLog).toHaveLength(0);

    const log: EvalCellJob[][] = [];
    const rechecked = await recheckedRound(spy(log), trees, round, leading(target), () => leading(target), settings);
    expect(rechecked).not.toBeNull();
    expect(log).toHaveLength(1);
    expect(new Set(log[0].map(job => job.i))).toEqual(new Set([target]));
    expect(log[0].every(job => job.deepen !== undefined)).toBe(true);
    expect(rechecked!.perSide.p1[0].choice).toBe(choices[target]);

    // The cells a verify round priced before are not asked again.
    const skip = log[0][0];
    const priced = { ...round, values: new Map([[cellKey(skip.i, skip.j), { i: skip.i, j: skip.j, value: 0.3, ended: false }]]) };
    const againLog: EvalCellJob[][] = [];
    await recheckedRound(spy(againLog), trees, priced, leading(target), () => leading(target), settings);
    expect(againLog.flat().some(job => job.i === skip.i && job.j === skip.j)).toBe(false);
    expect(againLog.flat().length).toBe(log[0].length - 1);
  });

  test('the answer round prices the deep rows of the added column one ply deeper, takes the depth check’s cells as they are, and re-checks at most once', { timeout: 240_000 }, async () => {
    const trees = await Promise.all([0, 1].map(offset => mctsTreeSearch(position.serialized, settings, offset)));
    const merged = mergeMctsTrees(trees);
    const bestRow = merged.matrix!.p1Choices!.indexOf(merged.perSide.p1[0].choice);
    const round = await run(trees, merged, bestRow);
    expect(round.log.subSearches).toBeGreaterThan(0);
    expect(rechecks(round.log).length).toBeLessThanOrEqual(1);
    // The detection refuted the best row only, so its cells against the added answers come from the depth check.
    // (The runner-up here lies outside the near tie, so no other row is deep and the extension is plain draws.)
    const listed1 = merged.matrix!.p1Choices!.length;
    const extension = round.log.afterCheck.flat().filter(job => job.j >= round.listed2 && job.i < listed1);
    expect(extension.length).toBeGreaterThan(0);
    expect(extension.some(job => job.i === bestRow)).toBe(false);
    const deepRowsNow = new Set(extension.filter(job => job.deepen !== undefined).map(job => job.i));
    expect(deepRowsNow.size).toBeLessThanOrEqual(ANSWER_DEEP_ROWS);
    expect(extension.filter(job => job.deepen === undefined).every(job => !deepRowsNow.has(job.i))).toBe(true);
  });
});
