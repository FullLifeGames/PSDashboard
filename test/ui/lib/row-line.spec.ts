import { describe, expect, test } from 'vitest';
import { formatLine, type EvalLine, type LineChoice, type LineStep } from '@fulllifegames/eval-engine';
import { rowLineTail } from '../../../src/lib/row-line';
import { evalResult, rankedChoice } from '../fixtures/eval-result';

/**
 * Round 89 (LN-4, F1 of LN-3): one card shows one line per row. The ranked row's "then ..." reads the later steps of the line the Lines
 * section shows for the row, not the engine's principal variation, which is read from another tree by another rule.
 */
const pick = (label: string, slots = 1): LineChoice => ({ choice: label.toLowerCase(), label, slots: Array.from({ length: slots }, () => null) });
const waiting = (slots = 1): LineChoice => ({ choice: 'wait', label: '(waiting)', slots: Array.from({ length: slots }, () => null) });
const step = (p1: string, p2: string, extra: Partial<LineStep> = {}): LineStep => ({ p1: pick(p1), p2: pick(p2), dice: [], ...extra });
const lineOf = (side: 'p1' | 'p2', label: string, steps: LineStep[], extra: Partial<EvalLine> = {}): EvalLine =>
  ({ side, label, choice: label.toLowerCase(), for: ['engine'], steps, end: 0.1, endFainted: 0.1, visits: 100, ...extra });

describe('rowLineTail', () => {
  // the 655336 turn 24 shape: the engine's PV reads Roost / High Jump Kick at the third turn, the line (by value) Roost / Encore
  const pv = [{ p1: 'Roost', p2: 'Encore' }, { p1: 'Roost', p2: 'High Jump Kick' }];
  const row = rankedChoice('move dragondance', 'Dragon Dance', 0.234, { line: pv });
  const usual = lineOf('p1', 'Dragon Dance', [step('Dragon Dance', 'High Jump Kick'), step('Roost', 'Encore'), step('Roost', 'Encore')]);

  test('singles: the row reads the later steps of its line, not the principal variation', () => {
    const result = evalResult('singles', { lines: [usual] });
    const tail = rowLineTail(result, 'p1', row, false);
    expect(tail && formatLine(tail)).toBe('Roost · Encore → Roost · Encore');
  });

  test('doubles: combined labels, a replacement step reads as the side that sends a body in', () => {
    const label = 'Fake Out → Rillaboom + Spore → Tornadus';
    const best = rankedChoice('move fakeout 1, move spore 2', label, 0.3, { line: [{ p1: 'Protect + Protect', p2: 'Tailwind + Protect' }] });
    const line = lineOf('p1', label, [
      step(label, 'Tailwind + Grassy Glide → Incineroar'),
      { p1: waiting(2), p2: pick('pass + → Zamazenta', 2), replacement: 'p2', dice: [] },
      step('Flare Blitz → Rillaboom + Rage Powder', 'Taunt → Amoonguss + Wood Hammer → Incineroar'),
    ]);
    const tail = rowLineTail(evalResult('doubles', { lines: [line] }), 'p1', best, false);
    expect(tail && formatLine(tail)).toBe('→ Zamazenta → Flare Blitz → Rillaboom + Rage Powder · Taunt → Amoonguss + Wood Hammer → Incineroar');
  });

  test('a pivot row (the move and the body it brings in) skips the line\'s replacement step: the label shows it already', () => {
    const pair = rankedChoice('move uturn 1', 'U-turn → Keldeo', 0.3, { line: [{ p1: 'Hydro Pump', p2: 'Protect' }] });
    const line = lineOf('p1', 'U-turn', [
      step('U-turn', 'Protect'), { p1: pick('→ Keldeo'), p2: waiting(), replacement: 'p1', dice: [] }, step('Hydro Pump', 'Scald'),
    ]);
    const tail = rowLineTail(evalResult('singles', { lines: [line] }), 'p1', pair, false);
    expect(tail && formatLine(tail)).toBe('Hydro Pump · Scald');
  });

  test('Hard mode: the worst line of the row, as the Lines section shows it', () => {
    const worst = lineOf('p1', 'Dragon Dance', [step('Dragon Dance', 'Fake Out'), step('Dragon Claw', 'Protect')], { versus: 'worst' });
    const result = evalResult('singles', { lines: [usual, worst] });
    expect(formatLine(rowLineTail(result, 'p1', row, true)!)).toBe('Dragon Claw · Protect');
    expect(formatLine(rowLineTail(result, 'p1', row, false)!)).toBe('Roost · Encore → Roost · Encore');
  });

  test('a result without lines (a matrix result, an old stored result): the principal variation as before', () => {
    expect(rowLineTail(evalResult('singles'), 'p1', row, false)).toEqual(pv);
    expect(rowLineTail(null, 'p1', row, false)).toEqual(pv);
  });

  test('lines present but none for the row, or only the first step: no tail', () => {
    const other = lineOf('p1', 'Roost', [step('Roost', 'Encore'), step('Roost', 'Encore')]);
    expect(rowLineTail(evalResult('singles', { lines: [other] }), 'p1', row, false)).toEqual([]);
    expect(rowLineTail(evalResult('singles', { lines: [lineOf('p1', 'Dragon Dance', [step('Dragon Dance', 'Encore')])] }), 'p1', row, false)).toEqual([]);
    // the other side's line of the same label is not this row's
    expect(rowLineTail(evalResult('singles', { lines: [{ ...usual, side: 'p2' }] }), 'p1', row, false)).toEqual([]);
  });

  test('a row that shows no tail today shows none now', () => {
    const quiet = rankedChoice('move roost', 'Roost', 0.2);
    expect(rowLineTail(evalResult('singles', { lines: [lineOf('p1', 'Roost', [step('Roost', 'Encore'), step('Roost', 'Encore')])] }), 'p1', quiet, false)).toBeUndefined();
  });
});
