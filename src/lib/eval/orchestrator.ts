import {
  attachLines, cellKey, rankFromMatrix, selectExpansionCells, toResult, TOP_EXPANSION,
  type PvStep, type Ranked, type ValueMatrix,
} from './rank';
import type {
  EvalCellJob, EvalCellValue, EvalChoicesInfo, EvalResult, EvalSettings, EvalSubSearchJob, SearchProgress,
} from './types';

/**
 * Async search orchestration over an abstract executor. Pure — no @pkmn/sim
 * imports — so it can run on the main thread and fan the actual sim work out
 * to a pool of workers. `createLocalExecutor` (search.ts) provides the
 * single-threaded reference implementation; the parity regression test pins
 * this module to `searchPosition`'s exact behavior.
 */

export type ChoicesInfo = EvalChoicesInfo;
export type CellJob = EvalCellJob;
export type CellValue = EvalCellValue;
export type SubSearchJob = EvalSubSearchJob;

export interface SearchExecutor {
  choices(tera: boolean): Promise<ChoicesInfo>;
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

export async function searchOrchestrated(
  executor: SearchExecutor,
  settings: EvalSettings,
  callbacks?: OrchestratorCallbacks,
): Promise<EvalResult> {
  const tera = settings.tera ?? true;
  const info = await executor.choices(tera);
  if (info.rootEnded) {
    return { score: info.rootValue, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const { p1, p2, rootValue } = info;
  const jobs: CellJob[] = [];
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      jobs.push({ i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice, samples: settings.samples });
    }
  }

  const total = Math.max(jobs.length, 1);
  const values: number[][] = p1.map(() => p2.map(() => 0));
  const ended: boolean[][] = p1.map(() => p2.map(() => false));
  const matrix: ValueMatrix = { p1Options: p1, p2Options: p2, values, ended };

  const cellValues = await executor.evalCells(jobs, completed =>
    callbacks?.onProgress?.({ done: Math.min(completed, total), total, depth: 1 }));
  for (const cell of cellValues) {
    values[cell.i][cell.j] = cell.value;
    ended[cell.i][cell.j] = cell.ended;
  }

  let ranked: Ranked = rankFromMatrix(matrix, rootValue);
  let result = toResult(ranked, 1);
  callbacks?.onPartial?.(result);

  let stopped = false;
  const pvByCell = new Map<number, PvStep[]>();
  for (let depth = 2; depth <= settings.depth && !stopped; depth++) {
    if (callbacks?.shouldStop?.()) break;

    // Mirrors searchPosition: expansion iterates because deepening a cell
    // shifts a row's worst case onto still-shallow siblings.
    const expandedThisLevel = new Set<number>();
    const budget = TOP_EXPANSION * 2;
    let used = 0;
    while (used < budget && !stopped) {
      if (callbacks?.shouldStop?.()) {
        stopped = true;
        break;
      }
      const wanted = selectExpansionCells(matrix, ranked, budget - used)
        .filter(([i, j]) => !expandedThisLevel.has(cellKey(i, j)));
      if (wanted.length === 0) break;

      const subs = await Promise.all(wanted.map(([i, j]) => executor.subSearch({
        i, j, p1Choice: p1[i].choice, p2Choice: p2[j].choice,
        settings: { ...settings, depth: (depth - 1) as 1 | 2, samples: 1 },
      })));
      subs.forEach((sub, index) => {
        const [i, j] = wanted[index];
        values[i][j] = sub.score;
        expandedThisLevel.add(cellKey(i, j));
        const subTopP1 = sub.perSide.p1[0];
        const subTopP2 = sub.perSide.p2[0];
        if (subTopP1 || subTopP2) {
          pvByCell.set(cellKey(i, j), [
            { p1: subTopP1?.label ?? '—', p2: subTopP2?.label ?? '—' },
            ...(subTopP1?.line ?? []),
          ]);
        }
        used += 1;
        callbacks?.onProgress?.({ done: used, total: budget, depth });
      });
      ranked = rankFromMatrix(matrix, rootValue);
    }
    if (stopped) break;

    ranked = rankFromMatrix(matrix, rootValue);
    attachLines(matrix, ranked, pvByCell);
    result = toResult(ranked, depth);
    callbacks?.onPartial?.(result);
  }
  return result;
}
