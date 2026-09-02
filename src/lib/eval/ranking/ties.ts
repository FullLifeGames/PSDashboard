import type { EvalResult, RankedChoice } from '../types';
import { cellKey, type ValueMatrix } from './matrix';

/**
 * Tied leading rows: the coin-flip prefix the static ranking cannot split,
 * their decisive cells, and the one-ply probe cells the trend layers price.
 */

/** Rows within this of the top EV are a coin flip the static ranking cannot split. */
export const TIE_EPSILON = 0.02;
/** A tie is reordered only when the trend separation is meaningful. */
export const TREND_MARGIN = 0.02;
/** Widest tied prefix examined per side. */
const TIE_GROUP_CAP = 3;
/** Mix-weight floor so a 0%-mix punisher still counts a little. */
export const MIN_TREND_WEIGHT = 0.05;

export const GIMMICK_TOKENS = new Set(['terastallize', 'mega', 'ultra']);

/** The choice minus its gimmick markers: 'move x terastallize, move y' → 'move x, move y'. */
export const coreOf = (choice: string) => choice.split(',').map(part =>
  part.trim().split(' ').filter(token => !GIMMICK_TOKENS.has(token)).join(' ')).join(', ');

export interface TieRow {
  side: 'p1' | 'p2';
  entry: RankedChoice;
  /** This entry's position in the ranked list — reorders write back into these slots. */
  listIndex: number;
  /** The cells that decide this row: its punisher and the opponent's modal reply. */
  cells: [number, number][];
}

/** The ev-sorted tied prefix of one side's list within TIE_EPSILON of the top, one row per core. */
function tiedPrefix(list: RankedChoice[]): { entry: RankedChoice; listIndex: number }[] {
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
  return tied;
}

/** The opponent's modal reply: the heaviest mix index (the first wins ties). */
function modalIndex(oppMix: number[]): number {
  let modal = 0;
  oppMix.forEach((weight, index) => { if (weight > oppMix[modal]) modal = index; });
  return modal;
}

/**
 * The cells that decide a tied row: its punisher and the opponent's modal
 * reply. p1 rows fear the column MINIMUM, p2 columns fear the row MAXIMUM
 * (values are p1-perspective throughout).
 */
function decisiveCells(matrix: ValueMatrix, side: 'p1' | 'p2', own: number, modal: number): [number, number][] {
  const against = side === 'p1' ? matrix.values[own] : matrix.values.map(row => row[own]);
  let punish = 0;
  for (let index = 1; index < against.length; index++) {
    if (side === 'p1' ? against[index] < against[punish] : against[index] > against[punish]) punish = index;
  }
  return [...new Set([punish, modal])].map(opp =>
    (side === 'p1' ? [own, opp] : [opp, own]) as [number, number]);
}

/**
 * The tied leading rows per side: an ev-sorted PREFIX within TIE_EPSILON of
 * the top, each carrying its decisive cells. A gimmick variant tied with its
 * own core is NOT a stall-vs-progress question but a resource-spend one —
 * only the first row per core enters, so the plain-first convention stands.
 * Needs the solved mixes; a side whose entries cannot all be mapped back to
 * options yields no group.
 */
export function tieGroups(matrix: ValueMatrix, result: EvalResult): TieRow[][] {
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
    const tied = tiedPrefix(list);
    if (tied.length < 2) continue;
    const modal = modalIndex(side === 'p1' ? mixes.p2 : mixes.p1);
    const group: TieRow[] = [];
    for (const { entry, listIndex } of tied) {
      const own = byChoice[side].get(entry.choice);
      if (own === undefined) break;
      group.push({ side, entry, listIndex, cells: decisiveCells(matrix, side, own, modal) });
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
