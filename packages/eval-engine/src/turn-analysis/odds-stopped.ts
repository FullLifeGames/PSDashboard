import { toId } from '@fulllifegames/replay-core';
import type { KoOddsInfo, MatrixCell, RankedChoice } from '../types.ts';
import { matchClickedColumn } from './played-match.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis } from './types.ts';

// Which claims price a hit that never landed against the click: a plain ("none") cell lands none; a doubles cell lists
// its events (`p1b:terastarstorm>p2b=hit-nokill`): a claim without one never landed. Singles name no move: claims stay.

const SLOT_LETTERS = ['a', 'b', 'c'];

function claimStopped(cell: MatrixCell | undefined, odds: KoOddsInfo, side: Side): boolean {
  if (!cell) return false;
  if (cell.plan === 'none') return true;
  if (cell.plan !== 'events' || !cell.classes || !odds.label || !odds.attacker) return false;
  const letter = SLOT_LETTERS[odds.attacker.slot];
  if (letter === undefined) return false;
  // The label is "Move→Target"; the event key of the pair plan is "<side><slot>:<move id>><target slot>=<outcome>".
  const prefix = `${side}${letter}:${toId(odds.label.split('→')[0])}>`;
  return !cell.classes.some(entry => entry.key.includes(prefix));
}

function cellAgainstClick(params: AnalyzeTurnParams, key: Side): ((line: RankedChoice | null | undefined) => MatrixCell | undefined) | null {
  const matrix = params.result.matrix;
  if (!matrix?.cells || !matrix.p1Choices || !matrix.p2Choices) return null;
  const clicked = matchClickedColumn(params.result, key === 'p1' ? 'p2' : 'p1', params.played);
  const ownChoices = key === 'p1' ? matrix.p1Choices : matrix.p2Choices;
  const column = clicked ? (key === 'p1' ? matrix.p2Choices : matrix.p1Choices).indexOf(clicked.choice) : -1;
  if (column < 0) return null;
  return line => {
    const own = line ? ownChoices.indexOf(line.choice) : -1;
    return own < 0 ? undefined : matrix.cells![key === 'p1' ? own : column]?.[key === 'p1' ? column : own];
  };
}

function shownRecommendation(
  options: RankedChoice[], best: RankedChoice | null, bestNull: SideAnalysis['bestNull'],
): { line: RankedChoice | null | undefined; odds: KoOddsInfo | undefined } {
  const alternative = bestNull?.alternative;
  return alternative
    ? { line: options.find(option => option.label === alternative.label), odds: alternative.koOdds }
    : { line: best, odds: best?.koOdds };
}

/** The claims of one side's clause the actual click stops; undefined when none or without cell facts. */
export function hitStoppedFor(
  params: AnalyzeTurnParams,
  key: Side,
  options: RankedChoice[],
  played: RankedChoice | null,
  best: RankedChoice | null,
  bestNull: SideAnalysis['bestNull'],
): SideAnalysis['hitStopped'] {
  const cellOf = cellAgainstClick(params, key);
  if (!cellOf) return undefined;
  const shown = shownRecommendation(options, best, bestNull);
  const stopped: NonNullable<SideAnalysis['hitStopped']> = {};
  if (played?.koOdds && claimStopped(cellOf(played), played.koOdds, key)) stopped.played = true;
  if (shown.odds && claimStopped(cellOf(shown.line), shown.odds, key)) stopped.best = true;
  return stopped.played || stopped.best ? stopped : undefined;
}
