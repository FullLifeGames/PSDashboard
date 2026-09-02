import type { EvalResult } from '../types';
import { cellKey, type ValueMatrix } from './matrix';
import { MIN_TREND_WEIGHT, tieGroups, TREND_MARGIN, type TieRow } from './ties';

/**
 * The horizon-trend layers over tied rows: value extrapolation (2b) and the
 * ordering-only tiebreak, both on the same mix-weighted one-ply trend.
 */

/** 2b extrapolation strength: assume the observed bleed/build continues λ more plies. Swept {0.25, 0.5, 1.0}. */
export const TREND_LAMBDA = 0.5;
/**
 * Shifts below this stay unapplied: single-seed trend probes carry sampling
 * noise on this scale (the s3−s1 fork-delta family), and decided positions
 * tie structurally with near-zero trends — folding noise into values would
 * churn every endgame ranking the pruned sub-search path must mirror.
 */
export const TREND_SHIFT_FLOOR = 0.005;

/**
 * The mix-weighted one-ply trend of a tied row's decisive cells (terminal
 * cells count 0, a punisher's mix weight floors at MIN_TREND_WEIGHT); null
 * when a cell is unpriced (probe budget/stop) or no weight accrues.
 */
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
    // Trends live in p1 perspective, and so do the matrix values — the
    // cell shift applies unsigned for both sides' groups.
    shifts.push({ row, shift: lambda * value });
  }
  return shifts;
}

/**
 * Shifts one tied row's cells (clamped to the wp-unit range) and its ranked
 * entry in the row's own perspective; false when the row is not in the
 * matrix.
 */
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
 * Horizon-trend extrapolation (layer 2b): folds the one-ply trend of the tied
 * leading rows into their VALUES — corrected = deep + λ·trend — so a stall
 * that bleeds under lookahead separates from a building switch BY VALUE, not
 * just tie order (draft T50). The equilibrium is deliberately NOT re-solved:
 * re-solving lets the game absorb the correction — boosting a row re-weights
 * the opponent toward its punishers, and the T50 sweep measured every λ in
 * {0.25, 0.5, 1.0} self-defeating through exactly that feedback. Under FIXED
 * mixes the row-uniform shift adds a constant to the opponent's EVs, so
 * their comparisons are provably untouched (the quiescence lesson's depth
 * symmetry, exact); the solved score, mixes, and gameValue stay, keeping the
 * layer calibration-neutral by construction. Ranked rows shift in their own
 * perspective and each list re-sorts; a group with any unpriced decisive
 * cell forfeits whole (terminal cells price as trend 0); corrected cells
 * clamp to the wp-unit range. Returns true when anything shifted.
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
 * The per-row trends of a tie group in the group's own perspective (a p2
 * row reads the p1-perspective trend negated); null when any row's trend
 * is unpriced — a partial comparison would be exactly the asymmetry to
 * avoid.
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
 * Horizon-trend tiebreak. When the leading rows tie within TIE_EPSILON the
 * static matrix cannot split them — but the one-ply trend of their decisive
 * cells can tell a line that BUILDS (value rises under lookahead) from one
 * that BLEEDS (draft T50: the Recover stall holds its static value yet loses
 * ground every ply actually searched, while the Heatran switch improves).
 * Reorders ONLY the tied prefix by mix-weighted own-perspective trend; every
 * trend is uniformly 1-ply-vs-static (mixed ply counts inside a comparison
 * are the depth-asymmetry trap that broke the quiescence experiment). EVs,
 * cell values, and the score never move — ordering only, so grading stays
 * calibration-neutral by construction.
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
    // Write back into the group's OWN slots (core-deduping can leave gaps in
    // the tied prefix — skipped gimmick variants keep their positions).
    const slots = group.map(row => row.listIndex).sort((a, b) => a - b);
    const reordered = group.map(row => row.entry)
      .sort((a, b) => rowTrend.get(b.choice)! - rowTrend.get(a.choice)!);
    const list = result.perSide[side];
    slots.forEach((slot, index) => { list[slot] = reordered[index]; });
  }
}
