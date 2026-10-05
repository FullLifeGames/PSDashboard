import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

/**
 * Round 63 (T19, decision 15): a proof under the spoken mass still speaks on
 * the card when the bar sits at least 0.1 under the proven win — the open
 * event is why the number is lower. A proof whose open branch wins anyway
 * keeps the bar near the win and stays quiet.
 */
describe('the open event of a forced win under 0.9', () => {
  const resultWith = (score: number, forcedWin: EvalResult['forcedWin'], extra: Partial<EvalResult> = {}): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move hydropump', 'Hydro Pump', score)],
      p2: [choice('move painsplit', 'Pain Split', -score)],
    },
    ...(forcedWin ? { forcedWin } : {}),
    ...extra,
  });
  const analyzeAt = (result: EvalResult, scoreBefore: number) => analyzeTurn({
    turn: 24, result, played: null, playedOutcome: null, scoreBefore, scoreAfter: null,
  });

  test('singles, 649664 t24: the 80% Hydro Pump is named when the bar sits at 0.79', () => {
    const result = resultWith(0.7875, {
      side: 'p1', turns: 5, mass: 0.8, caveat: 'barring-crit', engineScore: -0.95, states: 40,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' },
    });
    expect(summarizeTurn(analyzeAt(result, 0.7875), names))
      .toContain('Alpha wins in 5 against every reply if the 80% Hydro Pump lands, barring a crit.');
  });

  test('when the open event speaks, the decided stage of the same side stays quiet on that turn', () => {
    const result = resultWith(0.7875, {
      side: 'p1', turns: 5, mass: 0.8, caveat: 'barring-crit', engineScore: -0.95, states: 40,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.8, kind: 'hit' },
    }, { unanswered: { p1: [], p2: [], decided: { side: 'p1', species: 'Keldeo' } } });
    const analysis = analyzeAt(result, 0.7875);
    expect(analysis.p1.decided).toEqual({ species: 'Keldeo', announce: false });
    expect(summarizeTurn(analysis, names)).not.toContain('clears everything');
  });

  test('573756 t138: a 66% proof whose open branch still wins keeps the bar at 0.97 and hangs nothing on a 2% event', () => {
    const result = resultWith(-0.966, {
      side: 'p2', turns: 4, mass: 0.6628, caveat: 'barring-crit', engineScore: -0.967, states: 90,
      open: { side: 'p2', moveId: 'stompingtantrum', label: 'Stomping Tantrum', odds: 0.0208, kind: 'kill' },
    });
    const summary = summarizeTurn(analyzeAt(result, -0.966), names);
    expect(summary).not.toContain('against every reply');
    expect(summary).not.toContain('2%');
  });

  test('doubles, sampled rolls: the share of the sampled rolls is named once, and no crit is mentioned', () => {
    const result = resultWith(0.7, { side: 'p1', turns: 2, mass: 0.8, caveat: 'sampled-rolls', engineScore: 0.4, states: 30 }, {
      perSide: {
        p1: [choice('move heatwave, move protect', 'Heat Wave + Protect', 0.7)],
        p2: [choice('move protect, move earthpower 1', 'Protect + Earth Power→Chi-Yu', -0.7)],
      },
    });
    const summary = summarizeTurn(analyzeAt(result, 0.7), names);
    expect(summary).toContain('Alpha wins in 2 against every reply in 80% of the sampled rolls.');
    expect(summary).not.toContain('crit');
  });

  test('the same 0.1 gap holds for sampled rolls: a bar at 0.95 keeps an 80% proof quiet', () => {
    const result = resultWith(0.95, { side: 'p1', turns: 2, mass: 0.8, caveat: 'sampled-rolls', engineScore: 0.9, states: 30 });
    expect(summarizeTurn(analyzeAt(result, 0.95), names)).not.toContain('against every reply');
  });

  test('a coin-flip proof at exactly 0.5 never speaks, whatever the bar', () => {
    const result = resultWith(0.3, {
      side: 'p1', turns: 3, mass: 0.5, caveat: 'barring-crit', engineScore: 0.3, states: 20,
      open: { side: 'p1', moveId: 'hydropump', label: 'Hydro Pump', odds: 0.5, kind: 'hit' },
    });
    expect(summarizeTurn(analyzeAt(result, 0.3), names)).not.toContain('against every reply');
  });
});
