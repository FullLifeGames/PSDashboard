import { worstAnswer, type EvalLine, type EvalResult, type RankedChoice } from '@fulllifegames/eval-engine';

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

export interface WorstReply { reply: RankedChoice; basis: ReplyBasis }

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
  if (answer && found) return { reply: found, basis: answer.basis };
  const best = result.perSide[other].find(entry => entry.choice !== 'wait');
  return best ? { reply: best, basis: 'best' } : null;
}

/**
 * The answer a line's row meets in Hard mode, by side and the row the line belongs to (its label, then its choice string): the reply's
 * label and its basis; null for a row the result lacks.
 */
export function worstLookup(result: EvalResult): (side: Side, row: Pick<EvalLine, 'label' | 'choice'>) => { label: string; basis: ReplyBasis } | null {
  return (side, line) => {
    const row = result.perSide[side].find(entry => entry.label === line.label) ?? result.perSide[side].find(entry => entry.choice === line.choice);
    const found = row ? worstReply(result, side, row) : null;
    return found ? { label: found.reply.label, basis: found.basis } : null;
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
