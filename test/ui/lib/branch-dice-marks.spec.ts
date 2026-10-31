import { describe, expect, test } from 'vitest';
import { notationDice, type DiceReport, type DieReport, type DieWords, type ForcedDie } from '@fulllifegames/eval-engine';
import { diceMarksOf, markText, sideMarkTexts, turnDiceMarks } from '../../../src/lib/branch-dice-marks';

/**
 * Round 82 (forced dice), step A7c, decision 6a: what the history rows and the share links say about a turn's forced dice. The
 * labels come from `notationDice` (the chips' and the frame lines' words), each die sorted to the side that holds it, and a die
 * that took no effect says so. A turn that paused for a switch has two entries; the row reads the joined report once.
 */

const words: DieWords = { move: id => `Move ${id}`, effect: id => `Effect ${id}`, slot: slot => `Body ${slot}` };
const die = (slot: string, kind: 'accuracy' | 'secondary', happens: boolean): ForcedDie =>
  ({ name: { slot, moveId: 'airslash', targetSlot: slot[1] === '1' ? 'p2a' : 'p1a', kind, ...(kind === 'secondary' ? { effectId: 'flinch' } : {}) }, result: { happens } });
const report = (...entries: DieReport[]): DiceReport => ({ forced: entries, naturalEndSeed: '1,2,3,4' });
const applied = (forced: ForcedDie): DieReport => ({ die: forced, took: 'applied', chance: 0.3 });
const noDraw = (forced: ForcedDie, reason: string): DieReport => ({ die: forced, took: 'no-draw', reason });

describe('the marks of a turn', () => {
  test('each die gets the label of notationDice, under the side that holds it', () => {
    const flinch = die('p1a', 'secondary', true);
    const miss = die('p2b', 'accuracy', false);
    const marks = diceMarksOf(report(applied(flinch), applied(miss)), words)!;
    expect(marks.p1).toEqual([{ label: notationDice([flinch], words)[0] }]);
    expect(marks.p2).toEqual([{ label: notationDice([miss], words)[0] }]);
  });

  test('a die that took no effect carries the report reason, and its text says so', () => {
    const flinch = die('p1a', 'secondary', true);
    const marks = diceMarksOf(report(noDraw(flinch, 'Air Slash did not run')), words)!;
    expect(marks.p1[0]).toEqual({ label: 'Move airslash: Effect flinch', noEffect: 'Air Slash did not run' });
    expect(markText(marks.p1[0])).toBe('Move airslash: Effect flinch (no effect)');
    expect(markText({ label: 'Move airslash: Effect flinch' })).toBe('Move airslash: Effect flinch');
    expect(sideMarkTexts(marks, 'p1')).toEqual(['Move airslash: Effect flinch (no effect)']);
    expect(sideMarkTexts(marks, 'p2')).toEqual([]);
  });

  test('a die that decided nothing without a reason still says no effect', () => {
    const flinch = die('p1a', 'secondary', true);
    const marks = diceMarksOf(report({ die: flinch, took: 'no-chance' }), words)!;
    expect(marks.p1[0].noEffect).toBe('');
    expect(markText(marks.p1[0])).toMatch(/\(no effect\)$/);
  });

  test('a report without forced dice gives no marks', () => {
    expect(diceMarksOf(report(), words)).toBeUndefined();
    expect(diceMarksOf(undefined, words)).toBeUndefined();
  });
});

describe('the marks of a turn that paused for a switch', () => {
  const flinch = die('p2a', 'secondary', true);
  const partial = diceMarksOf(report(noDraw(flinch, 'not reached')), words)!;
  const joined = diceMarksOf(report(applied(flinch)), words)!;
  const turn = { diceMarks: partial };
  const forced = { kind: 'forced' as const, diceMarks: joined };

  test('the row reads the forced entry that follows and skips the partial report of the turn entry', () => {
    expect(turnDiceMarks([turn, forced], 0)).toBe(joined);
  });

  test('a forced entry without dice of its own leaves the turn entry its marks', () => {
    expect(turnDiceMarks([turn, { kind: 'forced' as const }], 0)).toBe(partial);
  });

  test('a turn stops at the next turn: a later forced entry belongs to its own row', () => {
    expect(turnDiceMarks([turn, {}, forced], 0)).toBe(partial);
    expect(turnDiceMarks([turn, {}, forced], 1)).toBe(joined);
  });

  test('a forced entry has no row of its own for the dice', () => {
    expect(turnDiceMarks([turn, forced], 1)).toBeUndefined();
  });
});
