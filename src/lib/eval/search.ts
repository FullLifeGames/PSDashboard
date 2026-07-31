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
  const ranked = rankFromMatrix(matrix, rootValue);
  const result = toResult(ranked, 1);
  callbacks?.onPartial?.(result);
  // Task 4 adds deepening here.
  return result;
}
