import type { EvalResult, LineStep, RankedChoice } from '@fulllifegames/eval-engine';
import { linesForMode, pivotMove } from './worst-reply';
import { replacementWords } from './line-view';

/**
 * One card shows one line per row: the "then ..." after a ranked row reads `result.lines` through the same `linesForMode` the Lines
 * section reads, so Hard mode swaps both (two readings once put two different third turns on one card, 655336 turn 24).
 */

type Side = 'p1' | 'p2';
type Step = { p1: string; p2: string };

const labelsOf = (step: LineStep): Step => step.replacement
  ? { p1: replacementWords(step.p1.label), p2: replacementWords(step.p2.label) }
  : { p1: step.p1.label, p2: step.p2.label };

/**
 * The later steps of a ranked row's line, as `formatLine` prints them. A result with lines reads the line the Lines section shows
 * for the row (its first step is the row itself); none for the row means no tail. A result without lines (a matrix search, an old
 * stored result, a turn not searched yet) keeps the row's principal variation (`row.line`) as its tail.
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
