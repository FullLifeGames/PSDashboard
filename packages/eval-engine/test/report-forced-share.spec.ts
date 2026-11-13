import { describe, expect, test } from 'vitest';
import { analyzeTurn, type TurnAnalysis } from '../src/analysis';
import { forcedQualifier } from '../src/prose/phrases';
import { buildGameReport } from '../src/report';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 89 (ruling 30.2, final-gate item 33, finding F2): the game report called a proof of mass 0.98 "forced: every reply
 * lost within 3 turns" and dropped the share, while the turn card said "in 98% of the sampled rolls". The report names the
 * share whenever the mass is below 1, in the card's own words (one helper, `forcedQualifier`, both import it). The gate
 * for speaking stays SPOKEN_MASS: a proof under 0.9 is no conversion in the report. Scene: gen9championsvgc2026regmbbo3-2688023429
 * turn 8 (a doubles game, Champions VGC), mass 0.98. The sentence reads the proof's numbers and the player names, so a
 * singles and a doubles analysis give the same words; both game types run through the same rows below.
 */

const names: [string, string] = ['Alpha', 'Beta'];
type Forced = NonNullable<TurnAnalysis['p2']['forcedWin']>;

const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, forcedWin?: Forced): TurnAnalysis => ({
  turn, scoreBefore, scoreAfter,
  swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
  playedOutcome: null, decisionDelta: null, chanceDelta: null, attribution: 'quiet',
  p1: { playedRaw: null, played: null, best: null, safe: null, regret: 0 },
  p2: { playedRaw: null, played: null, best: null, safe: null, regret: 0, ...(forcedWin ? { forcedWin } : {}) },
});

const reportSentence = (forced: Forced): string => {
  const report = buildGameReport([mk(1, 0.05, -0.9), mk(2, -0.9, -0.95, forced), mk(3, -0.95, -1)], names, 'p2');
  return report.summary;
};

const ROWS: { mass: number; caveat: Forced['caveat']; ends: string | null }[] = [
  { mass: 1, caveat: 'none', ends: 'every reply lost within 3 turns.' },
  { mass: 1, caveat: 'barring-crit', ends: 'every reply lost within 3 turns, barring a crit.' },
  { mass: 0.98, caveat: 'none', ends: 'every reply lost within 3 turns in 98% of the rolls.' },
  { mass: 0.98, caveat: 'sampled-rolls', ends: 'every reply lost within 3 turns in 98% of the sampled rolls.' },
  { mass: 0.98, caveat: 'barring-crit', ends: 'every reply lost within 3 turns in 98% of the rolls, barring a crit.' },
  { mass: 0.9, caveat: 'none', ends: 'every reply lost within 3 turns in 90% of the rolls.' },
  { mass: 0.996, caveat: 'none', ends: 'every reply lost within 3 turns in 99% of the rolls.' },
  // Under the spoken mass the report names no forced conversion at all (the gate is unchanged).
  { mass: 0.67, caveat: 'none', ends: null },
];

describe('the game report names the share of a proof below mass 1', () => {
  test.each(ROWS)('mass $mass, caveat $caveat', ({ mass, caveat, ends }) => {
    const summary = reportSentence({ turns: 3, mass, caveat, announce: true });
    if (ends === null) {
      expect(summary).not.toContain('forced');
      return;
    }
    expect(summary).toContain(`From turn 2 the win was forced: ${ends}`);
  });

  test('the report and the card say the share in the same words (the one helper)', () => {
    for (const { mass, caveat } of ROWS.filter(row => row.ends !== null)) {
      const qualifier = forcedQualifier({ mass, caveat });
      expect(reportSentence({ turns: 3, mass, caveat, announce: true })).toContain(`within 3 turns${qualifier}.`);
      const choice = (label: string, worstCase: number): RankedChoice =>
        ({ choice: `move ${label}`, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });
      const result: EvalResult = {
        score: -1, interval: 0, depthCompleted: 1,
        perSide: { p1: [choice('Roost', -0.9)], p2: [choice('Fire Fang', 0.9)] },
        unanswered: { p1: [], p2: [] },
        forcedWin: { side: 'p2', turns: 3, mass, caveat, engineScore: -0.5, states: 12 },
      };
      const card = summarizeTurn(analyzeTurn({
        turn: 8, result, played: null, playedOutcome: null, scoreBefore: -1, scoreAfter: null, playedTracking: false,
      }), names);
      expect(card).toContain(`Beta wins within 3 turns against every reply${qualifier}.`);
    }
  });

  test('the helper is empty at mass 1 without a caveat and names no more than the share below it', () => {
    expect(forcedQualifier({ mass: 1, caveat: 'none' })).toBe('');
    expect(forcedQualifier({ mass: 1, caveat: 'sampled-rolls' })).toBe(' on the sampled rolls');
    expect(forcedQualifier({ mass: 0.5, caveat: 'none' })).toBe(' in 50% of the rolls');
  });
});
