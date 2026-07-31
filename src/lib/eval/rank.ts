import type { EvalResult, RankedChoice } from './types';

/**
 * Pure ranking math over a computed value matrix. No @pkmn/sim imports —
 * this module is safe for the main bundle, so a main-thread coordinator can
 * rank worker-computed values without pulling in the sim.
 */

export interface RankOption {
  choice: string;
  label: string;
}

export interface ValueMatrix {
  p1Options: RankOption[];
  p2Options: RankOption[];
  /** values[i][j]: p1-perspective value of (p1Options[i], p2Options[j]). */
  values: number[][];
  /** ended[i][j]: the first-seed child is terminal (never worth deepening). */
  ended: boolean[][];
}

export interface Ranked {
  p1: RankedChoice[];
  p2: RankedChoice[];
  v1: number;
  v2: number;
}

export type PvStep = { p1: string; p2: string };

export const cellKey = (i: number, j: number) => i * 10_000 + j;

export const TOP_EXPANSION = 5;

export function rankFromMatrix(matrix: ValueMatrix, rootValue: number): Ranked {
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

export function toResult(ranked: Ranked, depthCompleted: number): EvalResult {
  return {
    score: (ranked.v1 + ranked.v2) / 2,
    depthCompleted,
    perSide: { p1: ranked.p1, p2: ranked.p2 },
  };
}

/**
 * Attaches captured principal-variation lines to every ranked entry whose
 * worst-case cell was expanded by the deepening search.
 */
export function attachLines(matrix: ValueMatrix, ranked: Ranked, pvByCell: Map<number, PvStep[]>): void {
  const byChoiceP1 = new Map(matrix.p1Options.map((option, index) => [option.choice, index]));
  const byChoiceP2 = new Map(matrix.p2Options.map((option, index) => [option.choice, index]));
  const byLabelP1 = new Map(matrix.p1Options.map((option, index) => [option.label, index]));
  const byLabelP2 = new Map(matrix.p2Options.map((option, index) => [option.label, index]));

  for (const entry of ranked.p1) {
    if (entry.punishedBy === null) continue;
    const i = byChoiceP1.get(entry.choice);
    const j = byLabelP2.get(entry.punishedBy);
    if (i === undefined || j === undefined) continue;
    const line = pvByCell.get(cellKey(i, j));
    if (line) entry.line = line;
  }
  for (const entry of ranked.p2) {
    if (entry.punishedBy === null) continue;
    const i = byLabelP1.get(entry.punishedBy);
    const j = byChoiceP2.get(entry.choice);
    if (i === undefined || j === undefined) continue;
    const line = pvByCell.get(cellKey(i, j));
    if (line) entry.line = line;
  }
}

/**
 * The cells that decide the ranking: each side's top choices paired with
 * their punishing replies, deduped, capped. Cells whose child battle already
 * ended are exact and never worth deepening.
 */
export function selectExpansionCells(matrix: ValueMatrix, ranked: Ranked, cap: number): [number, number][] {
  const { p1Options, p2Options } = matrix;
  const byChoiceP1 = new Map(p1Options.map((option, index) => [option.choice, index]));
  const byChoiceP2 = new Map(p2Options.map((option, index) => [option.choice, index]));
  const byLabelP1 = new Map(p1Options.map((option, index) => [option.label, index]));
  const byLabelP2 = new Map(p2Options.map((option, index) => [option.label, index]));

  const cells: [number, number][] = [];
  const seen = new Set<number>();
  const push = (i: number | undefined, j: number | undefined) => {
    if (i === undefined || j === undefined || cells.length >= cap) return;
    const key = cellKey(i, j);
    if (seen.has(key)) return;
    seen.add(key);
    if (matrix.ended[i][j]) return;
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
