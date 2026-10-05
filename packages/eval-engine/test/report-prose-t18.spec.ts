import { test, expect, describe } from 'vitest';
import { analyzeTurn } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import type { EvalResult, KoOddsInfo, RankedChoice } from '../src/types';

const choice = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: 'Reply' });

const names: [string, string] = ['Alpha', 'Beta'];

/** Round 63 (T18): the small sentences of the turn card and the game report. */
describe('T18 point 6: the read clause names the click with a verb that fits the odds', () => {
  /** A gamble that paid off (Hydro Pump gave up a mistake-sized floor and landed), with the given odds on the click. */
  const paidRead = (koOdds: KoOddsInfo): string => {
    const tied: EvalResult = {
      score: -0.05, interval: 0.02, depthCompleted: 1,
      perSide: {
        p1: [choice('move ironhead', 'Iron Head', -0.05)],
        p2: [
          { ...choice('move recover', 'Recover', 0.04), ev: 0.05, punishedBy: 'Iron Head' },
          { ...choice('move hydropump', 'Hydro Pump', -0.39), ev: 0.047, punishedBy: 'Earth Power', koOdds },
        ],
      },
    };
    return summarizeTurn(analyzeTurn({
      turn: 50,
      result: tied,
      played: { p1: { kind: 'move', name: 'Iron Head', tera: false }, p2: { kind: 'move', name: 'Hydro Pump', tera: false } },
      playedOutcome: -0.19,
      scoreBefore: -0.05,
      scoreAfter: -0.14,
    }), names);
  };

  test('singles: a sure hit into a kill range reads "kills ~43% of the time", never "was kills"', () => {
    const summary = paidRead({ accuracy: 1, killFraction: 0.43 });
    expect(summary).toContain('a read that paid off');
    expect(summary).toContain('The click kills ~43% of the time.');
    expect(summary).not.toContain('was kills');
  });

  test('doubles: a labelled click names its slot move with the same verb', () => {
    const summary = paidRead({ accuracy: 1, killFraction: 0.43, label: 'Hydro Pump→Chi-Yu' });
    expect(summary).toContain('Hydro Pump→Chi-Yu kills ~43% of the time.');
    expect(summary).not.toContain('was kills');
  });

  test('the roll shapes keep their copula', () => {
    expect(paidRead({ accuracy: 0.8, killFraction: 1 })).toContain('The click was an 80% roll to connect.');
    expect(paidRead({ accuracy: 0.9, killFraction: 0.5 })).toContain('The click was a 90% roll into a ~50% kill range.');
  });
});

describe('T18 point 1: the near sentence waits for a quarter of the bodies to fall', () => {
  const nearResult = (side: 'p1' | 'p2', species: string, odds: number, removes: string, score: number, doubles = false): EvalResult => ({
    score, interval: 0, depthCompleted: 1,
    perSide: doubles
      ? {
        p1: [choice('move heatwave, move protect', 'Heat Wave + Protect', score)],
        p2: [choice('move protect, move precipiceblades', 'Protect + Precipice Blades', -score)],
      }
      : { p1: [choice('move hydropump', 'Hydro Pump', score)], p2: [choice('move fakeout', 'Fake Out', -score)] },
    unanswered: { p1: [], p2: [], nearDecided: { side, species, odds, removes } },
  });
  const at = (result: EvalResult, faintedFraction?: number | null) => analyzeTurn({
    turn: 3, result, played: null, playedOutcome: null, scoreBefore: result.score, scoreAfter: result.score,
    ...(faintedFraction !== undefined ? { faintedFraction } : {}),
  });

  test('singles, 649664 t3: full teams keep the 90% roll quiet; at a quarter fallen it speaks', () => {
    const result = nearResult('p2', 'Medicham-Mega', 0.9, 'Keldeo', -0.11);
    const early = at(result, 0);
    expect(early.p2.nearDecided).toEqual({ species: 'Medicham-Mega', odds: 0.9, removes: 'Keldeo', announce: false });
    expect(summarizeTurn(early, names)).not.toContain('from clearing the rest');
    expect(summarizeTurn(at(result, 0.25), names))
      .toContain('Medicham-Mega is one 90% roll from clearing the rest — removing Keldeo leaves no answer behind.');
    // Without a known share the gate stays off (the card of a caller that passes none reads as before).
    expect(at(result).p2.nearDecided?.announce).toBe(true);
  });

  test('doubles, 2629703929 t2: a sure KO on full teams stays quiet, and later reads as a sure KO, not a 100% roll', () => {
    const result = nearResult('p1', 'Chi-Yu', 1, 'Groudon', 0.67, true);
    expect(summarizeTurn(at(result, 0), names)).not.toContain('from clearing the rest');
    const later = summarizeTurn(at(result, 0.5), names);
    expect(later).toContain('Chi-Yu is one sure KO from clearing the rest — removing Groudon leaves no answer behind.');
    expect(later).not.toContain('100% roll');
  });

  test('573756 t73 keeps its pinned 95% roll at 0.42 fallen', () => {
    const result = nearResult('p2', 'Garchomp', 0.95, 'Corviknight', -0.6);
    expect(summarizeTurn(at(result, 0.4167), names)).toContain('is one 95% roll from clearing the rest');
  });
});
