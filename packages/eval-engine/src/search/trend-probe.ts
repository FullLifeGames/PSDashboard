import type { MatchupCache } from '../eval-function.ts';
import { advancePosition, advancePositionWithLog, positionBattle, type SimPosition } from '../forward-model.ts';
import type { CellDraw, EvalResult } from '../types.ts';
import { leafValue, SEARCH_SEEDS, tieOrderScripts } from './leaf.ts';

/**
 * Round 70: the horizon-trend probe of one base draw of a decisive cell. The trend layers ask how a tied row's
 * decisive cell moves when the search looks one ply further; the answer for one draw is the sub-search of the child
 * that draw leads to minus that child's own leaf (never the cell's mean over draws, which would read the outcome
 * variance of one draw as a trend). The sync search and the executor's sub-search job both run this, the orchestrator
 * averages the answers of a cell's draws (ranking/trend.ts meanTrend).
 */

/**
 * The child one base draw of a cell leads to: the very child the matrix priced, the draw's seed and, for a
 * speed-tied cell, the move order scripted into it (cell-sampler.ts mixOrders).
 */
export function drawChild(root: SimPosition, p1Choice: string, p2Choice: string, draw: CellDraw): SimPosition {
  const seed = SEARCH_SEEDS[draw.index];
  if (!draw.first) return advancePosition(root, p1Choice, p2Choice, seed);
  const scripts = tieOrderScripts(p1Choice, p2Choice)[draw.first];
  return advancePositionWithLog(root, p1Choice, p2Choice, seed, { scripts }).child;
}

/** The draw's child searched by `search`, the answer carrying its `trend`: the score minus the child's own leaf. */
export function probeDraw(
  root: SimPosition,
  p1Choice: string,
  p2Choice: string,
  draw: CellDraw,
  search: (serialized: string) => EvalResult,
  matchupCache: MatchupCache,
): EvalResult & { trend: number } {
  const child = drawChild(root, p1Choice, p2Choice, draw);
  const leaf = leafValue(positionBattle(child), matchupCache);
  const answer = search(child.serialized);
  return { ...answer, trend: answer.score - leaf };
}
