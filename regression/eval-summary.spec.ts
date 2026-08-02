import { test, expect } from '@playwright/test';
import { analyzeTurn } from '../src/lib/eval/analysis';
import { summarizeTurn } from '../src/lib/eval/summary';
import type { EvalResult, RankedChoice } from '../src/lib/eval/types';

const choice = (choiceStr: string, label: string, worstCase: number, line?: { p1: string; p2: string }[]): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, punishedBy: 'Reply', ...(line ? { line } : {}) });

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
      choice('switch 3', '→ Dragapult', -0.05, [{ p1: 'Draco Meteor', p2: 'U-turn' }]),
      choice('move recover', 'Recover', -0.3),
    ],
  },
};

const names: [string, string] = ['Alpha', 'Beta'];

test.describe('natural-language turn summaries', () => {
  test('a decision turn names the player, both options, and the follow-up line', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: -0.2,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    expect(summary).toContain('55%');
    expect(summary).toContain('38%');
    expect(summary).toContain('Beta played Recover');
    expect(summary).toContain('switching to Dragapult');
    expect(summary).toContain('then Draco Meteor · U-turn');
    expect(summary).not.toContain('→');
  });

  test('a chance turn blames the rolls, not the players', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 8,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.15,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
    }), names);
    expect(summary).toContain('how the turn rolled');
    expect(summary).toContain('−0.55');
    expect(summary).not.toContain('mistake');
  });

  test('a quiet turn with both engine moves says so', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 3,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.12,
      scoreBefore: 0.1,
      scoreAfter: 0.15,
    }), names);
    expect(summary).toContain('quiet');
    expect(summary).toContain("engine's preferred");
  });

  test('an unclear swing is attributed to a choice that never surfaced', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 11,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: null },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.5,
    }), names);
    expect(summary).toContain('never surfaced');
    expect(summary).not.toContain('mistake');
  });

  test('the last analyzed turn (no next score) still explains the position and regret', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 30,
      result,
      played: { p1: { kind: 'move', name: 'U-turn', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: null,
    }), names);
    expect(summary).toContain('55%');
    expect(summary).toContain('Alpha played U-turn');
    expect(summary).toContain('Beta played Recover');
  });

  test('a large luck remainder on a decision turn gets its own clause', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 14,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: -0.05,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
    }), names);
    expect(summary).toContain('Beta played Recover');
    expect(summary).toContain('luck');
    expect(summary).toContain('−0.35');
  });
});
