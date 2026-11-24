import type { MatchupCache } from '../eval-function.ts';
import type { SimPosition } from '../forward-model.ts';
import type { CellOutcomeClass, PlannedCell } from '../types.ts';
import { pairCellSample } from './sampler.ts';

/** The pair plan's answer for a doubles root cell: `none` or `events` (classes heaviest first, weights sum to 1). */
// A cell the plan hands to the plain mean or cannot parse is left out, which the matrix reads as failed.
export function pairPlanAnswer(
  root: SimPosition, key: number, p1Choice: string, p2Choice: string, matchupCache: MatchupCache,
): PlannedCell | null {
  const cell = pairCellSample(root, p1Choice, p2Choice, 1, matchupCache);
  if (cell.kind === 'plain') return { key, plan: 'none' };
  if (cell.kind !== 'sample' || cell.via !== 'plan' || !cell.sample.blend) return null;
  const classes: CellOutcomeClass[] = cell.sample.blend.classes
    .map(entry => ({ key: entry.key, weight: entry.weight }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { key, plan: 'events', classes };
}
