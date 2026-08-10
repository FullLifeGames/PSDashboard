import type { EvalMatrix, EvalResult, RankedChoice } from './types';

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
  /** Solved value of the matrix game (p1 perspective); rootValue when a side has no options. */
  gameValue: number;
  /** The solved matrix + mixes, for the Read lens (absent when degenerate). */
  matrixOut?: EvalMatrix;
}

export type PvStep = { p1: string; p2: string };

export const cellKey = (i: number, j: number) => i * 10_000 + j;

export const TOP_EXPANSION = 5;

export const EQUILIBRIUM_ITERATIONS = 4000;

export interface MatrixSolution {
  /** Solved value of the zero-sum game (p1 perspective). */
  value: number;
  p1Mix: number[];
  p2Mix: number[];
}

/**
 * Regret-matching self-play on the zero-sum matrix game (Hart & Mas-Colell).
 * The AVERAGE strategies converge to a Nash equilibrium — the current
 * strategies do not, so only the averages are returned. Deterministic: a
 * fixed iteration count and no randomness.
 */
export function solveMatrixGame(values: number[][]): MatrixSolution {
  const rows = values.length;
  const cols = rows > 0 ? values[0].length : 0;
  if (rows === 0 || cols === 0) return { value: 0, p1Mix: [], p2Mix: [] };

  const regret1 = new Array<number>(rows).fill(0);
  const regret2 = new Array<number>(cols).fill(0);
  const sum1 = new Array<number>(rows).fill(0);
  const sum2 = new Array<number>(cols).fill(0);

  const mixFromRegret = (regret: number[]): number[] => {
    let total = 0;
    for (const r of regret) total += Math.max(0, r);
    if (total <= 0) return regret.map(() => 1 / regret.length);
    return regret.map(r => Math.max(0, r) / total);
  };

  for (let t = 0; t < EQUILIBRIUM_ITERATIONS; t++) {
    const mix1 = mixFromRegret(regret1);
    const mix2 = mixFromRegret(regret2);
    for (let i = 0; i < rows; i++) sum1[i] += mix1[i];
    for (let j = 0; j < cols; j++) sum2[j] += mix2[j];

    const rowEv = values.map(row => row.reduce((sum, cell, j) => sum + cell * mix2[j], 0));
    const colEv = new Array<number>(cols).fill(0);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) colEv[j] += values[i][j] * mix1[i];
    }
    const v = rowEv.reduce((sum, ev, i) => sum + ev * mix1[i], 0);
    for (let i = 0; i < rows; i++) regret1[i] += rowEv[i] - v;
    for (let j = 0; j < cols; j++) regret2[j] += v - colEv[j];
  }

  const normalize = (sums: number[]): number[] => {
    const total = sums.reduce((sum, entry) => sum + entry, 0);
    return sums.map(entry => entry / total);
  };
  const p1Mix = normalize(sum1);
  const p2Mix = normalize(sum2);
  let value = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) value += values[i][j] * p1Mix[i] * p2Mix[j];
  }
  return { value, p1Mix, p2Mix };
}

export function rankFromMatrix(matrix: ValueMatrix, rootValue: number): Ranked {
  const { p1Options, p2Options, values } = matrix;

  // The one-shot matrix game's equilibrium prices every choice: `ev` is the
  // expected value against the opponent's mixture. The floor (worstCase)
  // stays as the safety column — sorting goes by ev, ties by floor.
  const solved = p1Options.length > 0 && p2Options.length > 0;
  const solution = solved ? solveMatrixGame(values) : { value: rootValue, p1Mix: [], p2Mix: [] };

  const p1: RankedChoice[] = p1Options.map((option, i) => {
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

  const p2: RankedChoice[] = p2Options.map((option, j) => {
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

  const v1 = p1.length > 0 ? Math.max(...p1.map(choice => choice.worstCase)) : rootValue;
  const v2 = p2.length > 0 ? -Math.max(...p2.map(choice => choice.worstCase)) : rootValue;
  return {
    p1, p2, v1, v2,
    gameValue: solved ? solution.value : rootValue,
    ...(solved
      ? {
        matrixOut: {
          p1Labels: p1Options.map(option => option.label),
          p2Labels: p2Options.map(option => option.label),
          p1Choices: p1Options.map(option => option.choice),
          p2Choices: p2Options.map(option => option.choice),
          values: values.map(row => [...row]),
          mixes: { p1: solution.p1Mix, p2: solution.p2Mix },
        },
      }
      : {}),
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

/** Rows within this of the top EV are a coin flip the static ranking cannot split. */
export const TIE_EPSILON = 0.02;
/** A tie is reordered only when the trend separation is meaningful. */
export const TREND_MARGIN = 0.02;
/** Widest tied prefix examined per side. */
const TIE_GROUP_CAP = 3;
/** Mix-weight floor so a 0%-mix punisher still counts a little. */
const MIN_TREND_WEIGHT = 0.05;

export const GIMMICK_TOKENS = new Set(['terastallize', 'mega', 'ultra']);

/** The choice minus its gimmick markers: 'move x terastallize, move y' → 'move x, move y'. */
export const coreOf = (choice: string) => choice.split(',').map(part =>
  part.trim().split(' ').filter(token => !GIMMICK_TOKENS.has(token)).join(' ')).join(', ');

interface TieRow {
  side: 'p1' | 'p2';
  entry: RankedChoice;
  /** This entry's position in the ranked list — reorders write back into these slots. */
  listIndex: number;
  /** The cells that decide this row: its punisher and the opponent's modal reply. */
  cells: [number, number][];
}

/**
 * The tied leading rows per side: an ev-sorted PREFIX within TIE_EPSILON of
 * the top, each carrying its decisive cells. A gimmick variant tied with its
 * own core is NOT a stall-vs-progress question but a resource-spend one —
 * only the first row per core enters, so the plain-first convention stands.
 * Needs the solved mixes; a side whose entries cannot all be mapped back to
 * options yields no group.
 */
function tieGroups(matrix: ValueMatrix, result: EvalResult): TieRow[][] {
  const mixes = result.matrix?.mixes;
  if (!mixes) return [];
  const byChoice = {
    p1: new Map(matrix.p1Options.map((option, index) => [option.choice, index])),
    p2: new Map(matrix.p2Options.map((option, index) => [option.choice, index])),
  };
  const groups: TieRow[][] = [];
  for (const side of ['p1', 'p2'] as const) {
    const list = result.perSide[side];
    if (list.length < 2) continue;
    const cores = new Set<string>();
    const tied: { entry: RankedChoice; listIndex: number }[] = [];
    for (let listIndex = 0; listIndex < Math.min(list.length, TIE_GROUP_CAP); listIndex++) {
      const entry = list[listIndex];
      if (list[0].ev - entry.ev > TIE_EPSILON) break;
      const core = coreOf(entry.choice);
      if (cores.has(core)) continue;
      cores.add(core);
      tied.push({ entry, listIndex });
    }
    if (tied.length < 2) continue;
    const oppMix = side === 'p1' ? mixes.p2 : mixes.p1;
    let modal = 0;
    oppMix.forEach((weight, index) => { if (weight > oppMix[modal]) modal = index; });
    const group: TieRow[] = [];
    for (const { entry, listIndex } of tied) {
      const own = byChoice[side].get(entry.choice);
      if (own === undefined) break;
      // p1 rows fear the column MINIMUM, p2 columns fear the row MAXIMUM
      // (values are p1-perspective throughout).
      const against = side === 'p1' ? matrix.values[own] : matrix.values.map(row => row[own]);
      let punish = 0;
      for (let index = 1; index < against.length; index++) {
        if (side === 'p1' ? against[index] < against[punish] : against[index] > against[punish]) punish = index;
      }
      const cells = [...new Set([punish, modal])].map(opp =>
        (side === 'p1' ? [own, opp] : [opp, own]) as [number, number]);
      group.push({ side, entry, listIndex, cells });
    }
    if (group.length === tied.length) groups.push(group);
  }
  return groups;
}

/**
 * The cells whose one-ply trend the tiebreak still needs: decisive cells of
 * tied rows that are neither terminal nor already priced in `trends`.
 */
export function selectTieProbeCells(
  matrix: ValueMatrix,
  result: EvalResult,
  trends: Map<number, number>,
): [number, number][] {
  const cells: [number, number][] = [];
  const seen = new Set<number>();
  for (const group of tieGroups(matrix, result)) {
    for (const row of group) {
      for (const [i, j] of row.cells) {
        const key = cellKey(i, j);
        if (seen.has(key) || matrix.ended[i][j] || trends.has(key)) continue;
        seen.add(key);
        cells.push([i, j]);
      }
    }
  }
  return cells;
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
    const rowTrend = new Map<string, number>();
    for (const row of group) {
      let weightSum = 0;
      let weighted = 0;
      let missing = false;
      for (const [i, j] of row.cells) {
        const trend = matrix.ended[i][j] ? 0 : trends.get(cellKey(i, j));
        if (trend === undefined) {
          missing = true;
          break;
        }
        const weight = Math.max(oppMix[side === 'p1' ? j : i] ?? 0, MIN_TREND_WEIGHT);
        weightSum += weight;
        weighted += weight * trend;
      }
      // An unpriced cell (probe budget/stop) forfeits the whole reorder —
      // a partial comparison would be exactly the asymmetry to avoid.
      if (missing || weightSum === 0) {
        rowTrend.clear();
        break;
      }
      // Trends are p1-perspective; a p2 row reads them negated.
      rowTrend.set(row.entry.choice, (side === 'p1' ? 1 : -1) * (weighted / weightSum));
    }
    if (rowTrend.size < group.length) continue;
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
