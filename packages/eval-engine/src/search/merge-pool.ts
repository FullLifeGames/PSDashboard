import type { MctsTreeStats } from '../types.ts';

/** One tree's cell stats in the merge (sim-free, like the merge). */
export type TreeCell = MctsTreeStats['cells'][number];

/**
 * Round 89 (T322, #59): a keyed root cell, the tree cells of one matrix cell that each drew one outcome class (`classKey`) and
 * booked the plan's chance of it (`classWeight`). With two or more classes among the trees the cell reads the Dex's mix,
 * `sum_c w_c m_c / sum_c w_c`, where `m_c = sum (total + value) / sum (visits + 1)` over the trees of class c, instead of the
 * visit pool (the trees' draws, not the dice, would weigh the classes). `visits` and `total` are the sums of the keyed trees
 * that did not end the game: what their row and column marginals hold (pair-tree-key.spec.ts (g)), so the visit mean of the score
 * can swap their totals for `visits * value`. A tree without a key leaves the cell's value. Null with fewer than two classes.
 * Sim-free.
 */
export function keyedCell(cells: readonly TreeCell[]): { value: number; visits: number; total: number } | null {
  const classes = new Map<string, { weight: number; total: number; visits: number }>();
  let visits = 0;
  let total = 0;
  for (const cell of cells) {
    if (cell.classKey === undefined || cell.classWeight === undefined || !(cell.classWeight > 0)) continue;
    const cls = classes.get(cell.classKey) ?? { weight: cell.classWeight, total: 0, visits: 0 };
    cls.total += cell.total + cell.value;
    cls.visits += cell.visits + 1;
    classes.set(cell.classKey, cls);
    if (!cell.ended) {
      visits += cell.visits;
      total += cell.total;
    }
  }
  if (classes.size < 2) return null;
  let weight = 0;
  let mix = 0;
  for (const cls of classes.values()) {
    weight += cls.weight;
    mix += cls.weight * (cls.total / cls.visits);
  }
  return { value: mix / weight, visits, total };
}

export const keyedCellValue = (cells: readonly TreeCell[]): number | null => keyedCell(cells)?.value ?? null;

interface PoolEntry { mean: number; weight: number; visits: number }

/**
 * One tree's contribution to a root cell's continuation pool: a cell joins when it did not end the game and (with a class key) drew
 * that class, or carries no recorded class while `acceptUnkeyed` (the one-open-class shape). Null when the tree does not join.
 */
export function cellContribution(cell: TreeCell | undefined, classKey: string | undefined, acceptUnkeyed: boolean): PoolEntry | null {
  if (!cell) return null;
  if (cell.ended) return null;
  if (classKey !== undefined && cell.classKey !== classKey && !(acceptUnkeyed && cell.classKey === undefined)) return null;
  return { mean: (cell.total + cell.value) / (cell.visits + 1), weight: cell.visits + 1, visits: cell.visits };
}
