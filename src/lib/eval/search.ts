import type { PRNGSeed } from '@pkmn/sim';
import { createMatchupCache, evaluatePosition, type MatchupCache } from './eval-function';
import {
  advancePosition, createRootPosition, legalChoices, positionBattle,
  type SimPosition,
} from './forward-model';
import {
  attachLines, cellKey, rankFromMatrix, selectExpansionCells, toResult,
  type PvStep, type Ranked, type ValueMatrix,
} from './rank';
import type { EvalResult, EvalSettings, SearchProgress } from './types';

export interface SearchCallbacks {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
  /** Checked between matrix cells; returning true stops deepening (current result is returned). */
  shouldStop?(): boolean;
}

/** Fixed seeds: index < settings.samples are used. Never randomized. */
export const SEARCH_SEEDS: readonly PRNGSeed[] = [
  '1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20',
];

export const TOP_EXPANSION = 5;

interface Matrix extends ValueMatrix {
  /** children[i][j][s]: child position for seed s (kept for deepening). */
  children: SimPosition[][][];
}

function buildMatrix(
  position: SimPosition,
  samples: number,
  tera: boolean,
  depth: number,
  callbacks: SearchCallbacks | undefined,
  progress: { done: number; total: number },
  matchupCache: MatchupCache,
): Matrix {
  const p1Options = legalChoices(position, 'p1', { tera });
  const p2Options = legalChoices(position, 'p2', { tera });
  const values: number[][] = [];
  const ended: boolean[][] = [];
  const children: SimPosition[][][] = [];

  for (let i = 0; i < p1Options.length; i++) {
    values.push([]);
    ended.push([]);
    children.push([]);
    for (let j = 0; j < p2Options.length; j++) {
      let sum = 0;
      const cellChildren: SimPosition[] = [];
      for (let s = 0; s < samples; s++) {
        const child = advancePosition(position, p1Options[i].choice, p2Options[j].choice, SEARCH_SEEDS[s]);
        cellChildren.push(child);
        sum += evaluatePosition(positionBattle(child), matchupCache);
      }
      values[i].push(sum / samples);
      ended[i].push(positionBattle(cellChildren[0]).ended);
      children[i].push(cellChildren);
      progress.done += 1;
      callbacks?.onProgress?.({ done: progress.done, total: progress.total, depth });
    }
  }

  return { p1Options, p2Options, values, ended, children };
}

export function searchPosition(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: SearchCallbacks,
  matchupCache: MatchupCache = createMatchupCache(),
): EvalResult {
  const root = createRootPosition(serializedBattle);
  const battle = positionBattle(root);
  if (battle.ended) {
    const score = evaluatePosition(battle, matchupCache);
    return { score, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const rootValue = evaluatePosition(battle, matchupCache);
  const tera = settings.tera ?? true;
  const p1Count = legalChoices(root, 'p1', { tera }).length;
  const p2Count = legalChoices(root, 'p2', { tera }).length;
  const progress = { done: 0, total: Math.max(p1Count * p2Count, 1) };

  const matrix = buildMatrix(root, settings.samples, tera, 1, callbacks, progress, matchupCache);
  let ranked: Ranked = rankFromMatrix(matrix, rootValue);
  let result = toResult(ranked, 1);
  callbacks?.onPartial?.(result);

  let stopped = false;
  const pvByCell = new Map<number, PvStep[]>();
  for (let depth = 2; depth <= settings.depth && !stopped; depth++) {
    if (callbacks?.shouldStop?.()) break;

    // Deepening a cell usually moves its value, which shifts a row's worst
    // case onto a sibling that is still shallow — so expansion iterates:
    // re-rank, chase the current punishing cells, repeat under a budget.
    // Cells are re-expanded per level (deeper sub-searches overwrite).
    const expandedThisLevel = new Set<number>();
    const budget = TOP_EXPANSION * 2;
    let used = 0;
    while (used < budget && !stopped) {
      const wanted = selectExpansionCells(matrix, ranked, budget - used)
        .filter(([i, j]) => !expandedThisLevel.has(cellKey(i, j)));
      if (wanted.length === 0) break;

      for (const [i, j] of wanted) {
        if (callbacks?.shouldStop?.()) {
          stopped = true;
          break;
        }
        // Deepen the first-seed child one level shallower with a single
        // sample (the child is seed-specific); its midpoint score replaces
        // the cell's static value.
        const child = matrix.children[i][j][0];
        const sub = searchPosition(child.serialized, { ...settings, depth: (depth - 1) as 1 | 2, samples: 1 }, undefined, matchupCache);
        matrix.values[i][j] = sub.score;
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
      }
      if (stopped) break;
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
