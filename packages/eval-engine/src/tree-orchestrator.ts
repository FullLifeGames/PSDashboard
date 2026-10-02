import { mctsTreeSearch } from './mcts.ts';
import { MCTS_TREES, mergeMctsTrees, rowCompletedCells, starvedSupportCells } from './mcts-merge.ts';
import type { OrchestratorCallbacks, SearchExecutor } from './orchestrator.ts';
import { perfAdd, perfSync } from './perf-trace.ts';
import { cellKey } from './rank.ts';
import { applyForcedWin, forcedWinInput } from './search/forced-win-apply.ts';
import { createLocalExecutor } from './search/position.ts';
import type { EvalCellJob, EvalCellValue, EvalResult, EvalSettings, MctsTreeStats, SearchProgress } from './types.ts';

/**
 * Round 61: the tree search's orchestration, one place for the app and the
 * bank. Root parallelization over a FIXED number of trees (seed offsets
 * 0..N-1, never the pool size), merged by summed root statistics; cells the
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
  const doneByTree = new Array<number>(MCTS_TREES).fill(0);
  let totalPerTree = 1;
  const completed: MctsTreeStats[] = [];
  return Promise.all(Array.from({ length: MCTS_TREES }, async (_, offset) => {
    const started = Date.now();
    const tree = await executor.tree(settings, offset, progress => {
      doneByTree[offset] = progress.done;
      totalPerTree = progress.total;
      callbacks?.onProgress?.({
        done: doneByTree.reduce((sum, done) => sum + done, 0),
        total: MCTS_TREES * totalPerTree,
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

/** Round 33: one more ply for every verified cell that did not end, so a verified row is priced at one depth. */
async function deepenVerified(executor: TreeExecutor, jobs: EvalCellJob[], values: EvalCellValue[], settings: EvalSettings): Promise<void> {
  const jobByKey = new Map(jobs.map(job => [cellKey(job.i, job.j), job]));
  const subSettings: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause };
  const started = Date.now();
  await Promise.all(values.map(async value => {
    const job = jobByKey.get(cellKey(value.i, value.j));
    if (value.ended || !job) return;
    const sub = await executor.subSearch({ i: value.i, j: value.j, p1Choice: job.p1Choice, p2Choice: job.p2Choice, settings: subSettings });
    value.deepened = sub.score;
  }));
  perfAdd('verify-deepen', Date.now() - started);
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
    const values = await executor.evalCells(jobs);
    if (stopped(callbacks)) return merged;
    await deepenVerified(executor, jobs, values, settings);
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
