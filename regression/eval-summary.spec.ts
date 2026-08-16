import { test, expect } from '@playwright/test';
import { analyzeTurn } from '../src/lib/eval/analysis';
import { formatRead, summarizeTurn } from '../src/lib/eval/summary';
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
    // Scores are wp-units; percents run through the calibrated display map
    // (sigmoid(DISPLAY_K·s) — 0.1 → 55%, −0.25 → 39%).
    expect(summary).toContain('55%');
    expect(summary).toContain('39%');
    expect(summary).toContain('Beta played Recover');
    expect(summary).toContain('switching to Dragapult');
    expect(summary).toContain('then Draco Meteor · U-turn');
    expect(summary).not.toContain('→');
    expect(summary).not.toContain('setup move');
    // The fixture's punishing reply ("Reply") was never clicked — the
    // regret reads as an unpunished risk with neutral safe-line framing.
    expect(summary).toContain('a read: its floor risked Reply (down to 36%); Draco Meteor came instead.');
    expect(summary).toContain("The engine's safe line was switching to Dragapult");
    expect(summary).not.toContain('safer was');
  });

  test('formatRead renders the exploit line with its breakdown', () => {
    const line = formatRead({
      choice: { label: '→ Noivern', ev: 0.19, worstCase: -0.25 },
      net: 0.19,
      confidence: 0.74,
      breakdown: [
        { label: 'Earthquake', prob: 0.74, value: 0.32 },
        { label: 'Ice Beam', prob: 0.26, value: -0.25 },
      ],
    });
    expect(line).toContain('Read: switch Noivern');
    expect(line).toContain('64% if Earthquake (74% likely)');
    expect(line).toContain('39% if Ice Beam (26% likely)');
    expect(line).toContain('net 59%');
  });

  test('a read-matching risk is credited to the opponent model', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
      reads: {
        p2: {
          choice: { label: 'Recover', ev: 0.1, worstCase: -0.3 },
          net: 0.1, confidence: 0.7, breakdown: [],
        },
      },
    }), names);
    expect(summary).toContain("a read against the opponent's tendencies");
    expect(summary).not.toContain('a read: its floor risked');
  });

  test('an untiered gamble that landed is praised as a read that paid off', () => {
    // Draft T50-shaped: the played switch ties the engine pick by EV (no
    // tier), gave up a mistake-sized floor, and the outcome beat the safe
    // guarantee — the headline is the read, not "a quiet turn".
    const tied: EvalResult = {
      score: -0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [choice('move ironhead', 'Iron Head', -0.05)],
        p2: [
          { ...choice('move recover', 'Recover', 0.04), ev: 0.05, punishedBy: 'Iron Head' },
          { ...choice('switch 5', '→ Heatran', -0.39), ev: 0.047, punishedBy: 'Earth Power' },
        ],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 50,
      result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome: -0.19,
      scoreBefore: -0.05,
      scoreAfter: -0.14,
    }), names);
    expect(summary).toContain('a read that paid off');
    expect(summary).toContain('+8% over the safe Recover (52% guaranteed)');
    expect(summary).toContain('The floor priced in Earth Power; Iron Head came instead.');
    expect(summary).not.toContain('quiet turn');
  });

  test('a sensitivity hinge names the item split', () => {
    const withSensitivity = analyzeTurn({
      turn: 20,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
      sensitivity: {
        p2: [
          { species: 'Heatran', item: 'Choice Scarf', playedEv: -0.3, bestEv: -0.05 },
          { species: 'Heatran', item: 'Leftovers', playedEv: -0.06, bestEv: -0.05 },
        ],
      },
    });
    const text = summarizeTurn(withSensitivity, names);
    expect(text).toContain("hinges on Heatran's item");
    expect(text).toContain('Leftovers: fine');
  });

  test('a low-cost sacrifice reads neutrally', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 29,
      result,
      played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.1,
      scoreAfter: -0.25,
      sacks: { p2: { name: 'Uxie', hpFraction: 0.09 } },
    }), names);
    expect(summary).toContain('Beta sacked Uxie (9% HP)');
    expect(summary).not.toContain('a read:');
    expect(summary).not.toContain('safer was');
    expect(summary).not.toContain('inaccuracy');
  });

  test('a stay-and-die feed gets the certainty wording', () => {
    const feedResult: EvalResult = {
      score: 0.17, interval: 0.05, depthCompleted: 2,
      perSide: {
        p1: [choice('move bodypress', 'Body Press', 0.35)],
        p2: [
          { ...choice('switch 2', '→ Garchomp', -0.154), ev: -0.1 },
          { ...choice('move knockoff', 'Knock Off', -0.42), ev: -0.42 },
        ],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 68, result: feedResult,
      played: {
        p1: { kind: 'move', name: 'Body Press', tera: false },
        p2: { kind: 'move', name: 'Knock Off', tera: false },
      },
      playedOutcome: 0.42, futureOutcomes: [-0.1, -0.31, null],
      scoreBefore: 0.17, scoreAfter: 0.31,
      sacks: { p2: { name: 'Weavile', hpFraction: 0.8, stayed: true } },
    }), names);
    expect(summary).toContain('Beta fed Weavile (80% HP)');
    expect(summary).toContain('graded as a sacrifice, not a misplay');
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
        // 0.45 wp-unit regret vs the −0.05 best: past the 20%-win-prob band.
        p2: [...result.perSide.p2, choice('move splash', 'Splash', -0.5)],
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
    expect(summary).toContain('a read that paid off one turn later, +18% over the safe switching to Dragapult');
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
          choice('move rockslide, move ragefist 1', 'Rock Slide + Rage Fist', -0.2),
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
    expect(summary).toContain('Beta played Recover — a read that paid off, +13% over the safe switching to Dragapult');
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
    // chanceDelta −0.55 wp-units = −28 win-probability points.
    expect(summary).toContain('−28%');
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
    // decisionDelta ~+0.11 / chanceDelta +0.14 wp-units → +5% / +7% points.
    expect(summary).toContain('+5%');
    expect(summary).toContain('+7%');
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
    // Scores ARE wp-units now: percent display is linear ((s+1)/2), and
    // Alpha's 0.15 regret sits below the wp-unit mistake band — it surfaces
    // as the inaccuracy note instead of a decision clause.
    expect(summary).toContain('55%');
    expect(summary).toContain("Alpha's U-turn was an inaccuracy");
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
    // chanceDelta −0.35 wp-units = −18 win-probability points.
    expect(summary).toContain('−18%');
  });
});

test.describe('round-5 narrative: breadth, conditionals, null guard, forced mixes', () => {
  test('a wide culprit-free swing reads as an open turn, not a drift', () => {
    const wide: EvalResult = {
      score: 0.0, interval: 0.3, depthCompleted: 1,
      perSide: {
        p1: [
          choice('move ironhead', 'Iron Head', 0.1),
          choice('move earthpower', 'Earth Power', 0.1),
          choice('move recover', 'Recover', 0.09),
          choice('move toxic', 'Toxic', 0.05),
          choice('switch 2', '→ Heatran', 0.02),
        ],
        p2: [
          choice('move surf', 'Surf', 0.05),
          choice('move icebeam', 'Ice Beam', 0.04),
          choice('move roost', 'Roost', 0.0),
          choice('switch 3', '→ Mandibuzz', -0.02),
        ],
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 10,
      result: wide,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Surf', tera: false } },
      playedOutcome: 0.12,
      scoreBefore: 0.0,
      scoreAfter: 0.25,
    }), names);
    expect(summary).toContain('open turn');
    expect(summary).toContain('5 of 5 options for Alpha');
    expect(summary).toContain('4 of 4 for Beta');
    expect(summary).toContain('out-predicting');
    expect(summary).not.toContain('No single mistake');
  });

  const conditionalChoice = (choiceStr: string, label: string, ev: number, punishedBy: string | null = null): RankedChoice =>
    ({ choice: choiceStr, label, worstCase: ev - 0.05, expected: ev, ev, punishedBy });

  test('a punished mistake whose engine mix leans elsewhere renders the conditional', () => {
    const leaning: EvalResult = {
      score: 0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [conditionalChoice('move ironhead', 'Iron Head', 0.05), conditionalChoice('move earthpower', 'Earth Power', 0.04)],
        p2: [
          conditionalChoice('move recover', 'Recover', -0.05, 'Iron Head'),
          conditionalChoice('switch 5', '→ Heatran', -0.06),
          conditionalChoice('move splash', 'Splash', -0.35, 'Iron Head'),
        ],
      },
      matrix: {
        p1Labels: ['Iron Head', 'Earth Power'],
        p2Labels: ['Recover', '→ Heatran', 'Splash'],
        p1Choices: ['move ironhead', 'move earthpower'],
        p2Choices: ['move recover', 'switch 5', 'move splash'],
        values: [
          [0.05, 0.02, 0.30],
          [0.10, 0.40, 0.35],
        ],
        mixes: { p1: [0.5, 0.5], p2: [0.11, 0.89, 0] },
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 7,
      result: leaning,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Splash', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.05,
      scoreAfter: 0.3,
    }), names);
    expect(summary).toContain('safer was Recover');
    expect(summary).toContain("The engine's own equilibrium leans switching to Heatran (89%)");
    expect(summary).toContain('Recover is the pick only if you expect Earth Power');
    expect(summary).toContain('switching to Heatran covers Iron Head');
  });

  const wispResult = (withHex: boolean): EvalResult => ({
    score: 0.1, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [
        conditionalChoice('move willowisp', 'Will-O-Wisp', 0.2),
        ...(withHex ? [conditionalChoice('move hex', 'Hex', 0.19)] : []),
        conditionalChoice('move splash', 'Splash', -0.3, 'Flare Blitz'),
      ],
      p2: [conditionalChoice('move flareblitz', 'Flare Blitz', -0.1)],
    },
  });
  const wispParams = (result: EvalResult) => ({
    turn: 19,
    result,
    played: {
      p1: { kind: 'move' as const, name: 'Splash', tera: false },
      p2: { kind: 'move' as const, name: 'Flare Blitz', tera: false },
    },
    playedOutcome: 0.0,
    scoreBefore: 0.1,
    scoreAfter: -0.2,
    actives: { p1: 'Mew', p2: 'Charizard-Mega-X', gen: 6 },
  });

  test('a null recommendation swaps to the co-optimal alternative', () => {
    const summary = summarizeTurn(analyzeTurn(wispParams(wispResult(true))), names);
    expect(summary).toContain('clearly better was Hex');
    expect(summary).not.toContain('Will-O-Wisp');
  });

  test('a null recommendation without an alternative carries its caveat', () => {
    const summary = summarizeTurn(analyzeTurn(wispParams(wispResult(false))), names);
    expect(summary).toContain('clearly better was Will-O-Wisp');
    expect(summary).toContain('cannot be burned');
    expect(summary).toContain('rest of the team');
  });

  const forcedResult = (): EvalResult => ({
    score: 0.05, interval: 0.02, depthCompleted: 1,
    perSide: {
      p1: [conditionalChoice('move ironhead', 'Iron Head', 0.05)],
      p2: [
        conditionalChoice('move recover', 'Recover', -0.05),
        conditionalChoice('switch 5', '→ Heatran', -0.06),
      ],
    },
    matrix: {
      p1Labels: ['Iron Head'],
      p2Labels: ['Recover', '→ Heatran'],
      p1Choices: ['move ironhead'],
      p2Choices: ['move recover', 'switch 5'],
      values: [[0.05, 0.06]],
      mixes: { p1: [1], p2: [0.08, 0.92] },
    },
  });

  test('a near-forced equilibrium switch is named — deviation variant', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 30,
      result: forcedResult(),
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
      playedOutcome: 0.05,
      scoreBefore: 0.05,
      scoreAfter: 0.08,
    }), names);
    expect(summary).toContain('The equilibrium all but commits Beta to switching to Heatran here (92%)');
    expect(summary).toContain('Recover came instead');
  });

  test('a near-forced equilibrium switch is named — followed variant', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 30,
      result: forcedResult(),
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'switch', name: 'Heatran', species: 'Heatran' } },
      playedOutcome: 0.05,
      scoreBefore: 0.05,
      scoreAfter: 0.08,
    }), names);
    expect(summary).toContain('The equilibrium all but commits Beta to switching to Heatran here (92%)');
    expect(summary).toContain('which is what happened');
  });
});

test.describe('forced-mix dedup against the conditional', () => {
  const conditionalDedupChoice = (choiceStr: string, label: string, ev: number, punishedBy: string | null = null): RankedChoice =>
    ({ choice: choiceStr, label, worstCase: ev - 0.05, expected: ev, ev, punishedBy });

  test('the forced sentence yields when the conditional already names the same mix', () => {
    const leaning: EvalResult = {
      score: 0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [conditionalDedupChoice('move ironhead', 'Iron Head', 0.05), conditionalDedupChoice('move earthpower', 'Earth Power', 0.04)],
        p2: [
          conditionalDedupChoice('move recover', 'Recover', -0.05, 'Iron Head'),
          conditionalDedupChoice('switch 5', '→ Heatran', -0.06),
          conditionalDedupChoice('move splash', 'Splash', -0.35, 'Iron Head'),
        ],
      },
      matrix: {
        p1Labels: ['Iron Head', 'Earth Power'],
        p2Labels: ['Recover', '→ Heatran', 'Splash'],
        p1Choices: ['move ironhead', 'move earthpower'],
        p2Choices: ['move recover', 'switch 5', 'move splash'],
        values: [
          [0.05, 0.02, 0.30],
          [0.10, 0.40, 0.35],
        ],
        mixes: { p1: [0.5, 0.5], p2: [0.05, 0.92, 0.03] },
      },
    };
    const summary = summarizeTurn(analyzeTurn({
      turn: 7,
      result: leaning,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Splash', tera: false } },
      playedOutcome: 0.0,
      scoreBefore: 0.05,
      scoreAfter: 0.3,
    }), names);
    expect(summary).toContain("The engine's own equilibrium leans switching to Heatran (92%)");
    expect(summary).not.toContain('all but commits');
  });
});
