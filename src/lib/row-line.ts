import type { EvalResult, LineStep, RankedChoice } from '@fulllifegames/eval-engine';
import { linesForMode, pivotMove } from './worst-reply';
import { replacementWords } from './line-view';

/**
 * Round 89 (LN-4, F1 of LN-3): one card shows one line per row. The "then ..." that follows a ranked row used to read the engine's
 * principal variation, which one tree and the heaviest-cell rule write; the Lines section reads the row's own line, which the lines job
 * wrote from the trees' lines by value. Two readings of one row put two different third turns on a card (655336 turn 24). Both texts
 * now read the line of `result.lines`, through the same `linesForMode` the Lines section reads, so Hard mode swaps both.
 */

type Side = 'p1' | 'p2';
type Step = { p1: string; p2: string };

const labelsOf = (step: LineStep): Step => step.replacement
  ? { p1: replacementWords(step.p1.label), p2: replacementWords(step.p2.label) }
  : { p1: step.p1.label, p2: step.p2.label };

/**
 * The later steps of a ranked row's line, as `formatLine` prints them. Only a row that carries a tail today (`row.line`, the engine's
 * principal variation: the best row of the search) shows one, so no new text appears on other rows. A result with lines reads the line
 * the Lines section shows for the row (its first step is the row itself); none for the row means no tail. A result without lines (a
 * matrix search, an old stored result, a turn the stage has not searched yet) keeps the principal variation.
 */
export function rowLineTail(
  result: Pick<EvalResult, 'lines'> | null | undefined, side: Side, row: Pick<RankedChoice, 'choice' | 'label' | 'line'>, hardMode: boolean,
): Step[] | undefined {
  if (!row.line || row.line.length === 0) return undefined;
  if (!result?.lines) return row.line;
  const line = linesForMode(result.lines, hardMode).find(entry => entry.side === side && (entry.choice === row.choice || entry.label === row.label || entry.label === pivotMove(row.label)));
  if (!line) return [];
  const tail = line.steps.slice(1);
  // a pivot's row names the move and the body it brings in; the line's replacement step after the move says it again
  if (line.label !== row.label) while (tail[0]?.replacement) tail.shift();
  return tail.map(labelsOf);
}
