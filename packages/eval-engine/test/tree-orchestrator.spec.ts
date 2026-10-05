import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { mctsTreeSearch } from '../src/mcts';
import { MCTS_TREES, mergeMctsTrees, rowCompletedCells, starvedSupportCells } from '../src/mcts-merge';
import { createLocalExecutor } from '../src/search';
import { applyForcedWin, forcedWinInput } from '../src/search/forced-win-apply';
import { cellKey } from '../src/rank';
import { createLocalTreeExecutor, searchTreesOrchestrated, type TreeExecutor } from '../src/tree-orchestrator';
import type { EvalResult, EvalSettings } from '../src/types';

const position = (name: string) =>
  (JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as { serialized: string }).serialized;
const CASES = ['smogtours-gen9ou-749828-t23', 'gen9ou-2658658993-t2', 'gen9doublesou-2663093831-t12'];

/**
 * The tree path by hand, sequential: four trees, merge, the verify cells as one cells round that goes one
 * ply deeper per outcome (round 63, T16; before, a sub-search per cell on its first-seed child), merge, prover.
 */
async function handPipeline(serialized: string, settings: EvalSettings): Promise<{ result: EvalResult; jobs: number }> {
  const trees = Array.from({ length: MCTS_TREES }, (_, offset) => mctsTreeSearch(serialized, settings, offset));
  const merged = mergeMctsTrees(trees);
  const jobs = rowCompletedCells(trees, merged, starvedSupportCells(trees, merged));
  let result = merged;
  if (jobs.length > 0) {
    const deepen: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause };
    const values = await createLocalExecutor(serialized).evalCells(jobs.map(job => ({ ...job, deepen })));
    result = mergeMctsTrees(trees, new Map(values.map(value => [cellKey(value.i, value.j), value])));
  }
  if (settings.prove !== false) applyForcedWin(result, await createLocalExecutor(serialized).prove(forcedWinInput(result, settings)));
  return { result, jobs: jobs.length };
}

describe('tree orchestration (round 61)', () => {
  test('equals the tree path by hand on singles and doubles positions', { timeout: 900_000 }, async () => {
    let verified = 0;
    for (const name of CASES) {
      const serialized = position(name);
      const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: true };
      const before = await handPipeline(serialized, settings);
      const now = await searchTreesOrchestrated(createLocalTreeExecutor(serialized), settings);
      expect(now, name).toEqual(before.result);
      if (before.jobs > 0) verified++;
    }
    expect(verified, 'at least one case runs the verify round').toBeGreaterThan(0);
  });

  test('a stop after the trees skips verify and prover', { timeout: 300_000 }, async () => {
    const serialized = position(CASES[0]);
    const local = createLocalTreeExecutor(serialized);
    const calls = { evalCells: 0, prove: 0, partial: 0 };
    let stop = false;
    let trees = 0;
    const executor: TreeExecutor = {
      ...local,
      tree: async (settings, offset, onProgress) => {
        const tree = await local.tree(settings, offset, onProgress);
        if (++trees === MCTS_TREES) stop = true;
        return tree;
      },
      evalCells: async jobs => { calls.evalCells++; return local.evalCells(jobs); },
      prove: async input => { calls.prove++; return local.prove(input); },
    };
    await searchTreesOrchestrated(executor, { depth: 1, samples: 1, mode: 'mcts' }, {
      shouldStop: () => stop,
      onPartial: () => { if (stop) calls.partial++; },
    });
    expect(calls).toEqual({ evalCells: 0, prove: 0, partial: 0 });
  });

  test('a failing verify round returns the unverified merge and still proves', { timeout: 600_000 }, async () => {
    for (const name of CASES) {
      const serialized = position(name);
      const settings: EvalSettings = { depth: 1, samples: 1, mode: 'mcts', tera: true };
      const trees = Array.from({ length: MCTS_TREES }, (_, offset) => mctsTreeSearch(serialized, settings, offset));
      const merged = mergeMctsTrees(trees);
      if (rowCompletedCells(trees, merged, starvedSupportCells(trees, merged)).length === 0) continue;
      applyForcedWin(merged, await createLocalExecutor(serialized).prove(forcedWinInput(merged, settings)));
      const local = createLocalTreeExecutor(serialized);
      const executor: TreeExecutor = { ...local, evalCells: async () => { throw new Error('worker crashed'); } };
      expect(await searchTreesOrchestrated(executor, settings), name).toEqual(merged);
      return;
    }
    throw new Error('no case runs the verify round');
  });
});
