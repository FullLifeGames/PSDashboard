import { test, expect } from '@playwright/test';
import { analyzeTurn } from '../src/lib/eval/analysis';
import { summarizeTurn } from '../src/lib/eval/summary';
import type { EvalResult, RankedChoice } from '../src/lib/eval/types';

const choice = (choiceStr: string, label: string, worstCase: number, line?: { p1: string; p2: string }[]): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply', ...(line ? { line } : {}) });

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
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    // Percents run through the fitted win-prob curve (singles K), not 50+50·s.
    expect(summary).toContain('52%');
    expect(summary).toContain('44%');
    expect(summary).toContain('Beta played Recover');
    expect(summary).toContain('switching to Dragapult');
    expect(summary).toContain('then Draco Meteor · U-turn');
    expect(summary).not.toContain('→');
    expect(summary).not.toContain('setup move');
    // The fixture's punishing reply ("Reply") was never clicked — the
    // regret reads as an unpunished risk with neutral safe-line framing.
    expect(summary).toContain('a read: its floor risked Reply (−0.30); Draco Meteor came instead.');
    expect(summary).toContain("The engine's safe line was switching to Dragapult");
    expect(summary).not.toContain('safer was');
  });

  test('a punished misplay keeps the reproachful safer-was framing', () => {
    const punished: EvalResult = {
      ...result,
      perSide: { p1: [choice('move reply', 'Reply', 0.2)], p2: result.perSide.p2 },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 21,
      result: punished,
      played: { p1: { kind: 'move', name: 'Reply', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: -0.2,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    expect(summary).toContain('Beta played Recover');
    expect(summary).toContain('safer was switching to Dragapult');
    expect(summary).not.toContain('a read');
  });

  test('a blunder is called a blunder', () => {
    const withSplash: EvalResult = {
      ...result,
      perSide: {
        p1: [choice('move reply', 'Reply', 0.2)],
        p2: [...result.perSide.p2, choice('move splash', 'Splash', -0.4)],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 22,
      result: withSplash,
      played: { p1: { kind: 'move', name: 'Reply', tera: false }, p2: { kind: 'move', name: 'Splash', tera: false } },
      playedOutcome: -0.2,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    expect(summary).toContain('a blunder; clearly better was switching to Dragapult');
    expect(summary).not.toContain('safer was');
  });

  test('an inaccuracy gets a light note even on a quiet turn', () => {
    // U-turn at +0.10 ev vs Draco Meteor's +0.20: regret 0.10 — inaccuracy.
    const light: EvalResult = {
      ...result,
      perSide: {
        p1: [choice('move dracometeor', 'Draco Meteor', 0.2), choice('move uturn', 'U-turn', 0.1)],
        p2: result.perSide.p2,
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 23,
      result: light,
      played: { p1: { kind: 'move', name: 'U-turn', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.1,
      scoreBefore: 0.1,
      scoreAfter: 0.1,
    }), names);
    expect(summary).toContain('quiet turn');
    expect(summary).toContain("Alpha's U-turn was an inaccuracy — Draco Meteor was slightly better");
  });

  test('a delayed payoff names its horizon', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      futureOutcomes: [-0.3, -0.28],
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    expect(summary).toContain('a read that paid off one turn later, +0.35 over the safe switching to Dragapult');
  });

  test('a hidden partner slot is disclosed in the summary', () => {
    // p2's slot b was flinched: the grade is charitable (best consistent
    // combo), and the summary must say so instead of pretending certainty.
    const doubles: EvalResult = {
      score: 0.1, interval: 0, depthCompleted: 1,
      perSide: {
        p1: [choice('move tackle 1, move protect', 'Tackle + Protect', 0.1)],
        p2: [
          choice('move protect, move drainpunch 1', 'Protect + Drain Punch', 0.05),
          choice('move rockslide, move ragefist 1', 'Rock Slide + Rage Fist', -0.1),
          choice('move rockslide, move drainpunch 1', 'Rock Slide + Drain Punch', -0.3),
        ],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 5,
      result: doubles,
      played: {
        p1: null, p2: null,
        p1Slots: [
          { kind: 'move', name: 'Tackle', targetLoc: 1 },
          { kind: 'move', name: 'Protect', targetLoc: null },
        ],
        p2Slots: [{ kind: 'move', name: 'Rock Slide', targetLoc: null }, null],
      },
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.1,
    }), names);
    expect(summary).toContain('Beta played Rock Slide + Rage Fist');
    expect(summary).toContain("Partner's action hidden — graded on the visible slot.");
  });

  test('a one-detail difference is condensed into a why clause', () => {
    // The VGC shape: same two moves, the only difference is the Mega.
    const doubles: EvalResult = {
      score: 0.4,
      interval: 0.05,
      depthCompleted: 2,
      perSide: {
        p1: [
          choice('move bugbite 1 mega, move closecombat 1', 'Mega + Bug Bite→Politoed + Close Combat→Politoed', 0.35),
          choice('move bugbite 1, move closecombat 1', 'Bug Bite→Politoed + Close Combat→Politoed', -0.14),
        ],
        p2: [choice('move surf', 'Surf', -0.2)],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 3,
      result: doubles,
      played: {
        p1: null,
        p2: { kind: 'move', name: 'Surf', tera: false },
        p1Slots: [
          { kind: 'move', name: 'Bug Bite', targetLoc: 1 },
          { kind: 'move', name: 'Close Combat', targetLoc: 1 },
        ],
      },
      playedOutcome: 0.3,
      scoreBefore: 0.4,
      scoreAfter: 0.48,
    }), names);
    expect(summary).toContain("The engine's safe line was Mega + Bug Bite→Politoed + Close Combat→Politoed");
    expect(summary).toContain('The difference: only the Mega Evolution.');
  });

  test('a read that beat the safe guarantee is praised, not blamed', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 24,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: -0.2,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    expect(summary).toContain('Beta played Recover — a read that paid off, +0.25 over the safe switching to Dragapult');
    expect(summary).toContain('The floor priced in Reply; Draco Meteor came instead.');
    expect(summary).not.toContain('safer was');
  });

  test('a regretted setup move carries the horizon caveat', () => {
    const setupResult: EvalResult = {
      ...result,
      perSide: {
        p1: result.perSide.p1,
        p2: [...result.perSide.p2, choice('move swordsdance', 'Swords Dance', -0.35)],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 12,
      result: setupResult,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Swords Dance', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
    }), names);
    expect(summary).toContain('Beta played Swords Dance');
    expect(summary).toContain('Swords Dance is a setup move');
    expect(summary).toContain('regret may be overstated');
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

  test('a culprit-free swing is called a shift with its decomposition', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 19,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'switch', name: 'Dragapult', species: 'Dragapult' } },
      playedOutcome: 0.21,
      scoreBefore: 0.1,
      scoreAfter: 0.35,
    }), names);
    expect(summary).toContain('No single mistake');
    expect(summary).toContain('+0.11');
    expect(summary).toContain('+0.14');
    expect(summary).not.toContain('quiet');
  });

  test('without played tracking the summary points at the engine lines', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 5,
      result,
      played: null,
      playedOutcome: null,
      scoreBefore: 0.1,
      scoreAfter: -0.4,
      playedTracking: false,
    }), names);
    expect(summary).toContain("engine's preferred lines");
    expect(summary).not.toContain('mistake');
    expect(summary).not.toContain('never surfaced');
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
    // Percents run through the fitted win-prob curve (singles K), not 50+50·s.
    expect(summary).toContain('52%');
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
