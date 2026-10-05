import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { mctsTreeSearch } from '../src/mcts';
import { mergeMctsTrees, rowCompletedCells, starvedSupportCells } from '../src/mcts-merge';
import { boundaryCheckCells, playedIndices, VERIFY_CELL_CAP } from '../src/verify-select';
import { cellKey } from '../src/rank';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type { EvalCellJob, EvalSettings, MctsTreeStats } from '../src/types';
import type { PlayedAction } from '../src/played';

/**
 * Round 63 (T78): the verify step checks the played row and column in both
 * game types, and a doubles tree's boundary cells come from the pair plan.
 * Before, the verify set was support × support plus the ranked top three,
 * and a doubles tree flagged no boundary cell (planCellEvents gives up on
 * comma choices), so VGC 2629703929 t13 never priced Flare Blitz's 58 %
 * kill on Solgaleo and p2's winning Psychic Fangs read as an inaccuracy.
 */

const position = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as {
    serialized: string; tera?: EvalSettings['tera']; sleepClause?: boolean; keepPlayed?: EvalSettings['keepPlayed'];
  };

describe('the played row and column join the verify set (round 63, T78)', () => {
  const emptyResult = { score: 0, interval: 0, depthCompleted: 2, perSide: { p1: [], p2: [] } };
  const cell = (i: number, j: number, visits: number, mean: number) =>
    ({ key: cellKey(i, j), visits, total: mean * (visits + 1) - mean, value: mean, ended: false });
  // Five p1 rows from a clear best (A) to a clear worst (E); E×X is starved, every other cell is rich and agrees.
  const rows = [[0.5, 0.4], [0.1, 0.1], [0, 0], [-0.3, -0.3], [-0.6, -0.6]];
  const mk = (p1: string[], p2: string[]): MctsTreeStats => ({
    p1Options: p1.map(choice => ({ choice, label: choice })), p2Options: p2.map(choice => ({ choice, label: choice })),
    p1N: [40, 10, 10, 10, 10], p1W: [18, 1, 0, -3, -6], p2N: [40, 40], p2W: [0, 0],
    visits: 80, depth: 2, rootValue: 0, result: emptyResult, boundaryCells: [],
    cells: rows.flatMap((values, i) => values.map((mean, j) => cell(i, j, i === 4 && j === 0 ? 1 : 20, mean))),
  });

  for (const [shape, p1, p2] of [
    ['singles choices', ['move a', 'move b', 'move c', 'move d', 'move e'], ['move x', 'move y']],
    ['doubles combined choices', ['move a 1, move f 2', 'move b 1, move f 2', 'move c 1, move f 2', 'move d 1, move f 2', 'move e 1, move f 2'],
      ['move x 1, move z 2', 'move y 1, move z 2']],
  ] as const) {
    test(`the played row meets the support columns (${shape})`, () => {
      const trees = [mk([...p1], [...p2]), mk([...p1], [...p2]), mk([...p1], [...p2])];
      const merged = mergeMctsTrees(trees);
      const pairs = (jobs: EvalCellJob[]) => jobs.map(job => cellKey(job.i, job.j));
      // E is neither support nor among the ranked top three: today it is never checked.
      expect(pairs(starvedSupportCells(trees, merged))).not.toContain(cellKey(4, 0));
      const focus = { played: { p1: 4 } };
      const jobs = rowCompletedCells(trees, merged, starvedSupportCells(trees, merged, focus), focus);
      expect(pairs(jobs)).toContain(cellKey(4, 0));
      expect(pairs(jobs)).not.toContain(cellKey(4, 1)); // rich and agreeing: no job
      expect(jobs.length).toBeLessThanOrEqual(VERIFY_CELL_CAP);
    });
  }
});

describe('played options from keepPlayed (round 63, T78)', () => {
  const move = (name: string, extra: Partial<PlayedAction> = {}): PlayedAction => ({ kind: 'move', name, ...extra } as PlayedAction);
  const ranked = (choices: [string, string, number][]) => choices.map(([choice, label, ev]) => ({ choice, label, ev, worstCase: ev, expected: ev, punishedBy: null }));

  test('singles: the played action, a move or a switch', () => {
    const result = {
      score: 0, interval: 0, depthCompleted: 1,
      perSide: {
        p1: ranked([['move scald', 'Scald', 0.2], ['move toxic', 'Toxic', 0.1]]),
        p2: ranked([['move earthquake', 'Earthquake', 0.3], ['switch 3', '→ Corviknight', -0.1]]),
      },
    };
    const trees = [{ p1Options: [{ choice: 'move scald', label: 'Scald' }, { choice: 'move toxic', label: 'Toxic' }], p2Options: [{ choice: 'move earthquake', label: 'Earthquake' }, { choice: 'switch 3', label: '→ Corviknight' }] }];
    expect(playedIndices(trees as never, result as never, { p1: move('Toxic'), p2: { kind: 'switch', name: 'Corv', species: 'Corviknight' } as PlayedAction }))
      .toEqual({ p1: 1, p2: 1 });
  });

  test('doubles: slots match the combined option; a hidden slot takes the charitable consistent one', () => {
    const p1 = [['move flareblitz 1, move roar 2', 'Flare Blitz→Solgaleo + Roar→Raging Bolt', 0.1], ['move flareblitz 1, move protect', 'Flare Blitz→Solgaleo + Protect', 0.3], ['move protect, move protect', 'Protect + Protect', 0]] as [string, string, number][];
    const result = { score: 0, interval: 0, depthCompleted: 1, perSide: { p1: ranked(p1), p2: [] } };
    const trees = [{ p1Options: p1.map(([choice, label]) => ({ choice, label })), p2Options: [] }];
    const flare = move('Flare Blitz', { targetLoc: 1 });
    expect(playedIndices(trees as never, result as never, { p1Slots: [flare, move('Roar', { targetLoc: 2 })] })).toEqual({ p1: 0 });
    expect(playedIndices(trees as never, result as never, { p1Slots: [flare, null] })).toEqual({ p1: 1 });
    expect(playedIndices(trees as never, result as never, undefined)).toEqual({});
  });
});

describe('doubles boundary cells come from the pair plan (round 63, T78)', () => {
  const settingsOf = (fixture: ReturnType<typeof position>): EvalSettings => ({
    depth: 1, samples: 1, mode: 'mcts', tera: fixture.tera ?? true, sleepClause: fixture.sleepClause, keepPlayed: fixture.keepPlayed ?? undefined,
  });

  test('a doubles tree ships no boundary list; a singles tree keeps its analytic one', { timeout: 120_000 }, () => {
    const doubles = position('gen9vgc2026regi-2629703929-t13');
    expect(mctsTreeSearch(doubles.serialized, settingsOf(doubles), 0).boundaryCells).toBeUndefined();
    const singles = position('smogtours-gen8ou-573756-t73');
    expect(mctsTreeSearch(singles.serialized, settingsOf(singles), 0).boundaryCells).toEqual(expect.any(Array));
  });

  test('the verify step asks the pair plan about doubles candidates the visits do not flag; singles has one round', { timeout: 300_000 }, async () => {
    const rounds = async (name: string) => {
      const fixture = position(name);
      const local = createLocalTreeExecutor(fixture.serialized);
      const calls: { jobs: EvalCellJob[]; blends: Set<number> }[] = [];
      const trees: MctsTreeStats[] = [];
      const executor: TreeExecutor = {
        ...local,
        tree: async (s, offset, onProgress) => { const tree = await local.tree(s, offset, onProgress); trees[offset] = tree; return tree; },
        evalCells: async (jobs, onDone) => {
          const values = await local.evalCells(jobs, onDone);
          calls.push({ jobs, blends: new Set(values.filter(value => value.blend).map(value => cellKey(value.i, value.j))) });
          return values;
        },
      };
      await searchTreesOrchestrated(executor, settingsOf(fixture));
      return { calls, trees };
    };
    const doubles = await rounds('gen9vgc2026regi-2629703929-t13');
    expect(doubles.calls.length).toBe(2);
    const [check, verify] = doubles.calls;
    for (const job of check.jobs) expect(job.deepen).toBeUndefined();
    for (const job of verify.jobs) expect(job.deepen).toBeDefined();
    expect(verify.jobs.length).toBeLessThanOrEqual(VERIFY_CELL_CAP);
    // The check round asks exactly the cells the visits leave out; a checked cell the pair plan priced with
    // classes becomes a boundary cell and a starved-support job, one it did not price stays out of that list
    // (it may still join by row completion).
    const merged = mergeMctsTrees(doubles.trees);
    const played = playedIndices(doubles.trees, merged, position('gen9vgc2026regi-2629703929-t13').keepPlayed);
    const checks = boundaryCheckCells(doubles.trees, merged, { played });
    const keyOf = (job: EvalCellJob) => cellKey(job.i, job.j);
    expect(check.jobs.map(keyOf)).toEqual(checks.map(keyOf));
    const starved = new Set(starvedSupportCells(doubles.trees, merged, { played, boundary: check.blends }).map(keyOf));
    for (const job of checks) {
      if (!check.blends.has(keyOf(job))) expect(starved.has(keyOf(job)), `${job.p1Choice} × ${job.p2Choice}`).toBe(false);
    }
    expect([...check.blends].some(key => starved.has(key))).toBe(true);
    const verified = new Set(verify.jobs.map(keyOf));
    for (const key of starved) expect(verified.has(key)).toBe(true);
    const singles = await rounds('smogtours-gen8ou-573756-t73');
    expect(singles.calls.length).toBe(1);
  });
});
