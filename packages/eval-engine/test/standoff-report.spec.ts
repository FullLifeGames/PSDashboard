import { describe, expect, test } from 'vitest';
import type { SideAnalysis, TurnAnalysis } from '../src/analysis';
import { buildGameReport } from '../src/report';
import { STANDOFF_MIN_TURNS, standoffsOf } from '../src/standoff';
import type { RankedChoice } from '../src/types';

/**
 * Round 79 (T285): a standoff is a run of at least STANDOFF_MIN_TURNS consecutive analyzed turns in which nobody fainted and
 * nobody switched (573756 turns 79 to 137: two burned Toxapex, p2's PP running out). Inside it the swing is the HP and PP
 * cycle of one position, so shifts, rolls and reads stay out of the key moments and the reads list; graded decisions (a
 * misplay, a decision moment) stay. The window comes from the analyses alone. Singles read playedRaw, doubles the slot
 * lists (a doubles label can carry a switch after another action); without played tracking a switch cannot be seen and
 * the rule stays closed.
 */

const names: [string, string] = ['Alpha', 'Beta'];

const choice = (label: string): RankedChoice =>
  ({ choice: label, label, worstCase: 0, expected: 0, ev: 0, punishedBy: null });
const move = { kind: 'move' as const, name: 'Recover' };
const sw = { kind: 'switch' as const, name: 'Zapdos', species: 'Zapdos' };
const sideOf = (extra: Partial<SideAnalysis> = {}): SideAnalysis =>
  ({ playedRaw: move, played: choice('Recover'), best: choice('Recover'), safe: null, regret: 0, ...extra });

/** One turn at a constant fainted share (no faint inside it unless `after` differs). */
const mk = (turn: number, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
  turn, scoreBefore: -0.5, scoreAfter: -0.5, swing: 0, playedOutcome: null, decisionDelta: null, chanceDelta: null,
  attribution: 'quiet', playedTracking: true, faintedFraction: 0.75, faintedFractionAfter: 0.75,
  p1: sideOf(), p2: sideOf(), ...over,
} as TurnAnalysis);

/** A shift: a swing of 0.4 with no single culprit. */
const shift = (turn: number): TurnAnalysis => mk(turn, { scoreBefore: -0.5, scoreAfter: -0.1, swing: 0.4, attribution: 'shift' });
/** A paid-off read by p1 (a gain, so it stays on the list outside a standoff). */
const readOf = (turn: number): TurnAnalysis => mk(turn, {
  scoreBefore: -0.5, scoreAfter: -0.3, swing: 0.2, attribution: 'p1-read',
  p1: sideOf({ riskPaidOff: true, riskPayoff: 0.28 }),
});
const misplayOf = (turn: number): TurnAnalysis => mk(turn, {
  p2: sideOf({ regret: 0.3, tier: 'blunder', played: choice('Recover'), best: choice('Scald') }),
});

/** Twelve quiet turns (1..12) with `edits` replacing single turns. */
const game = (edits: TurnAnalysis[], count = 12): TurnAnalysis[] => {
  const byTurn = new Map(edits.map(analysis => [analysis.turn, analysis]));
  return Array.from({ length: count }, (_, i) => byTurn.get(i + 1) ?? mk(i + 1));
};
const turnsOf = (list: { turn: number }[]) => list.map(entry => entry.turn);

describe('the standoff window (T285)', () => {
  test('twelve turns without a faint or a switch are one standoff', () => {
    expect(STANDOFF_MIN_TURNS).toBe(10);
    expect(standoffsOf(game([]))).toEqual([{ from: 1, to: 12 }]);
  });

  test('nine turns are too few', () => {
    expect(standoffsOf(game([], 9))).toEqual([]);
  });

  test('a faint ends the run on its own turn: the faint turn is no standoff turn', () => {
    // The fainted share changes between turn 6 and 7: turns 1-5 and 7-12 (5 and 6 turns) are no standoff.
    const faint = mk(6, { faintedFractionAfter: 0.875 });
    const after = [7, 8, 9, 10, 11, 12].map(turn => mk(turn, { faintedFraction: 0.875, faintedFractionAfter: 0.875 }));
    expect(standoffsOf(game([faint, ...after]))).toEqual([]);
  });

  test('a long run on both sides of a faint stays two standoffs', () => {
    const turns = Array.from({ length: 26 }, (_, i) => {
      const turn = i + 1;
      if (turn === 13) return mk(turn, { faintedFractionAfter: 0.875 });
      return turn > 13 ? mk(turn, { faintedFraction: 0.875, faintedFractionAfter: 0.875 }) : mk(turn);
    });
    expect(standoffsOf(turns)).toEqual([{ from: 1, to: 12 }, { from: 14, to: 26 }]);
  });

  test('a played switch of either side breaks the run (singles)', () => {
    const away = mk(6, { p1: sideOf({ playedRaw: sw }) });
    expect(standoffsOf(game([away], 14))).toEqual([]);
    const foe = mk(6, { p2: sideOf({ playedRaw: sw }) });
    expect(standoffsOf(game([foe], 14))).toEqual([]);
    expect(standoffsOf(game([foe], 17))).toEqual([{ from: 7, to: 17 }]);
  });

  test('a side that never acted breaks the run', () => {
    expect(standoffsOf(game([mk(6, { p1: sideOf({ neverActed: true }) })], 14))).toEqual([]);
  });

  test('doubles: a switch in the second slot breaks the run, the label is not read', () => {
    const protect = { kind: 'move' as const, name: 'Protect' };
    const doubles = (turn: number, slots: SideAnalysis['playedSlots']) =>
      mk(turn, { p1: sideOf({ playedRaw: null, playedSlots: slots, played: choice('Protect + Recover') }) });
    expect(standoffsOf(game([doubles(6, [protect, sw])], 14))).toEqual([]);
    expect(standoffsOf(game([doubles(6, [protect, move])], 14))).toEqual([{ from: 1, to: 14 }]);
  });

  test('a missing analysis breaks the run, and so do turns without a fainted share', () => {
    const gap = game([], 14).filter(analysis => analysis.turn !== 7);
    expect(standoffsOf(gap)).toEqual([]);
    expect(standoffsOf(game([], 14).map(analysis => ({ ...analysis, faintedFraction: undefined })))).toEqual([]);
  });

  test('without played tracking a switch cannot be seen: no standoff', () => {
    expect(standoffsOf(game([], 14).map(analysis => ({ ...analysis, playedTracking: false })))).toEqual([]);
  });
});

describe('the report inside a standoff (T285)', () => {
  test('a shift and a read inside the run leave the key moments and the reads', () => {
    const report = buildGameReport(game([shift(5), readOf(8)]), names, 'p2');
    expect(turnsOf(report.keyMoments)).toEqual([]);
    expect(report.reads).toEqual([]);
  });

  test('the same turns with a faint between them keep both (two runs of 6)', () => {
    const faint = mk(6, { faintedFractionAfter: 0.875 });
    const later = [7, 8, 9, 10, 11, 12].map(turn => mk(turn, { faintedFraction: 0.875, faintedFractionAfter: 0.875 }));
    const lateRead = { ...readOf(8), faintedFraction: 0.875, faintedFractionAfter: 0.875 };
    const report = buildGameReport(game([shift(5), faint, ...later.filter(t => t.turn !== 8), lateRead]), names, 'p2');
    expect(turnsOf(report.keyMoments)).toEqual([5]);
    expect(turnsOf(report.reads)).toEqual([8]);
  });

  test('a rolled chance inside the run leaves as well', () => {
    const roll = mk(5, {
      scoreBefore: -0.5, scoreAfter: -0.1, swing: 0.4, attribution: 'chance', chanceDelta: 0.4,
      rolledFor: { p1: true, p2: false },
    });
    const report = buildGameReport(game([roll]), names, 'p2', true, new Set([5]));
    expect(turnsOf(report.keyMoments)).toEqual([]);
  });

  test('a graded decision stays: a misplay on the list and a decision moment', () => {
    const decision = mk(5, { scoreBefore: -0.5, scoreAfter: 0.0, swing: 0.5, attribution: 'p2-decision', p2: sideOf({ regret: 0.5, tier: 'blunder', best: choice('Scald') }) });
    const report = buildGameReport(game([decision, misplayOf(9)]), names, 'p2');
    expect(turnsOf(report.keyMoments)).toEqual([5]);
    expect(turnsOf(report.misplays)).toEqual([5, 9]);
  });

  test('a run of nine keeps its shift', () => {
    const report = buildGameReport(game([shift(5)], 9), names, 'p2');
    expect(turnsOf(report.keyMoments)).toEqual([5]);
  });

  test('the slot of a dropped standoff turn stays empty', () => {
    // Turns 1-12 are a standoff holding the biggest shift; turns 13-17 are single moments outside it.
    const outside = [13, 14, 15, 16, 17].map(turn => mk(turn, {
      faintedFraction: 0.875, faintedFractionAfter: turn === 17 ? 1 : 0.875,
      scoreBefore: -0.5, scoreAfter: -0.5 + 0.3 + (turn - 13) * 0.01, swing: 0.3 + (turn - 13) * 0.01, attribution: 'shift' as const,
    }));
    const faint = mk(12, { faintedFractionAfter: 0.875, scoreBefore: -0.5, scoreAfter: -0.5 });
    const big = { ...shift(5), swing: 0.9, scoreAfter: 0.4 };
    const report = buildGameReport([...game([big, faint]), ...outside], names, 'p2');
    // The faint turn 12 ends the run at 11. The top four by rank are 5, 17, 16, 15; turn 5 is inside the run and drops out.
    expect(turnsOf(report.keyMoments)).toEqual([15, 16, 17]);
  });

  test('one sentence names the standoff in game terms', () => {
    const report = buildGameReport(game([]), names, 'p2');
    expect(report.summary).toContain('Turns 1 to 12 were a standoff: nothing fainted and nobody switched for 12 turns, so their shifts and reads stay out of the key moments.');
  });

  test('two standoffs are named together', () => {
    const turns = Array.from({ length: 26 }, (_, i) => {
      const turn = i + 1;
      if (turn === 13) return mk(turn, { faintedFractionAfter: 0.875 });
      return turn > 13 ? mk(turn, { faintedFraction: 0.875, faintedFractionAfter: 0.875 }) : mk(turn);
    });
    const report = buildGameReport(turns, names, 'p2');
    expect(report.summary).toContain('Turns 1 to 12 and 14 to 26 were standoffs: nothing fainted and nobody switched in them, so their shifts and reads stay out of the key moments.');
  });

  test('a game without a standoff speaks no such sentence', () => {
    const report = buildGameReport(game([], 9), names, 'p2');
    expect(report.summary).not.toContain('standoff');
  });

  test('doubles and singles read the same window', () => {
    const protect = { kind: 'move' as const, name: 'Protect' };
    const doublesGame = game([shift(5)]).map(analysis => ({
      ...analysis,
      p1: { ...analysis.p1, playedRaw: null, playedSlots: [protect, move] },
      p2: { ...analysis.p2, playedRaw: null, playedSlots: [move, move] },
    }));
    expect(turnsOf(buildGameReport(doublesGame, names, 'p2').keyMoments)).toEqual([]);
  });
});
