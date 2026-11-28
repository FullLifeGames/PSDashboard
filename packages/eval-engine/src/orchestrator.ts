import {
  applyTrendExtrapolation, applyTrendTiebreak, attachLines, cellKey, meanTrend, rankFromMatrix, selectExpansionCells,
  selectTieProbeCells, toResult, TOP_EXPANSION, type PvStep, type Ranked, type ValueMatrix,
} from './rank.ts';
import { perfSpan, perfSync } from './perf-trace.ts';
import type {
  CellBlend, CellDraw, EvalCellJob, EvalCellValue, EvalChoiceOption, EvalChoicesInfo, EvalLine, EvalResult, EvalSettings,
  EvalSubSearchJob, ForcedWinInput, ForcedWinOutcome, KoOddsMismatch, LinesInput, SearchProgress, TeraAllowance,
} from './types.ts';
import { applyForcedWin, forcedWinInput } from './search/forced-win-apply.ts';
import { attachRootPayload, koOddsMapsFor, type RootPayload } from './search/root-payload.ts';
import {
  FORCED_ROOT_LEVEL, liveCells, recordDeepenedCell, recordDeepenedLevel, recordTurnCell, turnSettings, type DeepeningState,
} from './search/deepening.ts';

// Pure (no @pkmn/sim imports), so it runs on the main thread and fans the sim work out to workers.

type ChoicesInfo = EvalChoicesInfo;
type CellJob = EvalCellJob;
export type CellValue = EvalCellValue;
type SubSearchJob = EvalSubSearchJob;

/** The sim side of the orchestrator: answers the root's choices and the cell, sub-search, prover and line jobs. */
export interface SearchExecutor {
  choices(tera: TeraAllowance, keepPlayed?: EvalSettings['keepPlayed'], sleepClause?: boolean): Promise<ChoicesInfo>;
  /** Evaluates all cells; reports incremental completion via onDone(completedCount). */
  evalCells(jobs: CellJob[], onDone?: (completed: number) => void): Promise<CellValue[]>;
  subSearch(job: SubSearchJob): Promise<EvalResult>;
  prove(input: ForcedWinInput): Promise<ForcedWinOutcome | null>;
  /** Replays the trees' lines for the rows a turn shows; an executor without it sends no lines. */
  lines?(input: LinesInput): Promise<EvalLine[]>;
}

/** Progress, partial-result and stop hooks of one search run. */
export interface OrchestratorCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  shouldStop?(): boolean;
}

function cellJobs(p1: EvalChoiceOption[], p2: EvalChoiceOption[], samples: number): CellJob[] {
  const jobs: CellJob[] = [];
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      jobs.push({ i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice, samples });
    }
  }
  return jobs;
}

// The executor returns chunks in completion order: the diagnostics are sorted by cell, the rest is read by key.
function collectCells(
  cellValues: CellValue[],
  matrix: ValueMatrix,
  blends: Map<number, CellBlend>,
  baseDraws: Map<number, CellDraw[]>,
  diagnostics: KoOddsMismatch[],
): void {
  for (const cell of cellValues) {
    matrix.values[cell.i][cell.j] = cell.value;
    matrix.ended[cell.i][cell.j] = cell.ended;
    if (cell.blend) blends.set(cellKey(cell.i, cell.j), cell.blend);
    if (cell.baseDraws) baseDraws.set(cellKey(cell.i, cell.j), cell.baseDraws);
    if (cell.diagnostic) diagnostics.push(cell.diagnostic);
  }
  diagnostics.sort((a, b) => a.i - b.i || a.j - b.j);
}

function orchestratedPayload(info: ChoicesInfo, diagnostics: KoOddsMismatch[]): RootPayload {
  const koOddsMaps = info.koOdds ? koOddsMapsFor(info.p1, info.p2, info.koOdds) : null;
  return { diagnostics, koOddsMaps, unanswered: info.unanswered, playedBounds: info.playedBounds };
}

interface Orchestration extends DeepeningState {
  executor: SearchExecutor;
  settings: EvalSettings;
  callbacks: OrchestratorCallbacks | undefined;
  rootValue: number;
  p1: EvalChoiceOption[];
  p2: EvalChoiceOption[];
  /** cellKey → the base draws behind a cell of more than one draw. */
  baseDraws: Map<number, CellDraw[]>;
  ranked: Ranked;
}

async function deepenWholeLevelAsync(state: Orchestration, depth: number): Promise<boolean> {
  const cells = liveCells(state.matrix);
  if (state.callbacks?.shouldStop?.()) return true;
  let done = 0;
  state.callbacks?.onProgress?.({ done, total: cells.length, depth });
  const subs = await Promise.all(cells.map(async ([i, j]) => {
    const sub = await state.executor.subSearch({
      i, j, p1Choice: state.p1[i].choice, p2Choice: state.p2[j].choice,
      settings: { ...state.settings, depth: (depth - 1) as 1 | 2, samples: 1, keepPlayed: undefined },
    });
    done += 1;
    state.callbacks?.onProgress?.({ done, total: cells.length, depth });
    return sub;
  }));
  if (state.callbacks?.shouldStop?.()) return true;
  recordDeepenedLevel(state, cells, subs, depth);
  return false;
}

// Mirrors searchPosition: expansion iterates, because deepening a cell shifts a row's worst case onto shallow siblings.
async function deepenLevelAsync(state: Orchestration, depth: number): Promise<boolean> {
  if (depth === 2) return deepenWholeLevelAsync(state, depth);
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

// Mirrors searchPosition: level 2 of a forced root; values are booked together, so a stop leaves the arrival values.
async function deepenForcedRootAsync(state: Orchestration): Promise<boolean> {
  const cells = liveCells(state.matrix);
  if (state.callbacks?.shouldStop?.()) return true;
  let done = 0;
  const settings = turnSettings(state.settings);
  state.callbacks?.onProgress?.({ done, total: cells.length, depth: FORCED_ROOT_LEVEL });
  const subs = await Promise.all(cells.map(async ([i, j]) => {
    const sub = await state.executor.subSearch({ i, j, p1Choice: state.p1[i].choice, p2Choice: state.p2[j].choice, settings, turn: true });
    done += 1;
    state.callbacks?.onProgress?.({ done, total: cells.length, depth: FORCED_ROOT_LEVEL });
    return sub;
  }));
  if (state.callbacks?.shouldStop?.()) return true;
  cells.forEach(([i, j], index) => recordTurnCell(state, i, j, subs[index]));
  return false;
}

// Horizon-trend tiebreak, mirroring searchPosition: singles-shaped lists only; one-ply probes of the tied rows' cells.
async function applyTrendLayersAsync(state: Orchestration, result: EvalResult, stopped: boolean): Promise<void> {
  const combined = state.p1.some(option => option.choice.includes(',')) ||
    state.p2.some(option => option.choice.includes(','));
  if (!(!stopped && !combined)) return;
  const probes = selectTieProbeCells(state.matrix, result, state.trendMap);
  if (probes.length > 0) {
    const jobs = probes.flatMap(([i, j]) => (state.baseDraws.get(cellKey(i, j)) ?? [undefined]).map(draw => ({ i, j, draw })));
    const subs = await Promise.all(jobs.map(({ i, j, draw }) => state.executor.subSearch({
      i, j, p1Choice: state.p1[i].choice, p2Choice: state.p2[j].choice,
      settings: { ...state.settings, depth: 1, samples: 1, keepPlayed: undefined }, ...(draw ? { draw } : {}),
    })));
    const trends = new Map<number, number[]>();
    subs.forEach((sub, index) => {
      const { i, j } = jobs[index];
      const key = cellKey(i, j);
      trends.set(key, [...(trends.get(key) ?? []), sub.trend ?? sub.score - state.staticValues[i][j]]);
    });
    for (const [key, drawTrends] of trends) state.trendMap.set(key, meanTrend(drawTrends));
  }
  applyTrendExtrapolation(state.matrix, result, state.trendMap);
  applyTrendTiebreak(state.matrix, result, state.trendMap);
}

async function deepenRootAsync(
  state: Orchestration, forced: boolean, payload: RootPayload, first: EvalResult,
): Promise<{ result: EvalResult; stopped: boolean }> {
  const { matrix, rootValue, callbacks, settings } = state;
  let result = first;
  let stopped = false;
  let firstLevel = 2;
  if (forced) {
    firstLevel = FORCED_ROOT_LEVEL + 1;
    stopped = await deepenForcedRootAsync(state);
    if (!stopped) {
      state.ranked = perfSync('main:rank', () => rankFromMatrix(matrix, rootValue));
      attachLines(matrix, state.ranked, state.pvByCell);
      result = toResult(state.ranked, FORCED_ROOT_LEVEL);
      attachRootPayload(result, payload);
      callbacks?.onPartial?.(result);
    }
  }
  for (let depth = firstLevel; depth <= settings.depth && !stopped; depth++) {
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
  return { result, stopped };
}

/** The async search over an executor: root choices, cells, deepening levels, trend tiebreak and forced-win prover. */
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
  const baseDraws = new Map<number, CellDraw[]>();
  const diagnostics: KoOddsMismatch[] = [];
  const cellValues = await executor.evalCells(jobs, completed =>
    callbacks?.onProgress?.({ done: Math.min(completed, total), total, depth: 1 }));
  collectCells(cellValues, matrix, blends, baseDraws, diagnostics);
  const payload = orchestratedPayload(info, diagnostics);
  // Trend baseline, mirroring searchPosition: uniformly 1-ply-vs-static.
  const state: Orchestration = {
    matrix, blends, staticValues: values.map(row => [...row]), trendMap: new Map<number, number>(),
    pvByCell: new Map<number, PvStep[]>(), executor, settings, callbacks, rootValue, p1, p2, baseDraws,
    ranked: perfSync('main:rank', () => rankFromMatrix(matrix, rootValue)),
  };
  let result = toResult(state.ranked, 1);
  attachRootPayload(result, payload);
  callbacks?.onPartial?.(result);

  const levels = await deepenRootAsync(state, info.forced === true, payload, result);
  result = levels.result;
  const { stopped } = levels;

  await applyTrendLayersAsync(state, result, stopped);
  await proveRoot(executor, result, settings, callbacks);
  return result;
}

async function proveRoot(
  executor: SearchExecutor, result: EvalResult, settings: EvalSettings, callbacks?: OrchestratorCallbacks,
): Promise<void> {
  if (settings.prove === false || callbacks?.shouldStop?.()) return;
  applyForcedWin(result, await perfSpan('prover', () => executor.prove(forcedWinInput(result, settings))));
}
