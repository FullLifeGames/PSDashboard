import type { MctsTreeStats } from '../types.ts';

export type TreeCell = MctsTreeStats['cells'][number];

// m_c = sum (total + value) / sum (visits + 1) over the trees of class c; a visit pool would weigh classes by draws.
/** A keyed root cell's value as the mix `sum_c w_c m_c / sum_c w_c`; null with fewer than two classes. */
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

/** One tree's share of a cell's pool: not ended, class drawn (or none recorded while `acceptUnkeyed`); else null. */
export function cellContribution(cell: TreeCell | undefined, classKey: string | undefined, acceptUnkeyed: boolean): PoolEntry | null {
  if (!cell) return null;
  if (cell.ended) return null;
  if (classKey !== undefined && cell.classKey !== classKey && !(acceptUnkeyed && cell.classKey === undefined)) return null;
  return { mean: (cell.total + cell.value) / (cell.visits + 1), weight: cell.visits + 1, visits: cell.visits };
}
