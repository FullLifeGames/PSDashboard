import { test, expect } from '@playwright/test';
import { analyzeTurn, matchPlayedChoice, REGRET_THRESHOLD } from '../src/lib/eval/analysis';
import type { EvalResult, RankedChoice } from '../src/lib/eval/types';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, punishedBy: 'Reply' });

const result: EvalResult = {
  score: 0.1,
  interval: 0.05,
  depthCompleted: 2,
  perSide: {
    p1: [
      choice('move dracometeor', 'Draco Meteor', 0.2),
      choice('move uturn', 'U-turn', 0.05),
      choice('switch 2', '→ Corviknight', -0.1),
    ],
    p2: [
      choice('switch 3', '→ Dragapult', -0.05),
      choice('move recover', 'Recover', -0.3),
      choice('move freezedry terastallize', 'Tera + Freeze-Dry', -0.4),
    ],
  },
};

test.describe('turn analysis assembly', () => {
  test('matches moves, tera variants, and switches (nickname or species)', () => {
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Draco Meteor', tera: false })?.choice).toBe('move dracometeor');
    expect(matchPlayedChoice(result, 'p2', { kind: 'move', name: 'Freeze-Dry', tera: true })?.choice).toBe('move freezedry terastallize');
    expect(matchPlayedChoice(result, 'p2', { kind: 'switch', name: 'Draggy', species: 'Dragapult' })?.label).toBe('→ Dragapult');
    expect(matchPlayedChoice(result, 'p1', { kind: 'move', name: 'Unknown Move', tera: false })).toBeNull();
  });

  test('a side that played a clearly worse option gets the decision blame', () => {
    const analysis = analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: -0.2,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    });
    expect(analysis.p1.regret).toBe(0);
    expect(analysis.p2.regret).toBeCloseTo(0.25, 10);
    expect(analysis.attribution).toBe('p2-decision');
    expect(analysis.decisionDelta).toBeCloseTo(-0.3, 10);
    expect(analysis.chanceDelta).toBeCloseTo(-0.05, 10);
    expect(analysis.swing).toBeCloseTo(-0.35, 10);
  });

  test('best moves on both sides with a big residual is a chance swing', () => {
    const analysis = analyzeTurn({
      turn: 8,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.15,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
    });
    expect(analysis.attribution).toBe('chance');
    expect(analysis.chanceDelta).toBeCloseTo(-0.55, 10);
  });

  test('a big swing with no culprit is a shift, not a quiet turn', () => {
    // Both sides played the engine's move, and neither the decision part
    // (+0.11) nor the chance part (+0.14) crosses its own threshold — but
    // the total swing (+0.25) is anything but quiet.
    const analysis = analyzeTurn({
      turn: 19,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.21,
      scoreBefore: 0.1,
      scoreAfter: 0.35,
    });
    expect(analysis.attribution).toBe('shift');
    expect(analysis.decisionDelta).toBeCloseTo(0.11, 10);
    expect(analysis.chanceDelta).toBeCloseTo(0.14, 10);
  });

  test('without played tracking (doubles) only shift/quiet are possible', () => {
    const big = analyzeTurn({
      turn: 5,
      result,
      played: null,
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
      playedTracking: false,
    });
    expect(big.attribution).toBe('shift'); // never 'unclear' — nothing was mis-parsed
    expect(big.playedTracking).toBe(false);
    expect(big.p1.best?.choice).toBe('move dracometeor'); // engine lines still there

    const small = analyzeTurn({
      turn: 6,
      result,
      played: null,
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: 0.15,
      playedTracking: false,
    });
    expect(small.attribution).toBe('quiet');
  });

  test('small regrets and small residual is quiet', () => {
    const analysis = analyzeTurn({
      turn: 3,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.12,
      scoreBefore: 0.1,
      scoreAfter: 0.15,
    });
    expect(analysis.attribution).toBe('quiet');
  });

  test('an unmatched action with a big swing is unclear, not blamed', () => {
    const analysis = analyzeTurn({
      turn: 11,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: null },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.5,
    });
    expect(analysis.p2.played).toBeNull();
    expect(analysis.attribution).toBe('unclear');
    expect(analysis.chanceDelta).toBeNull();
  });

  test('the last analyzed turn (no next score) still reports regrets', () => {
    const analysis = analyzeTurn({
      turn: 30,
      result,
      played: { p1: { kind: 'move', name: 'U-turn', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.swing).toBeNull();
    expect(analysis.p1.regret).toBeCloseTo(0.15, 10);
    expect(analysis.p1.regret).toBeGreaterThanOrEqual(REGRET_THRESHOLD);
    expect(analysis.attribution).toBe('both-decision');
  });
});

test.describe('doubles combined matching', () => {
  const combined: EvalResult = {
    score: 0.1,
    interval: 0,
    depthCompleted: 1,
    perSide: {
      p1: [
        choice('move moonblast 2, move fakeout 1', 'Moonblast→Chien-Pao + Fake Out→Incineroar', 0.3),
        choice('move moonblast 1, switch 3', 'Moonblast→Incineroar + → Amoonguss', 0.1),
        choice('move dazzlinggleam, move fakeout 1 terastallize', 'Dazzling Gleam + Tera + Fake Out→Incineroar', 0.0),
      ],
      p2: [],
    },
  };

  test('matches per-slot moves with targets, spreads, tera, and switches', async () => {
    const { matchPlayedSide } = await import('../src/lib/eval/analysis');
    const match = (slots: import('../src/lib/eval/played').PlayedTurn['p1Slots']) =>
      matchPlayedSide(combined, 'p1', { p1: null, p2: null, p1Slots: slots })?.choice ?? null;

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 2 },
      { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 },
    ])).toBe('move moonblast 2, move fakeout 1');

    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
      { kind: 'switch', name: 'Mushy', species: 'Amoonguss' },
    ])).toBe('move moonblast 1, switch 3');

    // Spread part accepts any protocol target; Tera label splits correctly.
    expect(match([
      { kind: 'move', name: 'Dazzling Gleam', tera: false, targetLoc: 1 },
      { kind: 'move', name: 'Fake Out', tera: true, targetLoc: 1 },
    ])).toBe('move dazzlinggleam, move fakeout 1 terastallize');

    // Wrong target → no match; prevented slot (null) → part count mismatch.
    expect(match([
      { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
      { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 },
    ])).toBeNull();
    expect(match([null, { kind: 'move', name: 'Fake Out', tera: false, targetLoc: 1 }])).toBeNull();
  });

  test('analyzeTurn computes doubles regret from the matched combo', async () => {
    const analysis = analyzeTurn({
      turn: 4,
      result: combined,
      played: {
        p1: null, p2: null,
        p1Slots: [
          { kind: 'move', name: 'Moonblast', tera: false, targetLoc: 1 },
          { kind: 'switch', name: 'Mushy', species: 'Amoonguss' },
        ],
        p2Slots: [null, null],
      },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    });
    expect(analysis.p1.played?.choice).toBe('move moonblast 1, switch 3');
    expect(analysis.p1.regret).toBeCloseTo(0.2, 10);
    expect(analysis.p1.playedSlots).toHaveLength(2);
  });
});
