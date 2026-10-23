import { test, expect, describe } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';

/**
 * Round 76 (T264): the report keeps its four biggest key moments and adds
 * every dice turn that qualifies (score at least 0.25, not quiet, not a
 * resolution turn) whose chance went against the winner. 573756 t73: a 95 %
 * Fire Fang missed, the turn ranked eighth of eight and the luck that turned
 * the game was not on the list. The report is game-type blind, so the doubles
 * rows repeat the singles rows with the pair sides of a doubles analysis.
 */

const names: [string, string] = ['Alpha', 'Beta'];

const single = (): SideAnalysis => ({ playedRaw: null, played: null, best: null, safe: null, regret: 0 });
const doublesSide = (): SideAnalysis => ({
  ...single(), playedSlots: [{ kind: 'move', name: 'Heat Wave', targetLoc: null }, { kind: 'move', name: 'Protect', targetLoc: null }],
});

type Kind = 'singles' | 'doubles';
const kinds: Kind[] = ['singles', 'doubles'];

/** A decision turn of swing `size` toward the p2 winner (p1 score falls): no chance booked, so no resolution turn. */
const decision = (kind: Kind, turn: number, size: number): TurnAnalysis => {
  const side = kind === 'singles' ? single : doublesSide;
  return {
    turn, scoreBefore: 0.9, scoreAfter: 0.9 - size, swing: -size, playedOutcome: null, decisionDelta: -size,
    chanceDelta: null, attribution: 'p2-decision', p1: side(), p2: side(),
  };
};

/** A chance turn: `chance` > 0 favors p1 (against the p2 winner), < 0 favors p2. */
const dice = (kind: Kind, turn: number, chance: number, over: Partial<TurnAnalysis> = {}): TurnAnalysis => {
  const side = kind === 'singles' ? single : doublesSide;
  return {
    turn, scoreBefore: 0.9, scoreAfter: 0.9 + chance, swing: chance, playedOutcome: null, decisionDelta: 0,
    chanceDelta: chance, attribution: 'chance', p1: side(), p2: side(), ...over,
  };
};

/** Four decision turns at 0.6 to 0.45 fill the cap; a fifth, smaller decision turn is rank 5. */
const pool = (kind: Kind, extra: TurnAnalysis[]): TurnAnalysis[] => [
  decision(kind, 1, 0.6), decision(kind, 2, 0.55), decision(kind, 3, 0.5), decision(kind, 4, 0.45),
  ...extra,
];

const turnsOf = (analyses: TurnAnalysis[], diceTurns: ReadonlySet<number> | null, winner: 'p1' | 'p2' | null = 'p2') =>
  buildGameReport(analyses, names, winner, true, diceTurns).keyMoments.map(moment => moment.turn);

describe.each(kinds)('T264 key moments, %s', kind => {
  test('a dice turn at rank 6 whose chance went against the winner joins, in turn order', () => {
    const analyses = pool(kind, [decision(kind, 5, 0.3), dice(kind, 6, 0.27)]);
    expect(turnsOf(analyses, new Set([6]))).toEqual([1, 2, 3, 4, 6]);
  });

  test('a non-dice turn at rank 5 does not join', () => {
    const analyses = pool(kind, [decision(kind, 5, 0.3), dice(kind, 6, 0.27)]);
    expect(turnsOf(analyses, new Set())).toEqual([1, 2, 3, 4]);
  });

  test('a dice turn whose chance went toward the winner does not join', () => {
    // Early in the game, so the favor boundary leaves it a genuine roll and not a resolution turn.
    const analyses = [dice(kind, 1, -0.27), ...pool(kind, []).map(entry => ({ ...entry, turn: entry.turn + 1 }))];
    expect(turnsOf(analyses, new Set([1]))).toEqual([2, 3, 4, 5]);
  });

  test('a dice turn under the key-moment threshold does not join', () => {
    expect(turnsOf(pool(kind, [dice(kind, 5, 0.2)]), new Set([5]))).toEqual([1, 2, 3, 4]);
  });

  test('a quiet dice turn does not join', () => {
    expect(turnsOf(pool(kind, [dice(kind, 5, 0.3, { attribution: 'quiet' })]), new Set([5]))).toEqual([1, 2, 3, 4]);
  });

  test('a dice turn already in the top four is listed once', () => {
    const analyses = [dice(kind, 1, 0.7), ...pool(kind, []).map(entry => ({ ...entry, turn: entry.turn + 1 }))];
    expect(turnsOf(analyses, new Set([1]))).toEqual([1, 2, 3, 4]);
  });

  test('without dice info or without a winner nothing joins', () => {
    const analyses = pool(kind, [dice(kind, 5, 0.27)]);
    expect(turnsOf(analyses, null)).toEqual([1, 2, 3, 4]);
    expect(turnsOf(analyses, new Set([5]), null)).toEqual([1, 2, 3, 4]);
  });

  test('the turn\'s own rolls decide when the report carries them', () => {
    const rolled = pool(kind, [dice(kind, 5, 0.27, { rolledFor: { p1: true, p2: false } })]);
    const reRead = pool(kind, [dice(kind, 5, 0.27, { rolledFor: { p1: false, p2: false } })]);
    expect(turnsOf(rolled, new Set())).toEqual([1, 2, 3, 4, 5]);
    expect(turnsOf(reRead, new Set([5]))).toEqual([1, 2, 3, 4]);
  });

  test('a winner of p1 mirrors the rule', () => {
    const mirrored = (entry: TurnAnalysis): TurnAnalysis => ({
      ...entry, scoreBefore: -entry.scoreBefore, scoreAfter: entry.scoreAfter === null ? null : -entry.scoreAfter,
      swing: entry.swing === null ? null : -entry.swing, chanceDelta: entry.chanceDelta === null ? null : -entry.chanceDelta,
    });
    const analyses = pool(kind, [decision(kind, 5, 0.3), dice(kind, 6, 0.27)]).map(mirrored);
    expect(turnsOf(analyses, new Set([6]), 'p1')).toEqual([1, 2, 3, 4, 6]);
  });
});
