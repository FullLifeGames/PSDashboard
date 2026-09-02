import {
  applyTrendExtrapolation, applyTrendTiebreak, attachLines, cellKey, rankFromMatrix, selectExpansionCells,
  selectTieProbeCells, toResult, TOP_EXPANSION, type PvStep, type Ranked, type ValueMatrix,
} from './rank';
import { perfSync } from './perf-trace';
import type {
  CellBlend, EvalCellJob, EvalCellValue, EvalChoiceOption, EvalChoicesInfo, EvalResult, EvalSettings,
  EvalSubSearchJob, KoOddsMismatch, SearchProgress, TeraAllowance,
} from './types';
import { attachRootPayload, koOddsMapsFor, type RootPayload } from './search/root-payload';
import { recordDeepenedCell, type DeepeningState } from './search/deepening';

/**
 * Async search orchestration over an abstract executor. Pure — no @pkmn/sim
 * imports — so it can run on the main thread and fan the actual sim work out
 * to a pool of workers. `createLocalExecutor` (search.ts) provides the
 * single-threaded reference implementation; the parity regression test pins
 * this module to `searchPosition`'s exact behavior.
 */

type ChoicesInfo = EvalChoicesInfo;
export type CellJob = EvalCellJob;
export type CellValue = EvalCellValue;
export type SubSearchJob = EvalSubSearchJob;

export interface SearchExecutor {
  choices(tera: TeraAllowance, keepPlayed?: EvalSettings['keepPlayed'], sleepClause?: boolean): Promise<ChoicesInfo>;
  /** Evaluate all cells; report incremental completion via onDone(completedCount). */
  evalCells(jobs: CellJob[], onDone?: (completed: number) => void): Promise<CellValue[]>;
  /** Advance from the root by the job's pair (first fixed seed) and search the child. */
  subSearch(job: SubSearchJob): Promise<EvalResult>;
}

export interface OrchestratorCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  shouldStop?(): boolean;
}

/** One cell job per (i, j) pair, row-major. */
function cellJobs(p1: EvalChoiceOption[], p2: EvalChoiceOption[], samples: number): CellJob[] {
  const jobs: CellJob[] = [];
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      jobs.push({ i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice, samples });
    }
  }
  return jobs;
}

/**
 * Writes the executor's cell values into the matrix, collecting the blends
 * and the diagnostics. The executor returns chunks in completion order, so
 * the diagnostics are sorted by cell: the values are index-addressed and
 * the blends are looked up by key, but the diagnostic list is read as is.
 */
function collectCells(
  cellValues: CellValue[],
  matrix: ValueMatrix,
  blends: Map<number, CellBlend>,
  diagnostics: KoOddsMismatch[],
): void {
  for (const cell of cellValues) {
    matrix.values[cell.i][cell.j] = cell.value;
    matrix.ended[cell.i][cell.j] = cell.ended;
    if (cell.blend) blends.set(cellKey(cell.i, cell.j), cell.blend);
    if (cell.diagnostic) diagnostics.push(cell.diagnostic);
  }
  diagnostics.sort((a, b) => a.i - b.i || a.j - b.j);
}

/**
 * The root payload from the executor's choices info: kill odds and the
 * unanswered-mon profile are computed sim-side by choices(); the shared
 * helpers keep this module sim-free.
 */
function orchestratedPayload(info: ChoicesInfo, diagnostics: KoOddsMismatch[]): RootPayload {
  const koOddsMaps = info.koOdds ? koOddsMapsFor(info.p1, info.p2, info.koOdds) : null;
  return { diagnostics, koOddsMaps, unanswered: info.unanswered };
}

/** The orchestrated search's deepening state: the shared record plus the executor-side context. */
interface Orchestration extends DeepeningState {
  executor: SearchExecutor;
  settings: EvalSettings;
  callbacks: OrchestratorCallbacks | undefined;
  rootValue: number;
  p1: EvalChoiceOption[];
  p2: EvalChoiceOption[];
  ranked: Ranked;
}

/**
 * Mirrors searchPosition: expansion iterates because deepening a cell
 * shifts a row's worst case onto still-shallow siblings. Each batch of
 * wanted cells runs in parallel through the executor and is booked on
 * return; true when the caller asked to stop mid-level.
 */
async function deepenLevelAsync(state: Orchestration, depth: number): Promise<boolean> {
  const expandedThisLevel = new Set<number>();
  const budget = TOP_EXPANSION * 2;
  let used = 0;
  while (used < budget) {
    if (state.callbacks?.shouldStop?.()) return true;
    const wanted = selectExpansionCells(state.matrix, state.ranked, budget - used)
      .filter(([i, j]) => !expandedThisLevel.has(cellKey(i, j)));
    if (wanted.length === 0) break;

    const subs = await Promise.all(wanted.map(([i, j]) => state.executor.subSearch({
      i, j, p1Choice: state.p1[i].choice, p2Choice: state.p2[j].choice,
      // keepPlayed is a root-position hint — meaningless one turn deeper.
      settings: { ...state.settings, depth: (depth - 1) as 1 | 2, samples: 1, keepPlayed: undefined },
    })));
    subs.forEach((sub, index) => {
      const [i, j] = wanted[index];
      recordDeepenedCell(state, i, j, sub, depth, expandedThisLevel);
      used += 1;
      state.callbacks?.onProgress?.({ done: used, total: budget, depth });
    });
    state.ranked = perfSync('main:rank', () => rankFromMatrix(state.matrix, state.rootValue));
  }
  return false;
}

/**
 * Horizon-trend tiebreak, mirroring searchPosition: singles-shaped lists
 * only; probes are one-ply sub-searches of the tied rows' decisive cells.
 */
async function applyTrendLayersAsync(state: Orchestration, result: EvalResult, stopped: boolean): Promise<void> {
  const combined = state.p1.some(option => option.choice.includes(',')) ||
    state.p2.some(option => option.choice.includes(','));
  if (!(!stopped && !combined)) return;
  const probes = selectTieProbeCells(state.matrix, result, state.trendMap);
  if (probes.length > 0) {
    const subs = await Promise.all(probes.map(([i, j]) => state.executor.subSearch({
      i, j, p1Choice: state.p1[i].choice, p2Choice: state.p2[j].choice,
      settings: { ...state.settings, depth: 1, samples: 1, keepPlayed: undefined },
    })));
    subs.forEach((sub, index) => {
      const [i, j] = probes[index];
      state.trendMap.set(cellKey(i, j), sub.score - state.staticValues[i][j]);
    });
  }
  // 2b, mirroring searchPosition: corrected values (no re-solve) before
  // the ordering-only tiebreak runs on what remains tied.
  applyTrendExtrapolation(state.matrix, result, state.trendMap);
  applyTrendTiebreak(state.matrix, result, state.trendMap);
}

export async function searchOrchestrated(
  executor: SearchExecutor,
  settings: EvalSettings,
  callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const tera = settings.tera ?? true;
  const info = await executor.choices(tera, settings.keepPlayed, settings.sleepClause);
  if (info.rootEnded) {
    return { score: info.rootValue, interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const { p1, p2, rootValue } = info;
  const jobs = cellJobs(p1, p2, settings.samples);
  const total = Math.max(jobs.length, 1);
  const values: number[][] = p1.map(() => p2.map(() => 0));
  const ended: boolean[][] = p1.map(() => p2.map(() => false));
  const matrix: ValueMatrix = { p1Options: p1, p2Options: p2, values, ended };

  const blends = new Map<number, CellBlend>();
  const diagnostics: KoOddsMismatch[] = [];
  const cellValues = await executor.evalCells(jobs, completed =>
    callbacks?.onProgress?.({ done: Math.min(completed, total), total, depth: 1 }));
  collectCells(cellValues, matrix, blends, diagnostics);
  const payload = orchestratedPayload(info, diagnostics);
  // Trend baseline, mirroring searchPosition: uniformly 1-ply-vs-static.
  const state: Orchestration = {
    matrix, blends, staticValues: values.map(row => [...row]), trendMap: new Map<number, number>(),
    pvByCell: new Map<number, PvStep[]>(), executor, settings, callbacks, rootValue, p1, p2,
    ranked: perfSync('main:rank', () => rankFromMatrix(matrix, rootValue)),
  };
  let result = toResult(state.ranked, 1);
  attachRootPayload(result, payload);
  callbacks?.onPartial?.(result);

  let stopped = false;
  for (let depth = 2; depth <= settings.depth; depth++) {
    if (callbacks?.shouldStop?.()) break;
    if (await deepenLevelAsync(state, depth)) {
      stopped = true;
      break;
    }
    state.ranked = perfSync('main:rank', () => rankFromMatrix(matrix, rootValue));
    attachLines(matrix, state.ranked, state.pvByCell);
    result = toResult(state.ranked, depth);
    attachRootPayload(result, payload);
    callbacks?.onPartial?.(result);
  }

  await applyTrendLayersAsync(state, result, stopped);
  return result;
}
