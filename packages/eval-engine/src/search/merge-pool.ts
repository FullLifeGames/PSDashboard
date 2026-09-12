import type { MctsTreeStats } from '../types.ts';

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

interface PoolEntry { mean: number; weight: number; visits: number }

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
