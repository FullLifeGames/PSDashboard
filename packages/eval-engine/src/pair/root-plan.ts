import type { MatchupCache } from '../eval-function.ts';
import type { SimPosition } from '../forward-model.ts';
import type { CellOutcomeClass, PlannedCell } from '../types.ts';
import { pairCellSample } from './sampler.ts';

/**
 * Round 70 (T217): the pair plan's answer for a doubles root cell, in the shape the matrix cells carry (PlannedCell, the doubles
 * twin of planCellEvents' answer for singles). A cell the plan finds plain, with no accuracy roll and no kill range in the
 * pair, is `none`; a planned cell is `events` with its outcome classes, heaviest first (ties by key), the weights summing to 1,
 * each key the sequence of the cell's events (`p1b:terastarstorm>p2b=hit-nokill`: attacker slot, move, target slot, outcome);
 * a cell the plan hands to the plain mean (a guard it does not price) or cannot parse is left out, which the matrix reads as
 * failed. One base draw, the cheapest plan: the weights are the analytic products of the events, not counts of draws.
 */
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
