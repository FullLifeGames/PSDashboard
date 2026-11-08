import { describe, expect, test } from 'vitest';
import { alignHistoryRows } from '../../../src/lib/branch-history';
import { keptHistorySlice } from '../../../src/lib/branch-build';
import { keptEntries } from '../../../src/lib/timeline';
import { variationBoardShares } from '../../../src/lib/variation-shares';
import { positionLabel } from '../../../src/lib/support-state';
import { turnDiceMarks } from '../../../src/lib/branch-dice-marks';
import { makeBranchSharePayload } from '../../../src/lib/branch-share';
import { playedFromHistory } from '../../../src/hooks/usePositionPicker';
import {
  entriesOfTurns, interludesAfter, isInterlude, settledEntryAfterTurns, turnEntryAt, turnEntryCount,
} from '../../../src/lib/variation-turns';
import { INTERLUDE_CASES } from '../fixtures/variation-interludes';

/**
 * Round 88 (T348, #84): a replacement on both sides is stored as an entry of kind `turn` with the `turnNumber` of the entry
 * before it. Every reader of a variation's history names the same turn for every entry, on the data of 1.1.0 and before
 * (no version bump: the rule reads the old entries by their turnNumber). The expectations are counted by hand in the fixture.
 */
describe.each(INTERLUDE_CASES)('every reader of a history with interludes on both sides, $name', ({
  history, startTurn, settledAt, playedAt, interludes, turns,
}) => {
  const tip = startTurn + turns;

  test('the history rows number the real turns and leave the interludes without a turn of their own', () => {
    const rows = alignHistoryRows(history, startTurn);
    expect(rows.map((row, index) => (interludes.includes(index) ? null : row.variationTurn))).toEqual(
      history.map((_, index) => (interludes.includes(index) ? null : expect.any(Number))),
    );
    const numbered = rows.map(row => row.variationTurn).filter((turn): turn is number => turn !== null);
    expect(numbered).toEqual(Array.from({ length: turns }, (_, index) => startTurn + index + 1));
    // the cell of a row names the position after its move, which the interludes that follow it settle
    for (const [turn, index] of Object.entries(settledAt)) {
      const row = rows.find(candidate => candidate.variationTurn === Number(turn));
      if (row) expect(row.settled.serializedPosition).toBe(`pos-${index}`);
    }
  });

  test('the graph names the board of the entry that settles each turn', () => {
    const shares = variationBoardShares(history, startTurn);
    expect(shares).toHaveLength(tip);
    for (let turn = startTurn + 1; turn <= tip; turn += 1) expect(shares[turn - 1]).toBeCloseTo(settledAt[turn] / 20);
  });

  test('the dock reads the move that plays each pointer turn, and none at the tip', () => {
    for (let turn = startTurn + 1; turn < tip; turn += 1) {
      const played = playedFromHistory(history, turn - startTurn);
      expect(played?.p1?.name).toBe(`M${playedAt[turn]}`);
    }
    expect(playedFromHistory(history, tip - startTurn)).toBeNull();
  });

  test('a branch from an inner turn keeps the replacements that settle the turns before it', () => {
    for (let turn = startTurn + 1; turn <= tip; turn += 1) {
      const keep = keptEntries({ startTurn, length: turns }, { turn, line: 'variation' });
      expect(keep).toBe(turn - startTurn);
      const kept = keptHistorySlice(history, keep);
      expect(kept.map(entry => entry.serializedPosition)).toEqual(
        history.slice(0, settledAt[turn] + 1).map(entry => entry.serializedPosition),
      );
    }
  });

  test('the position label and the turn count count the real turns', () => {
    const label = positionLabel({
      view: { turn: tip, line: 'variation', t0: false, viewingVariation: true, liveTip: true },
      variation: { startTurn, branching: true, history },
    });
    expect(label).toBe(`T${tip} in the variation from turn ${startTurn} (${turns} turns)`);
  });

  test('the dice of a turn that paused read through the interlude that finished it', () => {
    const marked = history.map((entry, index) => (index === interludes[0] ? { ...entry, diceMarks: { p1: [{ label: 'die' }], p2: [] } } : entry));
    expect(turnDiceMarks(marked, interludes[0] - 1)).toEqual({ p1: [{ label: 'die' }], p2: [] });
    expect(turnDiceMarks(marked, interludes[0])).toBeUndefined();
  });

  test('a saved branch and a share link keep every entry, with its side for a one-sided replacement', () => {
    const payload = makeBranchSharePayload({
      replay: { id: 'gen9vgc2025regg-2335527677', format: 'f', formatid: 'f', players: ['a', 'b'] } as never,
      branchTurn: startTurn, history, finalLog: '',
    });
    expect(payload.choices).toHaveLength(history.length);
    expect(payload.choices.map(choice => choice.turnNumber)).toEqual(history.map(entry => entry.turnNumber));
    expect(payload.choices.filter(choice => choice.forcedSide)).toHaveLength(history.filter(entry => entry.kind === 'forced').length);
  });
});

describe('the rule of variation-turns', () => {
  const entry = (turnNumber: number | undefined, kind?: 'turn' | 'forced') => ({ turnNumber, kind });

  test('an entry with the number of the entry before it, or of kind forced, is an interlude', () => {
    const history = [entry(2), entry(2, 'turn'), entry(3), entry(3, 'forced'), entry(3), entry(4)];
    expect(history.map((_, index) => isInterlude(history, index))).toEqual([false, true, false, true, true, false]);
    expect(turnEntryCount(history)).toBe(3);
  });

  test('the first entry is a turn whatever its kind says about the entry before it, and entries without numbers are turns', () => {
    expect(isInterlude([entry(5)], 0)).toBe(false);
    expect(isInterlude([entry(undefined), entry(undefined)], 1)).toBe(false);
    expect(isInterlude([entry(5)], 3)).toBe(false);
    expect(turnEntryCount([])).toBe(0);
  });

  test('a turn-0 lead entry and the first turn are two turns', () => {
    const history = [entry(0), entry(1), entry(2)];
    expect(turnEntryCount(history)).toBe(3);
  });

  test('the helpers cut the history at turn boundaries', () => {
    const history = [entry(2), entry(3), entry(3), entry(4), entry(4, 'forced'), entry(5)];
    expect(turnEntryAt(history, 1)).toBe(history[1]);
    expect(turnEntryAt(history, 2)).toBe(history[3]);
    expect(turnEntryAt(history, 4)).toBeNull();
    expect(interludesAfter(history, 1)).toBe(1);
    expect(interludesAfter(history, 3)).toBe(1);
    expect(interludesAfter(history, 5)).toBe(0);
    expect(entriesOfTurns(history, 2)).toEqual(history.slice(0, 3));
    expect(entriesOfTurns(history, 0)).toEqual([]);
    expect(settledEntryAfterTurns(history, 3)).toBe(history[4]);
    expect(settledEntryAfterTurns(history, 5)).toBeNull();
    expect(settledEntryAfterTurns(history, 0)).toBeNull();
  });
});
