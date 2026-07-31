import type { PRNGSeed } from '@pkmn/sim';
import { evaluatePosition } from './eval-function';
import {
  advancePosition, createRootPosition, legalChoices, positionBattle,
  type ChoiceOption, type SimPosition,
} from './forward-model';
import type { EvalResult, EvalSettings, RankedChoice, SearchProgress } from './types';

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

interface Matrix {
  p1Options: ChoiceOption[];
  p2Options: ChoiceOption[];
  /** values[i][j]: p1-perspective value of (p1Options[i], p2Options[j]). */
  values: number[][];
  /** children[i][j][s]: child position for seed s (kept for deepening). */
  children: SimPosition[][][];
}

interface Ranked {
  p1: RankedChoice[];
  p2: RankedChoice[];
  v1: number;
  v2: number;
}

function buildMatrix(
  position: SimPosition,
  samples: number,
  depth: number,
  callbacks: SearchCallbacks | undefined,
  progress: { done: number; total: number },
): Matrix {
  const p1Options = legalChoices(position, 'p1');
  const p2Options = legalChoices(position, 'p2');
  const values: number[][] = [];
  const children: SimPosition[][][] = [];

  for (let i = 0; i < p1Options.length; i++) {
    values.push([]);
    children.push([]);
    for (let j = 0; j < p2Options.length; j++) {
      let sum = 0;
      const cellChildren: SimPosition[] = [];
      for (let s = 0; s < samples; s++) {
        const child = advancePosition(position, p1Options[i].choice, p2Options[j].choice, SEARCH_SEEDS[s]);
        cellChildren.push(child);
        sum += evaluatePosition(positionBattle(child));
      }
      values[i].push(sum / samples);
      children[i].push(cellChildren);
      progress.done += 1;
      callbacks?.onProgress?.({ done: progress.done, total: progress.total, depth });
    }
  }

  return { p1Options, p2Options, values, children };
}

function rankFromMatrix(matrix: Matrix, rootValue: number): Ranked {
  const { p1Options, p2Options, values } = matrix;

  const p1: RankedChoice[] = p1Options.map((option, i) => {
    if (p2Options.length === 0) {
      return { choice: option.choice, label: option.label, worstCase: rootValue, expected: rootValue, punishedBy: null };
    }
    let worst = Infinity;
    let punishedBy: string | null = null;
    let sum = 0;
    for (let j = 0; j < p2Options.length; j++) {
      sum += values[i][j];
      if (values[i][j] < worst) {
        worst = values[i][j];
        punishedBy = p2Options[j].label;
      }
    }
    return {
      choice: option.choice, label: option.label,
      worstCase: worst, expected: sum / p2Options.length, punishedBy,
    };
  }).sort((a, b) => b.worstCase - a.worstCase);

  const p2: RankedChoice[] = p2Options.map((option, j) => {
    if (p1Options.length === 0) {
      return { choice: option.choice, label: option.label, worstCase: -rootValue, expected: -rootValue, punishedBy: null };
    }
    // p1-perspective: p2's worst case is the p1 maximum; negate into p2's own view.
    let worst = -Infinity;
    let punishedBy: string | null = null;
    let sum = 0;
    for (let i = 0; i < p1Options.length; i++) {
      sum += values[i][j];
      if (values[i][j] > worst) {
        worst = values[i][j];
        punishedBy = p1Options[i].label;
      }
    }
    return {
      choice: option.choice, label: option.label,
      worstCase: -worst, expected: -(sum / p1Options.length), punishedBy,
    };
  }).sort((a, b) => b.worstCase - a.worstCase);

  const v1 = p1.length > 0 ? p1[0].worstCase : rootValue;
  const v2 = p2.length > 0 ? -p2[0].worstCase : rootValue;
  return { p1, p2, v1, v2 };
}

function toResult(ranked: Ranked, depthCompleted: number): EvalResult {
  return {
    score: (ranked.v1 + ranked.v2) / 2,
    depthCompleted,
    perSide: { p1: ranked.p1, p2: ranked.p2 },
  };
}

/**
 * The cells that decide the ranking: each side's top choices paired with
 * their punishing replies, deduped, capped. Cells whose child battle already
 * ended are exact and never worth deepening.
 */
function selectExpansionCells(matrix: Matrix, ranked: Ranked, cap: number): [number, number][] {
  const { p1Options, p2Options } = matrix;
  const byChoiceP1 = new Map(p1Options.map((option, index) => [option.choice, index]));
  const byChoiceP2 = new Map(p2Options.map((option, index) => [option.choice, index]));
  const byLabelP1 = new Map(p1Options.map((option, index) => [option.label, index]));
  const byLabelP2 = new Map(p2Options.map((option, index) => [option.label, index]));

  const cells: [number, number][] = [];
  const seen = new Set<number>();
  const push = (i: number | undefined, j: number | undefined) => {
    if (i === undefined || j === undefined || cells.length >= cap) return;
    const key = i * 10_000 + j;
    if (seen.has(key)) return;
    seen.add(key);
    if (positionBattle(matrix.children[i][j][0]).ended) return;
    cells.push([i, j]);
  };

  for (const choice of ranked.p1.slice(0, 3)) {
    if (choice.punishedBy === null) continue;
    push(byChoiceP1.get(choice.choice), byLabelP2.get(choice.punishedBy));
  }
  for (const choice of ranked.p2.slice(0, 3)) {
    if (choice.punishedBy === null) continue;
    push(byLabelP1.get(choice.punishedBy), byChoiceP2.get(choice.choice));
  }
  return cells;
}

export function searchPosition(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: SearchCallbacks,
): EvalResult {
  const root = createRootPosition(serializedBattle);
  const battle = positionBattle(root);
  if (battle.ended) {
    const score = evaluatePosition(battle);
    return { score, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const rootValue = evaluatePosition(battle);
  const p1Count = legalChoices(root, 'p1').length;
  const p2Count = legalChoices(root, 'p2').length;
  const progress = { done: 0, total: Math.max(p1Count * p2Count, 1) };

  const matrix = buildMatrix(root, settings.samples, 1, callbacks, progress);
  let ranked = rankFromMatrix(matrix, rootValue);
  let result = toResult(ranked, 1);
  callbacks?.onPartial?.(result);

  let stopped = false;
  for (let depth = 2; depth <= settings.depth && !stopped; depth++) {
    if (callbacks?.shouldStop?.()) break;

    const cells = selectExpansionCells(matrix, ranked, TOP_EXPANSION);
    const cellProgress = { done: 0, total: Math.max(cells.length, 1) };
    for (const [i, j] of cells) {
      if (callbacks?.shouldStop?.()) {
        stopped = true;
        break;
      }
      // Deepen the first-seed child one level shallower; its midpoint score
      // replaces the cell's static value.
      const child = matrix.children[i][j][0];
      const sub = searchPosition(child.serialized, { ...settings, depth: (depth - 1) as 1 | 2 });
      matrix.values[i][j] = sub.score;
      cellProgress.done += 1;
      callbacks?.onProgress?.({ done: cellProgress.done, total: cellProgress.total, depth });
    }
    if (stopped) break;

    ranked = rankFromMatrix(matrix, rootValue);
    result = toResult(ranked, depth);
    callbacks?.onPartial?.(result);
  }
  return result;
}
