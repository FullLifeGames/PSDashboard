import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 47: the read BEFORE the click ("If you expect X, Y is the move") and
 * the hindsight read's likeliest-click note. Both read the opponent model
 * over the solved matrix and need the players' tendencies; values are
 * wp-units (p1 perspective).
 */

const choice = (choiceStr: string, label: string, ev: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase: ev, expected: ev, ev, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

describe('the predictive read before the click', () => {
  // The Flying-switch shape: Beta's Earthquake is the obvious click into
  // Alpha's staying Scald; → Noivern crushes it and loses to Ice Beam.
  const predictive = (options: {
    values?: number[][]; mixes?: { p1: number[]; p2: number[] }; p1First?: 'scald' | 'noivern';
    p1Labels?: string[]; p2Labels?: string[]; p1Choices?: string[]; p2Choices?: string[];
  } = {}): EvalResult => {
    const p1Labels = options.p1Labels ?? ['Scald', '→ Noivern'];
    const p2Labels = options.p2Labels ?? ['Earthquake', 'Ice Beam'];
    const p1Choices = options.p1Choices ?? ['move scald', 'switch 3'];
    const p2Choices = options.p2Choices ?? ['move earthquake', 'move icebeam'];
    const p1Rows = [choice(p1Choices[0], p1Labels[0], -0.14), choice(p1Choices[1], p1Labels[1], -0.15)];
    return {
      score: -0.14, interval: 0.05, depthCompleted: 1,
      perSide: {
        p1: options.p1First === 'noivern' ? [p1Rows[1], p1Rows[0]] : p1Rows,
        p2: [choice(p2Choices[0], p2Labels[0], 0.14), choice(p2Choices[1], p2Labels[1], 0.13)],
      },
      matrix: {
        p1Labels, p2Labels, p1Choices, p2Choices,
        values: options.values ?? [[-0.40, -0.02], [0.60, -0.50]],
        mixes: options.mixes ?? { p1: [0.743, 0.257], p2: [0.324, 0.676] },
      },
    };
  };
  // Alpha splits evenly between moves and switches (Beta's model of Alpha
  // stays unsure); Beta mostly attacks.
  const tendencies = { p1: { attackRate: 0.5, switchRate: 0.5, repeatBias: 0 }, p2: { attackRate: 0.8, switchRate: 0.2, repeatBias: 0 } };
  const analyze = (result: EvalResult, extra: Partial<Parameters<typeof analyzeTurn>[0]> = {}) => analyzeTurn({
    turn: 7, result, tendencies,
    played: { p1: { kind: 'move', name: 'Scald', tera: false }, p2: { kind: 'move', name: 'Ice Beam', tera: false } },
    playedOutcome: -0.02, scoreBefore: -0.14, scoreAfter: -0.1,
    ...extra,
  });

  test('a confident model and a mistake-sized gain over the recommendation speak the sentence', () => {
    const analysis = analyze(predictive());
    expect(analysis.p1.predictiveRead).toMatchObject({ expect: 'Earthquake', response: '→ Noivern', over: 'Scald' });
    expect(analysis.p1.predictiveRead!.confidence).toBeCloseTo(0.67, 2);
    expect(analysis.p1.predictiveRead!.gain).toBeCloseTo(1.0, 8);
    expect(analysis.p2.predictiveRead).toBeUndefined();
    expect(summarizeTurn(analysis, names)).toContain(
      'If Alpha expects Earthquake (67% on the opponent model), switching to Noivern is the move — +50% over Scald against it.');
  });

  test('the sentence stands without played actions', () => {
    const analysis = analyze(predictive(), { played: null, playedOutcome: null, playedTracking: false });
    expect(summarizeTurn(analysis, names)).toContain('If Alpha expects Earthquake');
  });

  test('a model below the sentence confidence stays silent even where the turn card shows a read', () => {
    // Earthquake at 0.58: above READ_CONFIDENCE (0.55), below the sentence's 0.6.
    const analysis = analyze(predictive({ values: [[-0.20, -0.02], [0.60, -0.50]], mixes: { p1: [0.859, 0.141], p2: [0.375, 0.625] } }));
    expect(analysis.p1.predictiveRead).toBeUndefined();
    expect(summarizeTurn(analysis, names)).not.toContain('If Alpha expects');
  });

  test('a gain under the mistake band stays silent', () => {
    const analysis = analyze(predictive({ values: [[-0.40, -0.02], [-0.25, -0.50]] }));
    expect(analysis.p1.predictiveRead).toBeUndefined();
  });

  test('a response that already is the recommendation stays silent', () => {
    const analysis = analyze(predictive({ p1First: 'noivern' }));
    expect(analysis.p1.predictiveRead).toBeUndefined();
  });

  test('the displayed recommendation counts: a null-swapped alternative is no news', () => {
    // Will-O-Wisp is mechanically null into Heatran; the co-optimal Shadow
    // Ball displays in its place and is also the answer to Earth Power.
    const result = predictive({
      p1Labels: ['Will-O-Wisp', 'Shadow Ball'], p1Choices: ['move willowisp', 'move shadowball'],
      p2Labels: ['Earth Power', 'Stealth Rock'], p2Choices: ['move earthpower', 'move stealthrock'],
    });
    const analysis = analyze(result, {
      played: { p1: { kind: 'move', name: 'Will-O-Wisp', tera: false }, p2: { kind: 'move', name: 'Stealth Rock', tera: false } },
      actives: { p1: 'Gengar', p2: 'Heatran', gen: 8 },
    });
    expect(analysis.p1.bestNull?.alternative?.label).toBe('Shadow Ball');
    expect(analysis.p1.predictiveRead).toBeUndefined();
  });

  test('a doubles matrix speaks the sentence over its pair rows', () => {
    // The model's status-quo reference reads a pair by its first slot: a
    // pair that opens with a switch is the switch-out it discounts.
    const analysis = analyze(predictive({
      p1Labels: ['Fake Out + Moonblast', '→ Noivern + Tailwind'], p1Choices: ['move fakeout 1, move moonblast 1', 'switch 3, move tailwind'],
      p2Labels: ['Rock Slide + Knock Off', 'Protect + Trick Room'], p2Choices: ['move rockslide, move knockoff 1', 'move protect, move trickroom'],
    }), { played: null, playedOutcome: null });
    expect(summarizeTurn(analysis, names)).toContain(
      'If Alpha expects Rock Slide + Knock Off (67% on the opponent model), switching to Noivern + Tailwind is the move — +50% over Fake Out + Moonblast against it.');
  });

  test('a doubles matrix of move pairs alone leaves the model unsure, and the sentence silent', () => {
    const analysis = analyze(predictive({
      p1Labels: ['Fake Out + Moonblast', 'Protect + Tailwind'], p1Choices: ['move fakeout 1, move moonblast 1', 'move protect, move tailwind'],
      p2Labels: ['Rock Slide + Knock Off', 'Protect + Trick Room'], p2Choices: ['move rockslide, move knockoff 1', 'move protect, move trickroom'],
    }), { played: null, playedOutcome: null });
    expect(analysis.p1.predictiveRead).toBeUndefined();
  });

  test('without tendencies the signal stays out', () => {
    const analysis = analyzeTurn({
      turn: 7, result: predictive(), played: null, playedOutcome: null, scoreBefore: -0.14, scoreAfter: -0.1,
    });
    expect(analysis.p1.predictiveRead).toBeUndefined();
  });
});

describe('the hindsight read and the likeliest click', () => {
  // The round-13 shape: a wide board on both sides, a shift without a culprit.
  const wide: EvalResult = {
    score: 0.0, interval: 0.3, depthCompleted: 1,
    perSide: {
      p1: [
        choice('move ironhead', 'Iron Head', 0.1), choice('move earthpower', 'Earth Power', 0.1),
        choice('move recover', 'Recover', 0.09), choice('move toxic', 'Toxic', 0.05), choice('switch 2', '→ Heatran', 0.02),
      ],
      p2: [
        choice('move surf', 'Surf', 0.05), choice('move icebeam', 'Ice Beam', 0.04),
        choice('move roost', 'Roost', 0.0), choice('switch 3', '→ Mandibuzz', -0.02),
      ],
    },
    matrix: {
      p1Labels: ['Iron Head', 'Earth Power', 'Recover', 'Toxic', '→ Heatran'],
      p2Labels: ['Surf', 'Ice Beam', 'Roost', '→ Mandibuzz'],
      p1Choices: ['move ironhead', 'move earthpower', 'move recover', 'move toxic', 'switch 2'],
      p2Choices: ['move surf', 'move icebeam', 'move roost', 'switch 3'],
      values: [
        [0.30, 0.10, 0.12, -0.05],
        [0.32, 0.11, 0.10, 0.08],
        [0.20, 0.09, 0.05, 0.02],
        [0.15, 0.05, 0.08, 0.01],
        [0.10, 0.02, 0.03, 0.00],
      ],
      mixes: { p1: [0.5, 0.5, 0, 0, 0], p2: [0.6, 0.2, 0.1, 0.1] },
    },
  };
  const tendencies = { p1: { attackRate: 0.9, switchRate: 0.1, repeatBias: 0 }, p2: { attackRate: 0.9, switchRate: 0.1, repeatBias: 0 } };
  const clicked = (p1Move: string, withTendencies: boolean) => analyzeTurn({
    turn: 10, result: wide, ...(withTendencies ? { tendencies } : {}),
    played: { p1: { kind: 'move', name: p1Move, tera: false }, p2: { kind: 'move', name: 'Surf', tera: false } },
    playedOutcome: 0.12, scoreBefore: 0.0, scoreAfter: 0.25,
  });

  test('a click the opponent model favoured reads as findable', () => {
    // Beta's model over Alpha's rows favours Earth Power (0.33), and Earth Power came.
    const analysis = clicked('Earth Power', true);
    expect(analysis.p2.hindsightRead?.likeliest).toBeCloseTo(0.33, 1);
    expect(summarizeTurn(analysis, names)).toContain(
      'The read was there for Beta — Earth Power was the likeliest click on the opponent model (33%), ' +
      'and against it switching to Mandibuzz was worth +12% more.');
  });

  test('any other click keeps the hindsight wording', () => {
    const analysis = clicked('Iron Head', true);
    expect(analysis.p2.hindsightRead?.likeliest).toBeUndefined();
    expect(summarizeTurn(analysis, names)).toContain('against the Iron Head actually clicked');
  });

  test('without tendencies the model stays out', () => {
    expect(clicked('Earth Power', false).p2.hindsightRead?.likeliest).toBeUndefined();
  });
});
