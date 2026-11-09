import type { MctsTreeStats } from '../types.ts';
import { VERIFY_DISAGREEMENT, VERIFY_MIN_VISITS } from '../verify-select.ts';

/**
 * Round 43: the per-class pool of a root chance cell across trees. Every
 * tree drew the same classes in the first two plies (fixed seeds, forced
 * draws), so the pool is keyed by class: one static prior per tree and
 * class, the class weights from the first tree. Sim-free, like the merge.
 */
export type TreeCell = MctsTreeStats['cells'][number];

const sameKeys = (cells: TreeCell[]): boolean => {
  const keys = cells[0].classes!.map(cls => cls.key);
  return cells.every(cell => cell.classes!.length === keys.length && cell.classes!.every((cls, index) => cls.key === keys[index]));
};

/** Σ weight × pooled class mean when every given cell carries the same classes; null otherwise (the caller pools the cell). */
export function pooledChanceValue(cells: TreeCell[]): number | null {
  if (cells.length === 0 || !cells.every(cell => cell.classes && cell.classes.length > 0) || !sameKeys(cells)) return null;
  let value = 0;
  cells[0].classes!.forEach((first, index) => {
    let total = 0;
    let weight = 0;
    for (const cell of cells) {
      const cls = cell.classes![index];
      total += cls.total + cls.value;
      weight += cls.visits + 1;
    }
    value += first.weight * (total / weight);
  });
  return value;
}

export interface PoolEntry { mean: number; weight: number; visits: number }

/** One tree's contribution for one class: its prior-blended mean and weight; null when the cell has no such class or the class ended. */
function classPoolEntry(cell: TreeCell, classKey: string): PoolEntry | null {
  const cls = cell.classes?.find(entry => entry.key === classKey);
  if (!cls || cls.ended) return null;
  return { mean: (cls.total + cls.value) / (cls.visits + 1), weight: cls.visits + 1, visits: cls.visits };
}

/**
 * One tree's contribution to a root cell's continuation pool: a chance cell
 * answers per class from its own subtree stats; a plain cell joins when it
 * did not end the game and (with a class key) drew that class, or carries no
 * recorded class while `acceptUnkeyed` (the one-open-class shape). Null when
 * the tree does not join.
 */
export function cellContribution(cell: TreeCell | undefined, classKey: string | undefined, acceptUnkeyed: boolean): PoolEntry | null {
  if (!cell) return null;
  if (classKey !== undefined && cell.classes) return classPoolEntry(cell, classKey);
  if (cell.ended) return null;
  if (classKey !== undefined && cell.classKey !== classKey && !(acceptUnkeyed && cell.classKey === undefined)) return null;
  return { mean: (cell.total + cell.value) / (cell.visits + 1), weight: cell.visits + 1, visits: cell.visits };
}

/**
 * A tree that visited a class less than this share of the class's deepest tree is thin: it leaves the count, the
 * spread and the value of the pool (round 89, T322).
 */
const THIN_SHARE = 1 / 8;

/**
 * A value short of a decided game needs a pool that played the cell out, more than the VERIFY_MIN_VISITS a decided
 * pool needs. Champions VGC 2628166702 turn 7 (the last pair) pooled 24 visits of Dark Pulse into Protect at about
 * 0.1, while the sampler one ply deeper read the win the prover proves in two turns (T63's pools held 400 to 650).
 * Round 89: the lone tree of a blend class stands from the same number (moved here from mcts-merge.ts).
 */
export const VERIFY_ENDGAME_MIN_VISITS = 100;

/**
 * Round 89 (T322, #59): whether the trees' pool of one open class of a blend carries its own depth. Per kept tree the
 * mean `m` and weight `w = visits + 1` come from `classPoolEntry`; a thin tree (visits below an eighth of the deepest
 * tree of the class) leaves. Two or more kept trees stand on a Kish-weighted standard error of their means, at most
 * VERIFY_DISAGREEMENT, with VERIFY_MIN_VISITS pooled visits (two equal trees read the old spread); one kept tree stands
 * from VERIFY_ENDGAME_MIN_VISITS visits. No magnitude test and no endgame clause: a class a tree has played out reads its
 * mean in a middlegame too, and the sampler's one-ply mean takes only the classes no tree has searched deep enough.
 * Sim-free.
 */
export function classPoolTrust(entries: readonly PoolEntry[]): { deep: boolean; value: number; trees: number; visits: number; spread: number } {
  const deepest = entries.reduce((most, entry) => Math.max(most, entry.visits), 0);
  const kept = entries.filter(entry => entry.visits >= deepest * THIN_SHARE);
  const weight = kept.reduce((sum, entry) => sum + entry.weight, 0);
  const visits = kept.reduce((sum, entry) => sum + entry.visits, 0);
  const value = weight > 0 ? kept.reduce((sum, entry) => sum + entry.mean * entry.weight, 0) / weight : NaN;
  if (kept.length === 0 || weight <= 0) return { deep: false, value, trees: 0, visits: 0, spread: 0 };
  if (kept.length === 1) return { deep: visits >= VERIFY_ENDGAME_MIN_VISITS, value, trees: 1, visits, spread: 0 };
  const squares = kept.reduce((sum, entry) => sum + entry.weight * entry.weight, 0);
  const effective = (weight * weight) / squares;
  const variance = kept.reduce((sum, entry) => sum + entry.weight * (entry.mean - value) ** 2, 0) / weight;
  const spread = Math.sqrt(variance / (effective - 1));
  return { deep: spread <= VERIFY_DISAGREEMENT && visits >= VERIFY_MIN_VISITS, value, trees: kept.length, visits, spread };
}
