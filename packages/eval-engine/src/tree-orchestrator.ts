import { mctsTreeSearch } from './mcts.ts';
import { mergeMctsTrees } from './mcts-merge.ts';
import type { OrchestratorCallbacks, SearchExecutor } from './orchestrator.ts';
import { perfAdd, perfSync } from './perf-trace.ts';
import { cellKey } from './rank.ts';
import { searchBudget } from './search/budget.ts';
import { applyForcedWin, forcedWinInput } from './search/forced-win-apply.ts';
import { createLocalExecutor } from './search/position.ts';
import type { EvalCellJob, EvalCellValue, EvalResult, EvalSettings, MctsTreeStats, SearchProgress } from './types.ts';
import type { StaticRuleset } from './score/weights.ts';
import { boundaryCheckCells, playedIndices, rowCompletedCells, starvedSupportCells, type VerifyFocus } from './verify-select.ts';
import {
  addedAnswers, answerSides, answersMode, confirmedAnswers, confirmJobs, detectionJobs, extensionJobs, gradedRanking,
  type AnswerSide, type AnswersMode,
} from './search/answers.ts';

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

export function createLocalTreeExecutor(serializedBattle: string, ruleset: StaticRuleset = 'standard'): TreeExecutor {
  return {
    ...createLocalExecutor(serializedBattle, ruleset),
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
  const deepen: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause, ruleset: settings.ruleset };
  const started = Date.now();
  const values = await executor.evalCells(jobs.map(job => ({ ...job, deepen })));
  perfAdd('verify-deepen', Date.now() - started);
  return values;
}

/**
 * Round 63 (T78): a doubles tree ships no boundary list, so the pair plan
 * prices the support and played cells the visit stats leave out, in one
 * cells round without deepening; a cell it prices with classes is a
 * boundary cell. Singles has nothing to check.
 */
async function pairPlanBoundary(
  executor: TreeExecutor, trees: MctsTreeStats[], merged: EvalResult, played: VerifyFocus['played'],
): Promise<Set<number>> {
  const checks = boundaryCheckCells(trees, merged, { played });
  if (checks.length === 0) return new Set();
  const values = await executor.evalCells(checks);
  return new Set(values.filter(value => value.blend).map(value => cellKey(value.i, value.j)));
}

/**
 * Starved-support verification: cells the merged equilibrium leans on with
 * too few pooled visits carry ONE chance outcome per tree; re-price them with
 * the matrix-grade multi-seed sampler before the verdict stands. Round 63
 * (T78): the played row and column count as support, and the pair plan
 * names the doubles boundary cells. The score is the visit mean either way;
 * only rankings sharpen.
 */
async function verifiedMerge(
  executor: TreeExecutor, trees: MctsTreeStats[], settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const merged = perfSync('main:mcts-merge', () => mergeMctsTrees(trees));
  if (stopped(callbacks)) return merged;
  try {
    const played = playedIndices(trees, merged, settings.keepPlayed);
    const focus: VerifyFocus = { played, boundary: await pairPlanBoundary(executor, trees, merged, played) };
    if (stopped(callbacks)) return merged;
    const jobs = perfSync('main:starved-cells', () => rowCompletedCells(trees, merged, starvedSupportCells(trees, merged, focus), focus));
    if (jobs.length === 0) return merged;
    callbacks?.onPartial?.(merged);
    const values = await verifyCells(executor, jobs, settings);
    if (stopped(callbacks)) return merged;
    return perfSync('main:mcts-merge', () =>
      mergeMctsTrees(trees, new Map(values.map(value => [cellKey(value.i, value.j), value]))));
  } catch {
    // Verification is a refinement: a failed round degrades to the unverified merge.
    return merged;
  }
}

/** One side's answers to add: every unlisted one ('full'), or the candidates the deeper search confirms ('protect'). */
async function sideAnswers(
  executor: TreeExecutor, view: AnswerSide, merged: EvalResult, mode: AnswersMode, deepen: EvalSettings,
): Promise<number[]> {
  if (mode === 'full') return addedAnswers(view, mode, []);
  const jobs = detectionJobs(view, merged);
  if (jobs.length === 0) return [];
  const candidates = addedAnswers(view, mode, await executor.evalCells(jobs));
  if (candidates.length === 0) return [];
  const deep = await Promise.all(confirmJobs(view, merged, candidates, deepen).map(job => executor.subSearch(job)));
  return confirmedAnswers(view, merged, candidates, deep);
}

/**
 * Round 67 (T128): the doubles root's answer round (search/answers.ts).
 * After the verify round each side is graded against the other side's legal
 * answers the tree did not list, each priced by one natural draw: 'protect'
 * adds the answers that beat the listed ones against the side's best row and
 * still do one ply deeper (since b4), 'full' every unlisted one. Like
 * verification a refinement: a failed round keeps the verified merge, and
 * the score stays the visit mean.
 */
async function answerRound(
  executor: TreeExecutor, trees: MctsTreeStats[], merged: EvalResult, settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const mode = answersMode();
  const sides = mode === 'off' ? null : answerSides(trees[0], merged);
  if (!sides || stopped(callbacks)) return merged;
  const started = Date.now();
  try {
    const deepen: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause, ruleset: settings.ruleset };
    const added = await Promise.all(sides.map(view => sideAnswers(executor, view, merged, mode, deepen)));
    if (stopped(callbacks) || added.every(list => list.length === 0)) return merged;
    const perSide = await Promise.all(sides.map(async (view, index) => (added[index].length === 0
      ? merged.perSide[view.side]
      : gradedRanking(view, merged, trees[0], added[index], await executor.evalCells(extensionJobs(view, added[index]))))));
    return stopped(callbacks) ? merged : { ...merged, perSide: { p1: perSide[0], p2: perSide[1] } };
  } catch {
    return merged;
  } finally {
    perfAdd('answer-round', Date.now() - started);
  }
}

export async function searchTreesOrchestrated(
  executor: TreeExecutor, settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const trees = await runTrees(executor, settings, callbacks);
  const result = await answerRound(executor, trees, await verifiedMerge(executor, trees, settings, callbacks), settings, callbacks);
  if (stopped(callbacks) || settings.prove === false) return result;
  const started = Date.now();
  const outcome = await executor.prove(forcedWinInput(result, settings));
  perfAdd('prover', Date.now() - started);
  if (!stopped(callbacks)) applyForcedWin(result, outcome);
  return result;
}
