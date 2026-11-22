import { describe, expect, test } from 'vitest';
import { lineHistory } from '../../../src/lib/line-history';
import { isInterlude, turnEntryCount } from '../../../src/lib/variation-turns';
import { bothRolesLine, doublesLine, singlesLine } from '../fixtures/lines';
import type { EvalLine } from '@fulllifegames/eval-engine';

/**
 * Round 89 (#104), step G3: a line as the history of a variation. The rebuild reads the slot choices (by identity) and the dice
 * that ride on them, the kind and the forced side of an interlude, and the turn numbers.
 */
describe('lineHistory', () => {
  test('a singles line becomes one turn entry per step, numbered from the start turn, the slot choices and their dice untouched', () => {
    const history = lineHistory(singlesLine, 20);
    expect(history.map(entry => [entry.turnNumber, entry.kind, entry.p1Choice, entry.p2Choice])).toEqual([
      [20, 'turn', 'Draining Kiss', 'Hydro Pump'],
      [21, 'turn', '→ Corviknight', 'Moonblast'],
      [22, 'turn', 'Brave Bird', 'Moonblast'],
    ]);
    singlesLine.steps.forEach((step, index) => {
      expect(history[index].p1SlotChoices).toEqual(step.p1.slots);
      expect(history[index].p2SlotChoices).toEqual(step.p2.slots);
    });
    // the dice are the line's: the accuracy and crit of Hydro Pump ride on p2's slot, the damage roll of the knock-out on p1's
    expect(history[0].p2SlotChoices?.[0]).toMatchObject({ dice: [{ name: { kind: 'accuracy' } }, { name: { kind: 'crit' } }] });
    expect(history[2].p1SlotChoices?.[0]).toMatchObject({ dice: [{ name: { kind: 'damage-roll' }, result: { step: 7 } }] });
    expect(turnEntryCount(history)).toBe(3);
  });

  test('a one-step line, whoever it is for, is one entry', () => {
    expect(lineHistory(bothRolesLine, 5)).toHaveLength(1);
  });

  test('a doubles line keeps both slots of both sides, and a replacement of one side is a forced entry that finishes its turn', () => {
    const history = lineHistory(doublesLine, 4);
    expect(history.map(entry => [entry.turnNumber, entry.kind, entry.forcedSide ?? null])).toEqual([
      [4, 'turn', null],
      [4, 'forced', 'p2'],
      [5, 'turn', null],
    ]);
    expect(history[0].p1SlotChoices).toHaveLength(2);
    expect(history[0].p2SlotChoices).toHaveLength(2);
    // the replacing side alone holds slot choices: the waiting side has no command
    expect(history[1].p2SlotChoices?.[0]).toMatchObject({ kind: 'switch', pokemonName: 'Zamazenta-Crowned' });
    expect(history[1].p1SlotChoices).toBeUndefined();
    expect(history[1].p1Choice).toBe('—');
    expect([0, 1, 2].map(index => isInterlude(history, index))).toEqual([false, true, false]);
    expect(turnEntryCount(history)).toBe(2);
  });

  test('a replacement of both sides is a turn entry that repeats the number before it, the way the simulator records it', () => {
    const both: EvalLine = {
      ...singlesLine,
      steps: [
        singlesLine.steps[0],
        { replacement: 'both', p1: { choice: 'switch 2', label: '→ Mew', slots: singlesLine.steps[1].p1.slots }, p2: { choice: 'switch 3', label: '→ Eevee', slots: singlesLine.steps[1].p2.slots }, dice: [] },
        singlesLine.steps[2],
      ],
    };
    const history = lineHistory(both, 10);
    expect(history.map(entry => [entry.turnNumber, entry.kind])).toEqual([[10, 'turn'], [10, 'turn'], [11, 'turn']]);
    expect([0, 1, 2].map(index => isInterlude(history, index))).toEqual([false, true, false]);
  });

  test('a line that opens with a replacement stands at the start turn, and the next turn follows it', () => {
    const open: EvalLine = { ...singlesLine, steps: [{ replacement: 'p1', p1: singlesLine.steps[1].p1, p2: { choice: 'wait', label: '(waiting)', slots: [null] }, dice: [] }, singlesLine.steps[0]] };
    const history = lineHistory(open, 7);
    expect(history.map(entry => [entry.turnNumber, entry.kind, entry.forcedSide ?? null])).toEqual([[7, 'forced', 'p1'], [8, 'turn', null]]);
  });
});
