import type { EvalMatrix, EvalResult, RankedChoice } from '../types.ts';
import { cellKey, type PvStep, type Ranked, type ValueMatrix } from './matrix.ts';
import { solveMatrixGame, type MatrixSolution } from './solve.ts';

/**
 * Ranking over a value matrix: per-side rows priced by the equilibrium,
 * the result record, the principal-variation lines, and the expansion
 * cells the deepening search chases.
 */

/** p1's rows: floor, punisher, mean, and equilibrium EV per option, ev-sorted (ties by floor). */
function rankRows(matrix: ValueMatrix, solution: MatrixSolution, rootValue: number): RankedChoice[] {
  const { p1Options, p2Options, values } = matrix;
  return p1Options.map((option, i) => {
    if (p2Options.length === 0) {
      return {
        choice: option.choice, label: option.label,
        worstCase: rootValue, expected: rootValue, ev: rootValue, punishedBy: null,
      };
    }
    let worst = Infinity;
    let punishedBy: string | null = null;
    let sum = 0;
    let ev = 0;
    for (let j = 0; j < p2Options.length; j++) {
      sum += values[i][j];
      ev += values[i][j] * (solution.p2Mix[j] ?? 0);
      if (values[i][j] < worst) {
        worst = values[i][j];
        punishedBy = p2Options[j].label;
      }
    }
    return {
      choice: option.choice, label: option.label,
      worstCase: worst, expected: sum / p2Options.length, ev, punishedBy,
    };
  }).sort((a, b) => b.ev - a.ev || b.worstCase - a.worstCase);
}

/** p2's columns in p2's own perspective: p2's worst case is the p1 maximum, negated. */
function rankColumns(matrix: ValueMatrix, solution: MatrixSolution, rootValue: number): RankedChoice[] {
  const { p1Options, p2Options, values } = matrix;
  return p2Options.map((option, j) => {
    if (p1Options.length === 0) {
      return {
        choice: option.choice, label: option.label,
        worstCase: -rootValue, expected: -rootValue, ev: -rootValue, punishedBy: null,
      };
    }
    // p1-perspective: p2's worst case is the p1 maximum; negate into p2's own view.
    let worst = -Infinity;
    let punishedBy: string | null = null;
    let sum = 0;
    let ev = 0;
    for (let i = 0; i < p1Options.length; i++) {
      sum += values[i][j];
      ev += values[i][j] * (solution.p1Mix[i] ?? 0);
      if (values[i][j] > worst) {
        worst = values[i][j];
        punishedBy = p1Options[i].label;
      }
    }
    return {
      choice: option.choice, label: option.label,
      worstCase: -worst, expected: -(sum / p1Options.length), ev: -ev, punishedBy,
    };
  }).sort((a, b) => b.ev - a.ev || b.worstCase - a.worstCase);
}

/** The solved matrix + mixes carried on the result for the Read lens. */
function solvedMatrixOut(matrix: ValueMatrix, solution: MatrixSolution): EvalMatrix {
  const { p1Options, p2Options, values } = matrix;
  return {
    p1Labels: p1Options.map(option => option.label),
    p2Labels: p2Options.map(option => option.label),
    p1Choices: p1Options.map(option => option.choice),
    p2Choices: p2Options.map(option => option.choice),
    values: values.map(row => [...row]),
    mixes: { p1: solution.p1Mix, p2: solution.p2Mix },
  };
}

export function rankFromMatrix(matrix: ValueMatrix, rootValue: number): Ranked {
  const { p1Options, p2Options, values } = matrix;

  // The one-shot matrix game's equilibrium prices every choice: `ev` is the
  // expected value against the opponent's mixture. The floor (worstCase)
  // stays as the safety column — sorting goes by ev, ties by floor.
  const solved = p1Options.length > 0 && p2Options.length > 0;
  const solution = solved ? solveMatrixGame(values) : { value: rootValue, p1Mix: [], p2Mix: [] };

  const p1 = rankRows(matrix, solution, rootValue);
  const p2 = rankColumns(matrix, solution, rootValue);

  const v1 = p1.length > 0 ? Math.max(...p1.map(choice => choice.worstCase)) : rootValue;
  const v2 = p2.length > 0 ? -Math.max(...p2.map(choice => choice.worstCase)) : rootValue;
  return {
    p1, p2, v1, v2,
    gameValue: solved ? solution.value : rootValue,
    ...(solved ? { matrixOut: solvedMatrixOut(matrix, solution) } : {}),
  };
}

export function toResult(ranked: Ranked, depthCompleted: number): EvalResult {
  const lo = Math.min(ranked.v1, ranked.v2);
  const hi = Math.max(ranked.v1, ranked.v2);
  return {
    score: Math.min(hi, Math.max(lo, ranked.gameValue)),
    gameValue: ranked.gameValue,
    interval: Math.max(0, ranked.v2 - ranked.v1),
    depthCompleted,
    perSide: { p1: ranked.p1, p2: ranked.p2 },
    ...(ranked.matrixOut ? { matrix: ranked.matrixOut } : {}),
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
