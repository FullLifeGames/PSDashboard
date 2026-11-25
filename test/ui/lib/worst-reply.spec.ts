import { describe, expect, test } from 'vitest';
import type { EvalLine, EvalMatrix, EvalResult, MatrixCell, RankedChoice } from '@fulllifegames/eval-engine';
import { winPctText } from '@fulllifegames/eval-engine';
import { linesForMode, worstLookup, worstReply } from '../../../src/lib/worst-reply';

const ranked = (choice: string, label: string, punishedBy: string | null = null): RankedChoice => ({ choice, label, worstCase: 0, expected: 0, ev: 0, punishedBy });
const solid: MatrixCell = { visits: 20, verified: false };
const thin: MatrixCell = { visits: 2, verified: false };

function result(p1: string[], p2: string[], values: number[][], cells?: MatrixCell[][], punished: [string | null, string | null] = [null, null]): EvalResult {
  const matrix: EvalMatrix = {
    p1Labels: p1, p2Labels: p2, p1Choices: p1.map(label => `move ${label}`), p2Choices: p2.map(label => `move ${label}`),
    values, mixes: { p1: [], p2: [] }, ...(cells ? { cells } : {}),
  };
  return {
    score: 0, interval: 0, depthCompleted: 1, matrix,
    perSide: { p1: p1.map(label => ranked(`move ${label}`, label, punished[0])), p2: p2.map(label => ranked(`move ${label}`, label, punished[1])) },
  };
}

describe('worstReply', () => {
  const single = result(['Surf', 'Ice Beam'], ['Draining Kiss', 'Moonblast', 'Mew'], [[0.2, -0.4, 0.1], [0.5, 0.3, -0.1]], [[solid, solid, solid], [solid, solid, solid]]);

  test('singles: the reply is the opponent\'s ranked row of the lowest trusted cell, for either side', () => {
    expect(worstReply(single, 'p1', single.perSide.p1[0])).toMatchObject({ reply: single.perSide.p2[1], basis: 'cell' });
    expect(worstReply(single, 'p2', single.perSide.p2[2])).toMatchObject({ reply: single.perSide.p1[0], basis: 'cell' });
  });

  test('the reply carries the value of its cell from the row\'s own side (wp-units): p1 reads the cell, p2 its negative', () => {
    expect(worstReply(single, 'p1', single.perSide.p1[0])?.value).toBeCloseTo(-0.4);
    // p2's Mew row: its column holds 0.1 and -0.1 in p1's view, so p1's Surf (0.1) is the lowest for p2 at -0.1
    expect(worstReply(single, 'p2', single.perSide.p2[2])?.value).toBeCloseTo(-0.1);
  });

  test('a floor or a best-row reply has no cell value', () => {
    const none = result(['Surf'], ['Draining Kiss', 'Moonblast'], [[0.2, -0.4]], [[thin, thin]], ['Draining Kiss', null]);
    expect(worstReply(none, 'p1', none.perSide.p1[0])?.value).toBeNull();
    const bare = result(['Surf'], ['Draining Kiss', 'Moonblast'], [[0.2, -0.4]], [[thin, thin]]);
    expect(worstReply(bare, 'p1', bare.perSide.p1[0])?.value).toBeNull();
  });

  test('an untrusted lower cell is skipped and a matrix pass counts every cell', () => {
    const guess = result(['Surf'], ['Draining Kiss', 'Moonblast', 'Mew'], [[0.2, -0.4, 0.1]], [[solid, thin, solid]]);
    expect(worstReply(guess, 'p1', guess.perSide.p1[0])?.reply.label).toBe('Mew');
    const pass = result(['Surf'], ['Draining Kiss', 'Moonblast', 'Mew'], [[0.2, -0.4, 0.1]]);
    expect(worstReply(pass, 'p1', pass.perSide.p1[0])?.reply.label).toBe('Moonblast');
  });

  test('the row is found by its choice string in the result, not by the object that was clicked', () => {
    const clicked = ranked('move Surf', 'Surf', null);
    expect(worstReply(single, 'p1', clicked)?.reply.label).toBe('Moonblast');
  });

  test('no trusted cell: the row\'s own floor, marked; no floor: the opponent\'s best row, marked', () => {
    const none = result(['Surf'], ['Draining Kiss', 'Moonblast'], [[0.2, -0.4]], [[thin, thin]], ['Draining Kiss', null]);
    expect(worstReply(none, 'p1', none.perSide.p1[0])).toMatchObject({ reply: none.perSide.p2[0], basis: 'punisher' });
    const bare = result(['Surf'], ['Draining Kiss', 'Moonblast'], [[0.2, -0.4]], [[thin, thin]]);
    expect(worstReply(bare, 'p1', bare.perSide.p1[0])).toMatchObject({ reply: bare.perSide.p2[0], basis: 'best' });
  });

  test('a side that only waits has no reply', () => {
    const waits = result(['switch 2'], ['wait'], [[0]], [[solid]]);
    waits.perSide.p2 = [ranked('wait', 'wait')];
    waits.matrix!.p2Choices = ['wait'];
    expect(worstReply(waits, 'p1', waits.perSide.p1[0])).toBeNull();
  });

  test('doubles: the joint answer is one ranked row, with its joint choice string', () => {
    const p1 = ['Fake Out + Spore', 'Flare Blitz + Spore'];
    const p2 = ['Close Combat + Protect', 'Sucker Punch + Spore'];
    const doubles = result(p1, p2, [[0.3, -0.2], [0.1, 0.0]], [[solid, solid], [solid, solid]]);
    expect(worstReply(doubles, 'p1', doubles.perSide.p1[0])?.reply).toEqual(doubles.perSide.p2[1]);
    expect(worstReply(doubles, 'p2', doubles.perSide.p2[1])?.reply).toEqual(doubles.perSide.p1[1]);
  });
});

describe('worstLookup', () => {
  test('answers by side and the row of a line (its label, then its choice string), for the lines', () => {
    const doubles = result(['A + B', 'C + D'], ['E + F', 'G + H'], [[0.3, -0.2], [0.1, 0.0]], [[solid, solid], [solid, solid]]);
    const lookup = worstLookup(doubles);
    expect(lookup('p1', { label: 'A + B', choice: 'x' })).toEqual({ label: 'G + H', basis: 'cell', cell: expect.stringMatching(/^\d+%$/) });
    expect(lookup('p2', { label: 'nope', choice: 'move G + H' })?.label).toBe('C + D');
    expect(lookup('p1', { label: 'nothing', choice: 'move nothing' })).toBeNull();
  });

  test('the cell reads as the card prints it: the row side\'s win percent of the lowest cell, with the side\'s fainted share; none for a floor', () => {
    const one = result(['Surf'], ['Draining Kiss', 'Moonblast'], [[0.2, -0.4]], [[solid, solid]]);
    const plain = worstLookup(one)('p1', { label: 'Surf', choice: 'move Surf' });
    expect(plain?.cell).toBe(winPctText(-0.4));
    expect(worstLookup(one, { p1: 0.5 })('p1', { label: 'Surf', choice: 'move Surf' })?.cell).toBe(winPctText(-0.4, 0.5));
    // p2's view: the negative of the p1 value of the one cell in the Moonblast column's row
    expect(worstLookup(one)('p2', { label: 'Moonblast', choice: 'move Moonblast' })?.cell).toBe(winPctText(0.4));
    const thinOnly = result(['Surf'], ['Draining Kiss', 'Moonblast'], [[0.2, -0.4]], [[thin, thin]], ['Draining Kiss', null]);
    expect(worstLookup(thinOnly)('p1', { label: 'Surf', choice: 'move Surf' })).toEqual({ label: 'Draining Kiss', basis: 'punisher', cell: null });
  });
});

describe('worstLookup with a pivot\'s pair rows (singles)', () => {
  const pairs = result(['Pursuit', 'Knock Off'], ['U-turn → Tyranitar', 'U-turn → Keldeo', '→ Excadrill'], [[0.1, -0.3, 0.2], [0.3, 0.2, 0.1]], [[solid, solid, solid], [solid, solid, solid]]);
  const lookup = worstLookup(pairs);

  test('a line whose label is the bare move finds its pair rows; the reply is the answer of the best ranked pair', () => {
    expect(lookup('p2', { label: 'U-turn', choice: 'move uturn' })).toMatchObject({ label: 'Knock Off', basis: 'cell' });
  });

  test('a row of the other side still answers with the pair that hurts it most', () => {
    expect(lookup('p1', { label: 'Pursuit', choice: 'move Pursuit' })).toMatchObject({ label: 'U-turn → Keldeo', basis: 'cell' });
  });

  test('a doubles joint choice with a switch part is no pair row', () => {
    const doubles = result(['Protect + → Basculegion', 'A + B'], ['E + F', 'G + H'], [[0.3, -0.2], [0.1, 0.0]], [[solid, solid], [solid, solid]]);
    expect(worstLookup(doubles)('p1', { label: 'Protect', choice: 'x' })).toBeNull();
  });
});

describe('linesForMode', () => {
  const step = { p1: { choice: 'x', label: 'Surf', slots: [] }, p2: { choice: 'y', label: 'Moonblast', slots: [] }, dice: [] };
  const line = (label: string, forRoles: EvalLine['for'], versus?: 'worst'): EvalLine => ({
    side: 'p1', label, choice: `move ${label}`, for: forRoles, steps: [step], end: 0, endFainted: 0, visits: 5, ...(versus ? { versus } : {}),
  });
  const usual = [line('Surf', ['engine']), line('Ice Beam', ['played'])];
  const lines = [...usual, line('Surf', ['engine'], 'worst')];

  test('off: the worst lines are dropped, so the section reads as before', () => {
    expect(linesForMode(lines, false)).toEqual(usual);
  });

  test('on: a worst line takes the place of the usual line of its row and roles; a row without one keeps its usual line', () => {
    expect(linesForMode(lines, true)).toEqual([lines[2], usual[1]]);
  });

  test('on with no worst line at all: the usual lines', () => {
    expect(linesForMode(usual, true)).toEqual(usual);
  });
});
