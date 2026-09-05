import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, RankedChoice } from '../src/types';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

describe('the forced win in prose (round 35)', () => {
  const forcedResult = (forcedWin: EvalResult['forcedWin']): EvalResult => ({
    score: 0.95, interval: 0, depthCompleted: 1,
    perSide: {
      p1: [choice('move firefang', 'Fire Fang', 0.9)],
      p2: [choice('move roost', 'Roost', -0.9)],
    },
    unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Garchomp', odds: 0.95, removes: 'Corviknight' } },
    ...(forcedWin ? { forcedWin } : {}),
  });
  const summaryAt = (forcedWin: EvalResult['forcedWin'], decidedSeen?: ReadonlySet<string>) =>
    summarizeTurn(analyzeTurn({
      turn: 73,
      result: forcedResult(forcedWin),
      played: { p1: { kind: 'move', name: 'Fire Fang', tera: false }, p2: { kind: 'move', name: 'Roost', tera: false } },
      playedOutcome: 0.9, scoreBefore: 0.95, scoreAfter: 0.99,
      ...(decidedSeen ? { decidedSeen } : {}),
    }), names);

  test('a full proof speaks the plain sentence and mutes the near stage', () => {
    const summary = summaryAt({ side: 'p1', turns: 3, mass: 1, caveat: 'none', engineScore: 0.5, states: 12 });
    expect(summary).toContain('Alpha wins in 3 against every reply.');
    expect(summary).not.toContain('from clearing the rest');
  });

  test('a crit caveat rides on the sentence', () => {
    const summary = summaryAt({ side: 'p1', turns: 4, mass: 1, caveat: 'barring-crit', engineScore: 0.5, states: 30 });
    expect(summary).toContain('Alpha wins in 4 against every reply, barring a crit.');
  });

  test('an open hit class names the roll', () => {
    const summary = summaryAt({
      side: 'p1', turns: 3, mass: 0.95, caveat: 'barring-crit', engineScore: 0.5, states: 40,
      open: { side: 'p1', moveId: 'firefang', label: 'Fire Fang', odds: 0.95, kind: 'hit' },
    });
    expect(summary).toContain('Alpha wins in 3 against every reply if the 95% Fire Fang lands, barring a crit.');
  });

  test('an open kill class says knocks out; a mass without an open class says the share of rolls', () => {
    expect(summaryAt({
      side: 'p1', turns: 2, mass: 0.9, caveat: 'none', engineScore: 0.5, states: 9,
      open: { side: 'p1', moveId: 'firefang', label: 'Fire Fang', odds: 0.9, kind: 'kill' },
    })).toContain('Alpha wins in 2 against every reply if the 90% Fire Fang knocks out.');
    expect(summaryAt({ side: 'p1', turns: 5, mass: 0.92, caveat: 'sampled-rolls', engineScore: 0.5, states: 80 }))
      .toContain('Alpha wins in 5 against every reply in 92% of the rolls on the sampled rolls.');
  });

  test('below the spoken mass the sentence stays quiet and the near stage speaks', () => {
    const summary = summaryAt({ side: 'p1', turns: 3, mass: 0.7, caveat: 'none', engineScore: 0.5, states: 12 });
    expect(summary).not.toContain('against every reply');
    expect(summary).toContain('from clearing the rest');
  });

  test('the game report speaks the proof once; the per-turn card every turn', () => {
    const forced: EvalResult['forcedWin'] = { side: 'p1', turns: 3, mass: 1, caveat: 'none', engineScore: 0.5, states: 12 };
    expect(summaryAt(forced, new Set(['p1:forced']))).not.toContain('against every reply');
    expect(summaryAt(forced)).toContain('against every reply');
    const analysis = analyzeTurn({
      turn: 73, result: forcedResult(forced), played: null, playedOutcome: null, scoreBefore: 0.95, scoreAfter: null,
      decidedSeen: new Set(['p1:forced']),
    });
    expect(analysis.p1.forcedWin).toEqual({ turns: 3, mass: 1, caveat: 'none', announce: false });
  });

  test('doubles: the sentence uses the player name, so a two-slot side reads the same', () => {
    const summary = summarizeTurn(analyzeTurn({
      turn: 20,
      result: { ...forcedResult({ side: 'p2', turns: 2, mass: 1, caveat: 'sampled-rolls', engineScore: -0.4, states: 6 }), score: -1 },
      played: null, playedOutcome: null, scoreBefore: -1, scoreAfter: null, playedTracking: false,
    }), names);
    expect(summary).toContain('Beta wins in 2 against every reply on the sampled rolls.');
  });
});
