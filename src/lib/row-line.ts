import type { EvalResult, LineStep, RankedChoice } from '@fulllifegames/eval-engine';
import { linesForMode, pivotMove } from './worst-reply';


type Side = 'p1' | 'p2';
type Step = { p1: string; p2: string; replacement?: 'p1' | 'p2' | 'both' };

const labelsOf = (step: LineStep): Step =>
  ({ p1: step.p1.label, p2: step.p2.label, ...(step.replacement ? { replacement: step.replacement } : {}) });

// Reads the engine's usual line, whatever the opponent-reads setting; a result without lines keeps the row's own line.
// A row that waits shows none.
export function rowLineTail(
  result: Pick<EvalResult, 'lines'> | null | undefined, side: Side, row: Pick<RankedChoice, 'choice' | 'label' | 'line'>,
): Step[] | undefined {
  if (row.choice === 'wait') return [];
  if (!result?.lines) return row.line;
  const line = linesForMode(result.lines, false).find(entry => entry.for.includes('engine') && entry.side === side && (entry.choice === row.choice || entry.label === row.label || entry.label === pivotMove(row.label)));
  if (!line) return [];
  const tail = line.steps.slice(1);
  // a pivot's row names the move and the body it brings in; the line's replacement step after the move says it again
  if (line.label !== row.label) while (tail[0]?.replacement) tail.shift();
  return tail.map(labelsOf);
}
