import { mctsTreeSearch } from './mcts.ts';
import { mergeMctsTrees } from './mcts-merge.ts';
import type { OrchestratorCallbacks, SearchExecutor } from './orchestrator.ts';
import { perfAdd, perfCount, perfSync } from './perf-trace.ts';
import { cellKey } from './rank.ts';
import { searchBudget } from './search/budget.ts';
import { applyForcedWin, forcedWinInput } from './search/forced-win-apply.ts';
import { lineRequests } from './search/line-donors.ts';
import { createLocalExecutor } from './search/position.ts';
import type { EvalCellJob, EvalCellValue, EvalResult, EvalSettings, MctsTreeStats, SearchProgress } from './types.ts';
import type { StaticRuleset } from './score/weights.ts';
import { boundaryCheckCells, playedIndices, rowCompletedCells, starvedSupportCells, type VerifyFocus } from './verify-select.ts';
import {
  addedAnswers, answerSides, answersMode, confirmedAnswers, confirmedCells, confirmJobs, deepRows, detectionJobs, extensionJobs, gradedRanking, refutations, siblingJobs,
  type AnswerSide, type AnswersMode,
} from './search/answers.ts';

export interface TreeExecutor extends SearchExecutor {
  /** One DUCT tree for this seed offset; `onPartial` is asked of tree 0 only, and only while a caller listens. */
  tree(
    settings: EvalSettings, seedOffset: number, onProgress?: (progress: SearchProgress) => void, onPartial?: (result: EvalResult) => void,
  ): Promise<MctsTreeStats>;
}

export function createLocalTreeExecutor(serializedBattle: string, ruleset: StaticRuleset = 'standard'): TreeExecutor {
  return {
    ...createLocalExecutor(serializedBattle, ruleset),
    tree: async (settings, seedOffset, onProgress, onPartial) =>
      mctsTreeSearch(serializedBattle, settings, seedOffset, onProgress || onPartial ? { ...(onProgress && { onProgress }), ...(onPartial && { onPartial }) } : undefined),
  };
}

const stopped = (callbacks?: OrchestratorCallbacks) => callbacks?.shouldStop?.() === true;

// Reading tree 0's interim result changes no node (`toResult` only reads): the search is the same with and without it.
function interim(offset: number, completed: MctsTreeStats[], callbacks?: OrchestratorCallbacks): ((result: EvalResult) => void) | undefined {
  const listener = callbacks?.onPartial;
  if (offset !== 0 || !listener) return undefined;
  return result => { if (completed.length === 0 && !stopped(callbacks)) listener(result); };
}

function runTrees(executor: TreeExecutor, settings: EvalSettings, callbacks?: OrchestratorCallbacks): Promise<MctsTreeStats[]> {
  // A FIXED number of trees (seed offsets 0..N-1 from the search budget, never the pool size).
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
    }, interim(offset, completed, callbacks));
    perfAdd('tree-wall', Date.now() - started);
    if (!stopped(callbacks)) {
      completed.push(tree);
      callbacks?.onPartial?.(perfSync('main:mcts-merge', () => mergeMctsTrees([...completed])));
    }
    return tree;
  }));
}

async function verifyCells(executor: TreeExecutor, jobs: EvalCellJob[], settings: EvalSettings): Promise<EvalCellValue[]> {
  const deepen: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause, ruleset: settings.ruleset };
  const started = Date.now();
  const values = await executor.evalCells(jobs.map(job => ({ ...job, deepen })));
  perfAdd('verify-deepen', Date.now() - started);
  return values;
}

async function pairPlanBoundary(
  executor: TreeExecutor, trees: MctsTreeStats[], merged: EvalResult, played: VerifyFocus['played'],
): Promise<Set<number>> {
  const checks = boundaryCheckCells(trees, merged, { played });
  if (checks.length === 0) return new Set();
  const values = await executor.evalCells(checks);
  return new Set(values.filter(value => value.blend).map(value => cellKey(value.i, value.j)));
}

export interface Verified { result: EvalResult; values: Map<number, EvalCellValue>; focus: VerifyFocus }

// Re-prices thin cells with the multi-seed sampler; the score stays the visit mean, only rankings sharpen.
async function verifiedMerge(
  executor: TreeExecutor, trees: MctsTreeStats[], settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<Verified> {
  const merged = perfSync('main:mcts-merge', () => mergeMctsTrees(trees));
  const unverified: Verified = { result: merged, values: new Map(), focus: {} };
  if (stopped(callbacks)) return unverified;
  try {
    const played = playedIndices(trees, merged, settings.keepPlayed);
    const focus: VerifyFocus = { played, boundary: await pairPlanBoundary(executor, trees, merged, played) };
    if (stopped(callbacks)) return unverified;
    const jobs = perfSync('main:starved-cells', () => rowCompletedCells(trees, merged, starvedSupportCells(trees, merged, focus), focus));
    if (jobs.length === 0) return { ...unverified, focus };
    callbacks?.onPartial?.(merged);
    const values = new Map((await verifyCells(executor, jobs, settings)).map(value => [cellKey(value.i, value.j), value]));
    if (stopped(callbacks)) return unverified;
    return { result: perfSync('main:mcts-merge', () => mergeMctsTrees(trees, values)), values, focus };
  } catch {
    return unverified;
  }
}

interface SideAnswers { added: number[]; known: EvalCellValue[] }

async function sideAnswers(
  executor: TreeExecutor, view: AnswerSide, merged: EvalResult, mode: AnswersMode, deepen: EvalSettings,
): Promise<SideAnswers> {
  if (mode === 'full') return { added: addedAnswers(view, mode, merged, []), known: [] };
  const jobs = detectionJobs(view, merged);
  if (jobs.length === 0) return { added: [], known: [] };
  let started = Date.now();
  const first = await executor.evalCells(jobs);
  const more = siblingJobs(view, merged, first);
  const detected = more.length === 0 ? first : [...first, ...await executor.evalCells(more)];
  const refuting = refutations(view, merged, detected);
  perfCount('answer-detect-cells', jobs.length + more.length);
  perfAdd('answer-detect', Date.now() - started);
  if (refuting.length === 0) return { added: [], known: [] };
  started = Date.now();
  const deep = await Promise.all(confirmJobs(view, refuting, deepen).map(job => executor.subSearch(job)));
  perfAdd('answer-confirm', Date.now() - started);
  perfCount('answer-confirm-searches', deep.length);
  const added = confirmedAnswers(view, merged, refuting, deep);
  return { added, known: confirmedCells(view, refuting, deep, added) };
}

interface SideGrade { view: AnswerSide; added: number[]; values: EvalCellValue[] }

async function sideExtension(
  executor: TreeExecutor, view: AnswerSide, found: SideAnswers, merged: EvalResult, deepen: EvalSettings,
): Promise<EvalCellValue[]> {
  if (found.added.length === 0) return [];
  const deep = deepRows(view, merged);
  const priced = new Set(found.known.map(value => cellKey(value.i, value.j)));
  const jobs = extensionJobs(view, found.added, deep, deepen).filter(job => !priced.has(cellKey(job.i, job.j)));
  perfCount('answer-extend-deep', jobs.filter(job => job.deepen !== undefined).length);
  return [...found.known, ...await executor.evalCells(jobs)];
}

function gradedSides(grades: SideGrade[], merged: EvalResult, tree: MctsTreeStats): EvalResult['perSide'] {
  const [p1, p2] = grades.map(grade => (grade.added.length === 0
    ? merged.perSide[grade.view.side]
    : gradedRanking(grade.view, merged, tree, grade.added, grade.values)));
  return { p1, p2 };
}

/** Null when no best row changed or no cell is left; else a verify round for the new best row, then `regrade`. */
export async function recheckedRound(
  executor: TreeExecutor, trees: MctsTreeStats[], round: Verified, perSide: EvalResult['perSide'],
  regrade: (merged: EvalResult) => EvalResult['perSide'], settings: EvalSettings,
): Promise<EvalResult | null> {
  const merged = round.result;
  const changed = (['p1', 'p2'] as const).filter(side => perSide[side][0]?.choice !== merged.perSide[side][0]?.choice);
  if (changed.length === 0) return null;
  const options = { p1: trees[0].p1Options, p2: trees[0].p2Options };
  const newRows = new Set(changed.map(side => `${side}:${options[side].findIndex(option => option.choice === perSide[side][0].choice)}`));
  const regraded = { ...merged, perSide };
  const jobs = rowCompletedCells(trees, regraded, starvedSupportCells(trees, regraded, round.focus), round.focus)
    .filter(job => !round.values.has(cellKey(job.i, job.j)) && (newRows.has(`p1:${job.i}`) || newRows.has(`p2:${job.j}`)));
  if (jobs.length === 0) return null;
  const values = new Map(round.values);
  for (const value of await verifyCells(executor, jobs, settings)) values.set(cellKey(value.i, value.j), value);
  const remerged = perfSync('main:mcts-merge', () => mergeMctsTrees(trees, values));
  return { ...remerged, perSide: regrade(remerged) };
}

/** The doubles answer round: grades each side against the other's unlisted legal answers; the score stays the mean. */
export async function answerRound(
  executor: TreeExecutor, trees: MctsTreeStats[], round: Verified, settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const merged = round.result;
  const mode = answersMode();
  const sides = mode === 'off' ? null : answerSides(trees[0], merged);
  if (!sides || stopped(callbacks)) return merged;
  const started = Date.now();
  try {
    const deepen: EvalSettings = { depth: 1, samples: 1, tera: settings.tera, sleepClause: settings.sleepClause, ruleset: settings.ruleset };
    const found = await Promise.all(sides.map(view => sideAnswers(executor, view, merged, mode, deepen)));
    if (stopped(callbacks) || found.every(side => side.added.length === 0)) return merged;
    const extending = Date.now();
    perfCount('answer-added', found.reduce((sum, side) => sum + side.added.length, 0));
    const grades = await Promise.all(sides.map(async (view, index): Promise<SideGrade> =>
      ({ view, added: found[index].added, values: await sideExtension(executor, view, found[index], merged, deepen) })));
    perfAdd('answer-extend', Date.now() - extending);
    if (stopped(callbacks)) return merged;
    const perSide = gradedSides(grades, merged, trees[0]);
    const rechecked = await recheckedRound(executor, trees, round, perSide, again => gradedSides(grades, again, trees[0]), settings).catch(() => null);
    return stopped(callbacks) ? merged : rechecked ?? { ...merged, perSide };
  } catch {
    return merged;
  } finally {
    perfAdd('answer-round', Date.now() - started);
  }
}

// A refinement: no job, an empty list or a failed replay leave the result as is; nothing scores from `lines`.
async function withLines(executor: TreeExecutor, trees: MctsTreeStats[], result: EvalResult, settings: EvalSettings): Promise<EvalResult> {
  if (!executor.lines) return result;
  const requests = lineRequests(trees, result, settings);
  if (requests.length === 0) return result;
  const started = Date.now();
  try {
    const lines = await executor.lines({ requests, tera: settings.tera, sleepClause: settings.sleepClause, keepPlayed: settings.keepPlayed });
    if (lines.length > 0) result.lines = lines;
  } catch {
    // the lines are an extra: the turn reads without them
  } finally {
    perfAdd('lines', Date.now() - started);
  }
  return result;
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
  return stopped(callbacks) ? result : withLines(executor, trees, result, settings);
}
