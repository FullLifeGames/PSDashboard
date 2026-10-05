import { mctsTreeSearch } from './mcts.ts';
import { mergeMctsTrees, rowCompletedCells, starvedSupportCells } from './mcts-merge.ts';
import type { OrchestratorCallbacks, SearchExecutor } from './orchestrator.ts';
import { perfAdd, perfSync } from './perf-trace.ts';
import { cellKey } from './rank.ts';
import { searchBudget } from './search/budget.ts';
import { applyForcedWin, forcedWinInput } from './search/forced-win-apply.ts';
import { createLocalExecutor } from './search/position.ts';
import type { EvalCellJob, EvalCellValue, EvalResult, EvalSettings, MctsTreeStats, SearchProgress } from './types.ts';

/**
 * Round 61: the tree search's orchestration, one place for the app and the
 * bank. Root parallelization over a FIXED number of trees (seed offsets
 * 0..N-1 from the search budget, never the pool size), merged by summed root statistics; cells the
 * merged equilibrium leans on with too few visits are re-priced with the
 * multi-seed sampler and deepened one ply (draft t56, round 33); the
 * forced-win prover runs on the result (round 35). The app passes its
 * worker pool, the bank an in-process executor.
 */
export interface TreeExecutor extends SearchExecutor {
  /** One DUCT tree with this seed offset. */
  tree(settings: EvalSettings, seedOffset: number, onProgress?: (progress: SearchProgress) => void): Promise<MctsTreeStats>;
}

export function createLocalTreeExecutor(serializedBattle: string): TreeExecutor {
  return {
    ...createLocalExecutor(serializedBattle),
    tree: async (settings, seedOffset, onProgress) =>
      mctsTreeSearch(serializedBattle, settings, seedOffset, onProgress ? { onProgress } : undefined),
  };
}

const stopped = (callbacks?: OrchestratorCallbacks) => callbacks?.shouldStop?.() === true;

function runTrees(executor: TreeExecutor, settings: EvalSettings, callbacks?: OrchestratorCallbacks): Promise<MctsTreeStats[]> {
  const treeCount = searchBudget().trees;
  const doneByTree = new Array<number>(treeCount).fill(0);
  let totalPerTree = 1;
  const completed: MctsTreeStats[] = [];
  return Promise.all(Array.from({ length: treeCount }, async (_, offset) => {
    const started = Date.now();
    const tree = await executor.tree(settings, offset, progress => {
      doneByTree[offset] = progress.done;
      totalPerTree = progress.total;
      callbacks?.onProgress?.({
        done: doneByTree.reduce((sum, done) => sum + done, 0),
        total: treeCount * totalPerTree,
        depth: progress.depth,
      });
    });
    perfAdd('tree-wall', Date.now() - started);
    if (!stopped(callbacks)) {
      completed.push(tree);
      callbacks?.onPartial?.(perfSync('main:mcts-merge', () => mergeMctsTrees([...completed])));
    }
    return tree;
  }));
}

/**
 * Round 33: one more ply for every verified cell, so a verified row is
 * priced at one depth. Round 63 (T16): the cells job itself goes one ply
 * deeper per outcome (every open class, a plain cell's outcome groups), so
 * the span now holds the sampling as well.
 */
async function verifyCells(executor: TreeExecutor, jobs: EvalCellJob[], settings: EvalSettings): Promise<EvalCellValue[]> {
  const deepen: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause };
  const started = Date.now();
  const values = await executor.evalCells(jobs.map(job => ({ ...job, deepen })));
  perfAdd('verify-deepen', Date.now() - started);
  return values;
}

/**
 * Starved-support verification: cells the merged equilibrium leans on with
 * too few pooled visits carry ONE chance outcome per tree; re-price them with
 * the matrix-grade multi-seed sampler before the verdict stands. The score is
 * the visit mean either way; only rankings sharpen.
 */
async function verifiedMerge(
  executor: TreeExecutor, trees: MctsTreeStats[], settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const merged = perfSync('main:mcts-merge', () => mergeMctsTrees(trees));
  if (stopped(callbacks)) return merged;
  const jobs = perfSync('main:starved-cells', () => rowCompletedCells(trees, merged, starvedSupportCells(trees, merged)));
  if (jobs.length === 0) return merged;
  callbacks?.onPartial?.(merged);
  try {
    const values = await verifyCells(executor, jobs, settings);
    if (stopped(callbacks)) return merged;
    return perfSync('main:mcts-merge', () =>
      mergeMctsTrees(trees, new Map(values.map(value => [cellKey(value.i, value.j), value]))));
  } catch {
    // Verification is a refinement: a failed round degrades to the unverified merge.
    return merged;
  }
}

export async function searchTreesOrchestrated(
  executor: TreeExecutor, settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const trees = await runTrees(executor, settings, callbacks);
  const result = await verifiedMerge(executor, trees, settings, callbacks);
  if (stopped(callbacks) || settings.prove === false) return result;
  const started = Date.now();
  const outcome = await executor.prove(forcedWinInput(result, settings));
  perfAdd('prover', Date.now() - started);
  if (!stopped(callbacks)) applyForcedWin(result, outcome);
  return result;
}
