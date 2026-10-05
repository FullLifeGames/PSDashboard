import { test, expect, describe } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import type { RankedChoice } from '../src/types';

const names: [string, string] = ['Alpha', 'Beta'];

const ranked = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, ev: worstCase, punishedBy: null });

const quietSide = (): SideAnalysis => ({ playedRaw: null, played: null, best: null, safe: null, regret: 0 });

const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
  turn, scoreBefore, scoreAfter,
  swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
  playedOutcome: null, decisionDelta: null, chanceDelta: null,
  attribution: 'quiet', p1: quietSide(), p2: quietSide(),
  ...over,
});

const read = (label: string, choiceStr: string, payoff: number): SideAnalysis => ({
  playedRaw: null,
  played: ranked(choiceStr, label, 0.1),
  best: ranked('move safe', 'Safe', 0.2),
  safe: null,
  regret: 0.05,
  riskUnpunished: true,
  riskPayoff: payoff,
  riskPaidOff: true,
});

/** Round 63 (T18): the order of the game report's winner story. */
describe('T18 point 4: the reads examples read in turn order', () => {
  test('singles, 655336: the bigger payoff on turn 27 is named after the read on turn 13', () => {
    const analyses: TurnAnalysis[] = [];
    for (let turn = 1; turn <= 28; turn++) {
      const before = 0.02 * turn;
      const p1 = turn === 13 ? read('Dragon Dance', 'move dragondance', 0.31)
        : turn === 27 ? read('Dragon Claw', 'move dragonclaw', 0.75) : quietSide();
      analyses.push(mk(turn, before, before + 0.02, { p1 }));
    }
    const report = buildGameReport(analyses, names, 'p1');
    expect(report.summary).toContain('Alpha won it on reads: Dragon Dance on turn 13 (+16%) and Dragon Claw on turn 27 (+38%).');
    // The report's read list keeps its own order and content.
    expect(report.reads.map(entry => entry.turn)).toEqual([13, 27]);
  });

  test('doubles: two combo reads keep the turn order the same way', () => {
    const report = buildGameReport([
      mk(1, 0.05, 0.1, { p1: read('Breaking Swipe + Make It Rain', 'move breakingswipe, move makeitrain', 0.12) }),
      mk(2, 0.1, 0.15),
      mk(3, 0.15, 0.3, { p1: read('Hyper Voice + Life Dew', 'move hypervoice, move lifedew', 0.4) }),
      mk(4, 0.3, 0.6),
    ], names, 'p1');
    expect(report.summary).toContain('Alpha won it on reads: Breaking Swipe + Make It Rain on turn 1 (+6%) and Hyper Voice + Life Dew on turn 3 (+20%).');
  });
});

/**
 * Decision 16, the tip sentence: since round 50 a conversion needs the bar
 * to hold for the winner from its turn on, so it can never name a turn
 * before the tip. This pins that order: a sweep the bar dropped again is no
 * conversion, and the report's "From turn N" never precedes "tipped on turn M".
 */
describe('T18: the conversion never comes before the tip', () => {
  const swept = (species: string): SideAnalysis => ({ ...quietSide(), decided: { species, announce: true } });

  test('a decided sweep before a dip under the favor line does not convert before the tip', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.8),
      mk(2, 0.8, 0.85, { p1: swept('Dragonite') }),
      mk(3, 0.85, -0.05),
      mk(4, -0.05, 0.75),
      mk(5, 0.75, 0.9, { p1: swept('Dragonite') }),
      mk(6, 0.9, 1),
    ], names, 'p1');
    expect(report.turningPoint).toBe(4);
    expect(report.conversion?.turn).toBe(5);
    const summary = report.summary;
    expect(summary.indexOf('tipped for good on turn 4')).toBeLessThan(summary.indexOf('From turn 5'));
  });
});
