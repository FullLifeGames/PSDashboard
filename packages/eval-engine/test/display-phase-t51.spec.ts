import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { formatRead, summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';
import { DISPLAY_K, displayK, winPctText, winPercent } from '../src/winprob';

/**
 * Round 69 (T51, decisions 21 and 22): the percent display grows surer with the game. The map is
 * sigmoid(K(share) * score) with K = 1.85 up to a fainted share of 0.25, rising by 5 per share to 3.10 at 0.5
 * (probe P1, displayk-offline.mjs). The expected values below are written out from that formula, not read back
 * from the function under test.
 */
const kAt = (share: number) => 1.85 + 5 * Math.min(0.25, Math.max(0, share - 0.25));
const expected = (score: number, share: number) => Math.round(100 / (1 + Math.exp(-kAt(share) * score)));
const SCORES = [-0.95, -0.6, -0.25, -0.1, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9];
// Singles: fainted bodies over 12; doubles and VGC bring 8 or 12 (4 of 6 in VGC): both grids.
const SINGLES_SHARES = Array.from({ length: 11 }, (_, i) => i / 12);
const DOUBLES_SHARES = Array.from({ length: 9 }, (_, i) => i / 8);

describe('winPercent with the fainted share', () => {
  test('the map is sigmoid(K(share) * score) on the singles and the doubles share grids', () => {
    for (const share of [...SINGLES_SHARES, ...DOUBLES_SHARES]) {
      for (const score of SCORES) expect(winPercent(score, share), `s=${score} share=${share}`).toBe(expected(score, share));
    }
    expect(displayK(0.5)).toBeCloseTo(3.1, 12);
    expect(displayK(1)).toBeCloseTo(3.1, 12); // capped: a nearly finished game does not claim more
  });

  test('exact plus and minus one stay literal 100 and 0 at any share', () => {
    for (const share of [undefined, null, 0, 0.3, 0.5, 0.9]) {
      expect(winPercent(1, share)).toBe(100);
      expect(winPercent(-1, share)).toBe(0);
      expect(winPercent(1 - 1e-12, share)).toBe(100);
      expect(winPercent(-1 + 1e-12, share)).toBe(0);
    }
  });

  test('no share, a null share and share 0 read as before: the fitted constant', () => {
    expect(DISPLAY_K).toBe(1.85);
    expect(displayK(undefined)).toBe(DISPLAY_K);
    expect(displayK(null)).toBe(DISPLAY_K);
    expect(displayK(0)).toBe(DISPLAY_K);
    expect(displayK(0.25)).toBe(DISPLAY_K);
    for (const score of SCORES) {
      const old = Math.round(100 / (1 + Math.exp(-1.85 * score)));
      expect(winPercent(score)).toBe(old);
      expect(winPercent(score, null)).toBe(old);
      expect(winPercent(score, 0)).toBe(old);
      expect(winPercent(score, 0.25)).toBe(old);
    }
  });

  test('a late share claims more for the same score and a mirrored score displays the complement', () => {
    expect(winPercent(0.5, 0.5)).toBeGreaterThan(winPercent(0.5, 0));
    expect(winPercent(-0.5, 0.5)).toBeLessThan(winPercent(-0.5, 0));
    for (const share of [0, 0.2, 0.4, 0.5, 0.8]) {
      for (const score of SCORES) expect(Math.abs(winPercent(score, share) + winPercent(-score, share) - 100)).toBeLessThanOrEqual(1);
    }
  });

  test('winPctText forwards the share and differences stay linear', () => {
    expect(winPctText(0.5, 0.5)).toBe(`${expected(0.5, 0.5)}%`);
    expect(winPctText(0.5)).toBe(`${expected(0.5, 0)}%`);
  });
});

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const result: EvalResult = {
  score: 0.1,
  interval: 0.05,
  depthCompleted: 2,
  perSide: {
    p1: [choice('move dracometeor', 'Draco Meteor', 0.2), choice('move uturn', 'U-turn', 0.05), choice('switch 2', '→ Corviknight', -0.1)],
    p2: [choice('switch 3', '→ Dragapult', -0.05), choice('move recover', 'Recover', -0.3)],
  },
};
const names: [string, string] = ['Alpha', 'Beta'];

describe('the turn card prints the late map', () => {
  const analysisAt = (share: number | undefined, playedTracking = true) => analyzeTurn({
    turn: 20,
    result,
    played: { p1: { kind: 'move', name: 'Draco Meteor', tera: false }, p2: { kind: 'move', name: 'Recover', tera: false } },
    playedOutcome: 0.0,
    scoreBefore: 0.1,
    scoreAfter: -0.25,
    playedTracking,
    ...(share === undefined ? {} : { faintedFraction: share, faintedFractionAfter: share }),
  });

  test('singles: the estimate sentence and the side clauses use the turn share', () => {
    const late = summarizeTurn(analysisAt(0.5), names);
    expect(late).toContain(`from ${expected(0.1, 0.5)}% to ${expected(-0.25, 0.5)}%`);
    expect(late).toContain(`(down to ${expected(-0.3, 0.5)}%)`);
    expect(late).toContain(`safe line was switching to Dragapult (${expected(-0.05, 0.5)}% guaranteed)`);
    const early = summarizeTurn(analysisAt(undefined), names);
    expect(early).toContain('55%');
    expect(early).toContain('39%');
    expect(late).not.toBe(early);
  });

  test('doubles (no played tracking): the estimate sentence uses the share of the turn and of the turn after', () => {
    const late = summarizeTurn(analysisAt(0.5, false), names);
    expect(late).toContain(`from ${expected(0.1, 0.5)}% to ${expected(-0.25, 0.5)}%`);
    expect(summarizeTurn(analysisAt(undefined, false), names)).toContain('from 55% to 39%');
  });

  test('the share of the turn after belongs to the after score', () => {
    const analysis = analyzeTurn({
      turn: 20, result, played: null, playedOutcome: null, scoreBefore: 0.1, scoreAfter: 0.4,
      faintedFraction: 0.1, faintedFractionAfter: 0.5, playedTracking: false,
    });
    expect(summarizeTurn(analysis, names)).toContain(`from ${expected(0.1, 0.1)}% to ${expected(0.4, 0.5)}%`);
  });

  test('the analysis carries the share it was read at', () => {
    const analysis = analysisAt(0.5);
    expect(analysis.faintedFraction).toBe(0.5);
    expect(analysis.faintedFractionAfter).toBe(0.5);
    expect(analysis.p1.faintedFraction).toBe(0.5);
    expect(analysis.p2.faintedFraction).toBe(0.5);
    expect(analysisAt(undefined).faintedFraction).toBeUndefined();
  });

  test('graded numbers never read the share: tier, regret and swing equal at every share', () => {
    const base = analysisAt(undefined);
    for (const share of [0, 0.4, 0.9]) {
      const other = analysisAt(share);
      for (const side of ['p1', 'p2'] as const) {
        expect(other[side].tier).toBe(base[side].tier);
        expect(other[side].regret).toBe(base[side].regret);
      }
      expect(other.swing).toBe(base.swing);
      expect(other.attribution).toBe(base.attribution);
    }
  });

  test('formatRead prints its percents at the share it is given', () => {
    const read = {
      choice: { label: '→ Noivern', ev: 0.19, worstCase: -0.25 },
      net: 0.19,
      confidence: 0.74,
      breakdown: [{ label: 'Earthquake', prob: 0.74, value: 0.32 }, { label: 'Ice Beam', prob: 0.26, value: -0.1 }],
    };
    expect(formatRead(read, 0.5)).toContain(`${expected(0.32, 0.5)}% if Earthquake`);
    expect(formatRead(read, 0.5)).toContain(`net ${expected(0.19, 0.5)}%`);
    expect(formatRead(read)).toContain(`net ${expected(0.19, 0)}%`);
  });
});
