import { notationDice, type DiceReport, type DieReport, type DieWords } from '@fulllifegames/eval-engine';
import { foldHitReports } from './branch-dice';
import { isInterlude } from './variation-turns';

/**
 * Round 82 (forced dice), step A7c, decision 6a: what the history rows and the share links say about the dice the user forced in
 * a turn. A mark is the label of one die (`notationDice`, the words of the chips and the frame lines) and, for a die that took
 * no effect, the report's reason. Marks are sorted to the side that holds the die, and they live on the history entry, computed
 * when the turn plays (the entry has no battle to name the moves with later).
 */

export interface DieMark {
  label: string;
  /** Set when the die took no effect: the report's reason, empty when the report gave none. */
  noEffect?: string;
  /** Round 89: the hits that landed when the game cut a forced count short (a die that did something, not "no effect"). */
  played?: number;
}

export interface DiceMarks { p1: DieMark[]; p2: DieMark[] }

type Side = keyof DiceMarks;

/** The marks of a report: none for a turn without a forced die. */
export function diceMarksOf(report: DiceReport | undefined, words: DieWords): DiceMarks | undefined {
  if (!report || report.forced.length === 0) return undefined;
  const marks: DiceMarks = { p1: [], p2: [] };
  const folded = foldHitReports(report.forced);
  // a count says the first hit lands, so the first hit's own mark ("Triple Axel: hits") does not stand beside it (round 89, F5)
  const counted = (entry: DieReport) => entry.took === 'applied' && entry.die.name.kind === 'accuracy' && entry.die.name.hit === undefined && 'happens' in entry.die.result && entry.die.result.happens
    && folded.some(other => other.die.name.kind === 'hit-count' && other.die.name.slot === entry.die.name.slot && other.die.name.moveId === entry.die.name.moveId && (other.die.name.targetSlot === undefined || other.die.name.targetSlot === entry.die.name.targetSlot));
  for (const entry of folded.filter(held => !counted(held))) {
    const label = notationDice([entry.die], words)[0];
    marks[entry.die.name.slot.slice(0, 2) === 'p2' ? 'p2' : 'p1'].push(entry.took === 'applied' ? { label } : { label, noEffect: entry.reason ?? '', ...(entry.landed === undefined ? {} : { played: entry.landed }) });
  }
  return marks;
}

/** The text of a mark in a row or a link: the label, "(3 played)" for a count the game cut short after three hits, "(no effect)" for a die that took none. */
export const markText = (mark: DieMark): string =>
  mark.noEffect === undefined ? mark.label : `${mark.label} (${mark.played === undefined ? 'no effect' : `${mark.played} played`})`;

export const sideMarkTexts = (marks: DiceMarks | undefined, side: Side): string[] => (marks?.[side] ?? []).map(markText);

/**
 * The marks a turn's row shows. A turn that paused for a switch has the turn entry (a partial report: the dice it never reached
 * read as not drawn) and the forced entries that finish it (the last one holds the joined report), so the row reads the last
 * entry of the turn that has marks. An interlude (a replacement on one side or on both) has no row of its own for dice.
 */
export function turnDiceMarks(history: readonly { kind?: 'turn' | 'forced'; turnNumber?: number; diceMarks?: DiceMarks }[], index: number): DiceMarks | undefined {
  if (isInterlude(history, index)) return undefined;
  let marks = history[index]?.diceMarks;
  for (let next = index + 1; isInterlude(history, next); next += 1) marks = history[next].diceMarks ?? marks;
  return marks;
}
