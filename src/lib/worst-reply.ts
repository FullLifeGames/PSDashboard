import { winPctText, worstAnswer, type EvalLine, type EvalResult, type RankedChoice } from '@fulllifegames/eval-engine';

// The one rule of the reply that hurts a move most, read by the click walk, the turn dock and the lines.

type Side = 'p1' | 'p2';

// `cell`: the lowest trusted cell of the move's row; `punisher`: the row's own floor when no cell is trusted;
// `best`: the opponent's best row when the result names no floor.
export type ReplyBasis = 'cell' | 'punisher' | 'best';

/** `value` is the lowest cell's value from the row's own side (wp-units); null for a floor or a best row. */
export interface WorstReply { reply: RankedChoice; basis: ReplyBasis; value: number | null }

// The row is found by its choice string, so a clicked object from a card or a matrix cell reads the result's own floor.
export function worstReply(result: EvalResult, side: Side, row: Pick<RankedChoice, 'choice' | 'label' | 'punishedBy'>): WorstReply | null {
  const own = result.perSide[side].find(entry => entry.choice === row.choice) ?? row;
  const other: Side = side === 'p1' ? 'p2' : 'p1';
  const answer = worstAnswer(result, side, own);
  const found = answer ? result.perSide[other].find(entry => entry.choice === answer.choice) : undefined;
  if (answer && found) return { reply: found, basis: answer.basis, value: answer.basis === 'cell' ? cellValue(result, side, own.choice, found.choice) : null };
  const best = result.perSide[other].find(entry => entry.choice !== 'wait');
  return best ? { reply: best, basis: 'best', value: null } : null;
}

// From the row's own side (p1 reads the cell, p2 its negative); null where the matrix has no such pair.
function cellValue(result: EvalResult, side: Side, rowChoice: string, replyChoice: string): number | null {
  const matrix = result.matrix;
  if (!matrix?.p1Choices || !matrix.p2Choices) return null;
  const [i, j] = side === 'p1'
    ? [matrix.p1Choices.indexOf(rowChoice), matrix.p2Choices.indexOf(replyChoice)]
    : [matrix.p1Choices.indexOf(replyChoice), matrix.p2Choices.indexOf(rowChoice)];
  const value = matrix.values[i]?.[j];
  if (i < 0 || j < 0 || value === undefined || !Number.isFinite(value)) return null;
  return side === 'p1' ? value : -value;
}

// A pivot's rows are pairs, move and body ("U-turn → Keldeo"), while a line's step names the move alone. Only one
// arrow between two names counts (after a gimmick at most): a switch ("→ Keldeo") and a joint choice stay whole.
export const pivotMove = (label: string): string => (/^((Tera|Mega|Ultra) \+ )?[^→+]+ → [^→+]+$/.test(label) ? label.slice(0, label.indexOf(' → ')) : label);

export const sameAnswer = (ranked: string, step: string): boolean => ranked === step || pivotMove(ranked) === step;

/** The cell's win percent as the card prints it ("49%"); null for a floor or a best row. */
export type WorstLookup = (side: Side, row: Pick<EvalLine, 'label' | 'choice'>) => { label: string; basis: ReplyBasis; cell: string | null } | null;

/** Matches the row by label, choice string, then the pair rows of its move; null for a row the result lacks. */
export function worstLookup(result: EvalResult, fainted?: Partial<Record<Side, number | null | undefined>>): WorstLookup {
  return (side, line) => {
    // a line's label may be the bare move of a pivot whose rows are pairs: the best ranked pair stands for it
    const row = result.perSide[side].find(entry => entry.label === line.label) ?? result.perSide[side].find(entry => entry.choice === line.choice)
      ?? result.perSide[side].find(entry => pivotMove(entry.label) === line.label);
    const found = row ? worstReply(result, side, row) : null;
    return found ? { label: found.reply.label, basis: found.basis, cell: found.value === null ? null : winPctText(found.value, fainted?.[side]) } : null;
  };
}

const keyOf = (line: EvalLine): string => `${line.side}|${line.label}|${line.for.join('+')}`;

/** On: a worst line takes the place of the usual line of its row and roles; a row without one keeps its usual line. */
export function linesForMode(lines: readonly EvalLine[], hardMode: boolean): EvalLine[] {
  const usual = lines.filter(line => !line.versus);
  if (!hardMode) return usual;
  const worst = new Map(lines.filter(line => line.versus === 'worst').map(line => [keyOf(line), line]));
  return usual.map(line => worst.get(keyOf(line)) ?? line);
}
