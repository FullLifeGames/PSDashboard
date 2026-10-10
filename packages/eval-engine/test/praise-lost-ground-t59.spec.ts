import { test, expect, describe } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { summarizeTurn } from '../src/summary';
import { buildGameReport } from '../src/report';
import { lostGround, shownAttribution } from '../src/turn-analysis/risk';
import type { RankedChoice } from '../src/types';

/**
 * Round 67 (T59): no praise on a turn the praised side lost. The read was
 * priced from the played cell; when the side's own estimate fell across the
 * turn by at least the margin a read must win (0.1), the praise falls silent
 * everywhere it shows (the clause, the read credit, the side row's chip, the
 * report's read list and its reads sentence, the attribution badge). The
 * attribution field stays (pins, key moments, totals); the card and the
 * badge show the turn's movement instead of the read.
 */

const ranked = (choice: string, label: string, ev: number): RankedChoice =>
  ({ choice, label, worstCase: ev, expected: ev, ev, punishedBy: null });

const sideOf = (extra: Partial<SideAnalysis> = {}): SideAnalysis => {
  const line = ranked('move earthquake', 'Earthquake', 0.2);
  return { playedRaw: null, played: line, best: line, safe: line, regret: 0, ...extra };
};

const paid = (label: string, extra: Partial<SideAnalysis> = {}): SideAnalysis => sideOf({
  played: ranked('move hydropump', label, 0.3), safe: ranked('move scald', 'Scald', 0.1), riskPaidOff: true, riskPayoff: 0.2, ...extra,
});

const turn = (over: Partial<TurnAnalysis>): TurnAnalysis => ({
  turn: 10, scoreBefore: 0, scoreAfter: 0, swing: 0, playedOutcome: 0, decisionDelta: 0, chanceDelta: 0,
  attribution: 'quiet', p1: sideOf(), p2: sideOf(), playedTracking: true, ...over,
});

const names: [string, string] = ['BKC', '3d'];

describe('T59: the shared predicate', () => {
  test('a side lost ground when its own estimate fell by at least 0.1 across the turn', () => {
    expect(lostGround({ swing: -0.3 }, 'p1')).toBe(true);
    expect(lostGround({ swing: -0.3 }, 'p2')).toBe(false);
    expect(lostGround({ swing: 0.3 }, 'p2')).toBe(true);
    expect(lostGround({ swing: -0.1 }, 'p1')).toBe(true);
    expect(lostGround({ swing: -0.05 }, 'p1')).toBe(false);
    expect(lostGround({ swing: null }, 'p1')).toBe(false);
  });

  test('a read whose side lost ground leaves the shown attribution; both-read keeps the other side', () => {
    expect(shownAttribution(turn({ attribution: 'p2-read', p2: paid('Hydro Pump'), swing: 0.3, chanceDelta: 0.49 }))).toBe('chance');
    expect(shownAttribution(turn({ attribution: 'p2-read', p2: paid('Hydro Pump'), swing: 0.3, chanceDelta: 0.1 }))).toBe('shift');
    expect(shownAttribution(turn({ attribution: 'both-read', p1: paid('Scald'), p2: paid('Hydro Pump'), swing: 0.3 }))).toBe('p1-read');
    expect(shownAttribution(turn({ attribution: 'p1-read', p1: paid('Scald'), swing: 0.05 }))).toBe('p1-read');
    expect(shownAttribution(turn({ attribution: 'p1-decision' }))).toBe('p1-decision');
  });
});

describe('T59: the card stays silent on a lost-ground read', () => {
  test('singles (653785 t10 shape): Hydro Pump paid off on the cell, 3d lost 0.298, so no praise; the attribution field stays', () => {
    const analysis = turn({ attribution: 'p2-read', p2: paid('Hydro Pump'), swing: 0.298, decisionDelta: -0.193, chanceDelta: 0.491, scoreAfter: 0.298 });
    const summary = summarizeTurn(analysis, names);
    expect(summary).not.toContain('a read that paid off');
    expect(summary).toContain('Both sides picked reasonable options');
    expect(analysis.attribution).toBe('p2-read');
  });

  test('doubles (2663093831 t1 shape): a window read at a small loss keeps its praise', () => {
    const shed = paid('Protect + Shed Tail', { played: ranked('move protect, move shedtail', 'Protect + Shed Tail', 0.3), riskPayoffTurn: 3 });
    const summary = summarizeTurn(turn({ attribution: 'p1-read', p1: shed, swing: -0.041, chanceDelta: 0.236 }), names);
    expect(summary).toContain('a read that paid off 3 turns later');
  });

  test('doubles (912045 t9 shape): a paid-off pair whose side lost 0.544 is not praised', () => {
    const pair = paid('Hyper Voice + Life Dew', { played: ranked('move hypervoice, move lifedew', 'Hyper Voice + Life Dew', 0.3) });
    const summary = summarizeTurn(turn({ attribution: 'p1-read', p1: pair, swing: -0.544, decisionDelta: 0.143, chanceDelta: -0.687 }), names);
    expect(summary).not.toContain('a read that paid off');
    expect(summary).toContain('Both sides picked reasonable options');
  });

  test('a read credit stays silent on a lost turn (653785 t25 shape) and speaks at a small loss (2629703929 t7 shape)', () => {
    const credit = sideOf({ played: ranked('switch 4', '→ Cofagrigus', 0.2), safe: ranked('switch 3', '→ Volcanion', 0.1), readCredit: { payoff: 0.31 } });
    expect(summarizeTurn(turn({ attribution: 'chance', p1: credit, swing: -0.481, chanceDelta: -0.783 }), names))
      .not.toContain('a read the engine gave no weight');
    expect(summarizeTurn(turn({ attribution: 'quiet', p1: credit, swing: -0.02, chanceDelta: -0.04 }), names))
      .toContain('a read the engine gave no weight');
  });
});

describe('T59: the report lists and credits only reads whose turn held', () => {
  test('562428 shape: the lost-ground Stone Edge leaves the read list and the reads sentence, Close Combat stays; totals unchanged', () => {
    const read = (label: string, payoff: number, regret: number) =>
      paid(label, { played: ranked(`move ${label.toLowerCase().replace(' ', '')}`, label, 0.3), riskPayoff: payoff, regret });
    const analyses = [
      turn({ turn: 1, scoreBefore: 0, scoreAfter: 0.05, swing: 0.05 }),
      turn({ turn: 2, scoreBefore: 0.05, scoreAfter: -0.065, swing: -0.115, attribution: 'p1-read', p1: read('Stone Edge', 0.222, 0.1) }),
      turn({ turn: 3, scoreBefore: -0.065, scoreAfter: 0.33, swing: 0.395, attribution: 'p1-read', p1: read('Close Combat', 0.408, 0.1) }),
      turn({ turn: 4, scoreBefore: 0.33, scoreAfter: 0.7, swing: 0.37 }),
      turn({ turn: 5, scoreBefore: 0.7, scoreAfter: 0.9, swing: 0.2 }),
    ];
    const report = buildGameReport(analyses, ['LordEnz', 'Dflo'], 'p1');
    expect(report.reads.map(entry => entry.turn)).toEqual([3]);
    expect(report.summary).toContain('LordEnz won it on reads: Close Combat on turn 3');
    expect(report.summary).not.toContain('Stone Edge');
    expect(report.decisionTotals.p1).toBe(0);
  });
});
