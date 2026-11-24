import type { EvalResult } from '../types.ts';
import { cellKey, type ValueMatrix } from './matrix.ts';
import { MIN_TREND_WEIGHT, tieGroups, TREND_MARGIN, type TieRow } from './ties.ts';

/** The horizon-trend layers over tied rows: value extrapolation and the ordering-only tiebreak, both on the mix-weighted one-ply trend. */

/**
 * A cell's trend is the mean over its base draws of (the child's sub-search score minus the child's own leaf); one shared sum
 * order, so the sync search and the orchestrator book the same bits.
 */
export function meanTrend(trends: number[]): number {
  return trends.reduce((sum, trend) => sum + trend, 0) / trends.length;
}

/** Extrapolation strength: the observed bleed or build continues λ more plies. */
const TREND_LAMBDA = 0.5;
/**
 * Shifts below this stay unapplied: single-seed trend probes carry sampling noise on this scale, and decided positions tie
 * structurally with near-zero trends; folding noise into values would churn every endgame ranking the pruned sub-search path must mirror.
 */
const TREND_SHIFT_FLOOR = 0.005;

/** Terminal cells count 0 and a punisher's mix weight floors at MIN_TREND_WEIGHT; null when a cell is unpriced (probe budget or stop) or no weight accrues. */
function rowTrendValue(row: TieRow, matrix: ValueMatrix, trends: Map<number, number>, oppMix: number[]): number | null {
  let weightSum = 0;
  let weighted = 0;
  for (const [i, j] of row.cells) {
    const trend = matrix.ended[i][j] ? 0 : trends.get(cellKey(i, j));
    if (trend === undefined) return null;
    const weight = Math.max(oppMix[row.side === 'p1' ? j : i] ?? 0, MIN_TREND_WEIGHT);
    weightSum += weight;
    weighted += weight * trend;
  }
  if (weightSum === 0) return null;
  return weighted / weightSum;
}

/** The λ-scaled shift per tied row; null when any row's trend is unpriced (the group forfeits whole). */
function groupShifts(
  group: TieRow[],
  matrix: ValueMatrix,
  trends: Map<number, number>,
  oppMix: number[],
  lambda: number,
): { row: TieRow; shift: number }[] | null {
  const shifts: { row: TieRow; shift: number }[] = [];
  for (const row of group) {
    const value = rowTrendValue(row, matrix, trends, oppMix);
    if (value === null) return null;
    // Trends and matrix values are both p1-perspective, so the shift applies unsigned for both sides' groups.
    shifts.push({ row, shift: lambda * value });
  }
  return shifts;
}

/** Shifts one tied row's cells (clamped to the wp-unit range) and its ranked entry; false when the row is not in the matrix. */
function applyRowShift(matrix: ValueMatrix, side: 'p1' | 'p2', row: TieRow, shift: number): boolean {
  const own = side === 'p1'
    ? matrix.p1Options.findIndex(option => option.choice === row.entry.choice)
    : matrix.p2Options.findIndex(option => option.choice === row.entry.choice);
  if (own < 0) return false;
  if (side === 'p1') {
    for (let j = 0; j < matrix.values[own].length; j++) {
      matrix.values[own][j] = Math.max(-1, Math.min(1, matrix.values[own][j] + shift));
    }
  } else {
    for (let i = 0; i < matrix.values.length; i++) {
      matrix.values[i][own] = Math.max(-1, Math.min(1, matrix.values[i][own] + shift));
    }
  }
  // Ranked entries read in the OWN side's perspective.
  const ownShift = side === 'p1' ? shift : -shift;
  row.entry.ev += ownShift;
  row.entry.expected += ownShift;
  row.entry.worstCase += ownShift;
  return true;
}

/**
 * Folds the one-ply trend of the tied leading rows into their values (corrected = deep + λ·trend), so a stall that bleeds under
 * lookahead separates from a building switch by value. The equilibrium is deliberately not re-solved: re-solving lets the game
 * absorb the correction (a boosted row re-weights the opponent toward its punishers; every λ in {0.25, 0.5, 1.0} measured
 * self-defeating). Under fixed mixes the row-uniform shift adds a constant to the opponent's EVs, so their comparisons are
 * untouched; the score, mixes and gameValue stay. A group with any unpriced decisive cell forfeits whole (terminal cells price
 * as trend 0). Returns true when anything shifted.
 */
export function applyTrendExtrapolation(
  matrix: ValueMatrix,
  result: EvalResult,
  trends: Map<number, number>,
  lambda = TREND_LAMBDA,
): boolean {
  if (lambda === 0) return false;
  const mixes = result.matrix?.mixes;
  if (!mixes) return false;
  let applied = false;
  for (const group of tieGroups(matrix, result)) {
    const side = group[0].side;
    const oppMix = side === 'p1' ? mixes.p2 : mixes.p1;
    const shifts = groupShifts(group, matrix, trends, oppMix, lambda);
    if (!shifts) continue;
    for (const { row, shift } of shifts) {
      if (Math.abs(shift) < TREND_SHIFT_FLOOR) continue;
      if (applyRowShift(matrix, side, row, shift)) applied = true;
    }
  }
  if (applied) {
    for (const side of ['p1', 'p2'] as const) {
      result.perSide[side].sort((a, b) => b.ev - a.ev || b.worstCase - a.worstCase);
    }
  }
  return applied;
}

/**
 * Trends in the group's own perspective (a p2 row reads the p1-perspective trend negated); null when any row is unpriced, since a partial
 * comparison is the asymmetry to avoid.
 */
function groupRowTrends(
  group: TieRow[],
  matrix: ValueMatrix,
  trends: Map<number, number>,
  oppMix: number[],
): Map<string, number> | null {
  const rowTrend = new Map<string, number>();
  for (const row of group) {
    const value = rowTrendValue(row, matrix, trends, oppMix);
    if (value === null) return null;
    rowTrend.set(row.entry.choice, (row.side === 'p1' ? 1 : -1) * value);
  }
  return rowTrend;
}

/**
 * When the leading rows tie within TIE_EPSILON, the one-ply trend of their decisive cells tells a line that builds from one that
 * bleeds. Reorders only the tied prefix by mix-weighted own-perspective trend; every trend is 1-ply-vs-static (mixed ply counts
 * inside a comparison are the depth-asymmetry trap). EVs, cell values and the score never move.
 */
export function applyTrendTiebreak(
  matrix: ValueMatrix,
  result: EvalResult,
  trends: Map<number, number>,
): void {
  const mixes = result.matrix?.mixes;
  if (!mixes) return;
  for (const group of tieGroups(matrix, result)) {
    const side = group[0].side;
    const oppMix = side === 'p1' ? mixes.p2 : mixes.p1;
    const rowTrend = groupRowTrends(group, matrix, trends, oppMix);
    if (!rowTrend || rowTrend.size < group.length) continue;
    const spread = Math.max(...rowTrend.values()) - Math.min(...rowTrend.values());
    if (spread < TREND_MARGIN) continue;
    // Write back into the group's own slots: core-deduping can leave gaps in the tied prefix.
    const slots = group.map(row => row.listIndex).sort((a, b) => a - b);
    const reordered = group.map(row => row.entry)
      .sort((a, b) => rowTrend.get(b.choice)! - rowTrend.get(a.choice)!);
    const list = result.perSide[side];
    slots.forEach((slot, index) => { list[slot] = reordered[index]; });
  }
}
