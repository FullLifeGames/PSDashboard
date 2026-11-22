import { winPctText, worstAnswer, type EvalLine, type EvalResult, type RankedChoice } from '@fulllifegames/eval-engine';

/**
 * Round 89 (#153, "Hard mode"): the one rule of the reply that hurts a move most, which the click walk, the turn dock and the lines
 * read. The cell is the engine's `worstAnswer` (the lowest value of the move's row among the cells the result trusts: verified, or the
 * visits the hindsight read asks for, every cell for a result without cell statistics); this module adds the opponent's ranked row of
 * that answer, which the pickers map slot by slot, and the two fallbacks.
 */

type Side = 'p1' | 'p2';

/**
 * What stands behind a reply: `cell` the lowest trusted cell of the move's row, `punisher` the row's own floor when no cell of the row
 * is trusted (a thinly searched cell), `best` the opponent's best row when the result names no floor at all.
 */
export type ReplyBasis = 'cell' | 'punisher' | 'best';

/** `value` is the lowest cell's value from the row's own side (wp-units), the number the line's bracket prints; null for a floor or a best row. */
export interface WorstReply { reply: RankedChoice; basis: ReplyBasis; value: number | null }

/**
 * The opponent's reply to `row` of `side` in `result`: the worst answer by the rule above, else the row's floor, else the opponent's
 * best row; null when the opponent has nothing to play (a side that waits). The row is found in the result by its choice string, so a
 * clicked object from a card or a matrix cell reads the result's own floor.
 */
export function worstReply(result: EvalResult, side: Side, row: Pick<RankedChoice, 'choice' | 'label' | 'punishedBy'>): WorstReply | null {
  const own = result.perSide[side].find(entry => entry.choice === row.choice) ?? row;
  const other: Side = side === 'p1' ? 'p2' : 'p1';
  const answer = worstAnswer(result, side, own);
  const found = answer ? result.perSide[other].find(entry => entry.choice === answer.choice) : undefined;
  if (answer && found) return { reply: found, basis: answer.basis, value: answer.basis === 'cell' ? cellValue(result, side, own.choice, found.choice) : null };
  const best = result.perSide[other].find(entry => entry.choice !== 'wait');
  return best ? { reply: best, basis: 'best', value: null } : null;
}

/**
 * Round 89 (HM2c): the value the card's matrix holds for the pair of a row and a reply, from the row's own side (p1 reads the cell,
 * p2 its negative); null where the matrix has no such pair. Reads `result.matrix` only.
 */
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

/**
 * Round 89 (G16): a pivot's rows in the card's matrix are pairs, the move and the body it brings in ("U-turn → Keldeo"), where a line's
 * step names the move alone ("U-turn": the follow-up is a step of its own). The move of a pair row; any other label unchanged. Only a
 * label with one arrow between two names counts (after a gimmick segment at most: "Mega + U-turn → Keldeo"), so a switch ("→ Keldeo") and a doubles joint choice ("Protect + → Rillaboom")
 * are never cut.
 */
export const pivotMove = (label: string): string => (/^((Tera|Mega|Ultra) \+ )?[^→+]+ → [^→+]+$/.test(label) ? label.slice(0, label.indexOf(' → ')) : label);

/** Whether a ranked label and a line's step label name the same answer: equal, or the step is the bare move of the ranked pivot pair. */
export const sameAnswer = (ranked: string, step: string): boolean => ranked === step || pivotMove(ranked) === step;

/** What a line's view reads of the reply that hurts its row: the reply, what it stands on, and the cell's win percent as the card prints it ("49%"; null for a floor or a best row). */
export type WorstLookup = (side: Side, row: Pick<EvalLine, 'label' | 'choice'>) => { label: string; basis: ReplyBasis; cell: string | null } | null;

/**
 * The answer a line's row meets in Hard mode, by side and the row the line belongs to (its label, its choice string, then the pair rows of its move): the reply's
 * label, its basis and the cell's percent (`fainted` is each side's fainted share, as the card prints its rows); null for a row the result lacks.
 */
export function worstLookup(result: EvalResult, fainted?: Partial<Record<Side, number | null | undefined>>): WorstLookup {
  return (side, line) => {
    // a line's label may be the bare move of a pivot whose rows are pairs: the best ranked pair stands for it (the line's follow-up is the greedy one)
    const row = result.perSide[side].find(entry => entry.label === line.label) ?? result.perSide[side].find(entry => entry.choice === line.choice)
      ?? result.perSide[side].find(entry => pivotMove(entry.label) === line.label);
    const found = row ? worstReply(result, side, row) : null;
    return found ? { label: found.reply.label, basis: found.basis, cell: found.value === null ? null : winPctText(found.value, fainted?.[side]) } : null;
  };
}

const keyOf = (line: EvalLine): string => `${line.side}|${line.label}|${line.for.join('+')}`;

/**
 * The lines a turn shows. Off: the usual lines, the worst lines left out. On: a worst line takes the place of the usual line of its row
 * and roles; a row without one keeps its usual line (the section says so). Order stays the usual lines'.
 */
export function linesForMode(lines: readonly EvalLine[], hardMode: boolean): EvalLine[] {
  const usual = lines.filter(line => !line.versus);
  if (!hardMode) return usual;
  const worst = new Map(lines.filter(line => line.versus === 'worst').map(line => [keyOf(line), line]));
  return usual.map(line => worst.get(keyOf(line)) ?? line);
}
