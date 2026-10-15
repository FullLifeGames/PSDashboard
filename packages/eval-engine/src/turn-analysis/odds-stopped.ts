import { toId } from '@fulllifegames/replay-core';
import type { KoOddsInfo, MatrixCell, RankedChoice } from '../types.ts';
import { matchClickedColumn } from './played-match.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis } from './types.ts';

/**
 * Round 70 (gate of 13.10.2026 20:26, 4a): which KO-odds claims of a side's clause price a hit that never landed against the
 * opponent's actual click. A claim ("Tera Starstorm kills ~4% of the time") is priced on the board before the turn and says
 * nothing about the opponent's reply; when that reply stops the hit (Wide Guard turns Tera Starstorm away, a Protect a single
 * hit) the note quotes a roll that did not happen (VGC 2630685175 turn 7). The answer comes from the cell of the line against
 * the click, which the search priced from the simulator's own turn, so no move name enters here:
 *  - a cell the planner calls plain ("none") holds no uncertain hit at all, so every claim of that cell never landed;
 *  - a doubles cell lists the events of its classes with their attacker slot and move (`p1b:terastarstorm>p2b=hit-nokill`);
 *    a claim whose attacker slot and move have no event there never landed. A singles class names no move, so a singles cell
 *    that holds a roll keeps the claim.
 * A cell the search did not plan or failed on, and a claim the cell still lists, keep the claim. Display only, pure.
 */

const SLOT_LETTERS = ['a', 'b', 'c'];

/** The claim's hit has no uncertain outcome in the cell of its line against the click. */
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

/** The cell of one own line against the opponent's actual click (cells[p1 row][p2 column]); null without cell facts or a click. */
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

/** The recommendation the clause shows: the best, or the co-optimal alternative that replaces a mechanically null best. */
function shownRecommendation(
  options: RankedChoice[], best: RankedChoice | null, bestNull: SideAnalysis['bestNull'],
): { line: RankedChoice | null | undefined; odds: KoOddsInfo | undefined } {
  const alternative = bestNull?.alternative;
  return alternative
    ? { line: options.find(option => option.label === alternative.label), odds: alternative.koOdds }
    : { line: best, odds: best?.koOdds };
}

/**
 * The claims of one side's clause the actual click stops: the played line's KO odds and the shown recommendation's.
 * Undefined when no claim is stopped or the result carries no cell facts.
 */
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
