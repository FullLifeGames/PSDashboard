import { test, expect } from '@playwright/test';
import type { TurnAnalysis } from '../src/lib/eval/analysis';
import { buildGameReport } from '../src/lib/eval/report';
import type { RankedChoice } from '../src/lib/eval/types';

const names: [string, string] = ['Alpha', 'Beta'];

const ranked = (choiceStr: string, label: string, worstCase: number): RankedChoice =>
  ({ choice: choiceStr, label, worstCase, expected: worstCase, punishedBy: null });

const mk = (turn: number, scoreBefore: number, scoreAfter: number | null, over: Partial<TurnAnalysis> = {}): TurnAnalysis => ({
  turn,
  scoreBefore,
  scoreAfter,
  swing: scoreAfter !== null ? scoreAfter - scoreBefore : null,
  playedOutcome: null,
  decisionDelta: null,
  chanceDelta: null,
  attribution: 'quiet',
  p1: { playedRaw: null, played: null, best: null, regret: 0 },
  p2: { playedRaw: null, played: null, best: null, regret: 0 },
  ...over,
});

test.describe('game report (multi-turn root cause)', () => {
  test('finds the turn whose play made the winning advantage permanent', () => {
    const report = buildGameReport([
      mk(1, 0.2, 0.1),
      mk(2, 0.1, -0.2),
      mk(3, -0.2, -0.5),
      mk(4, -0.5, -0.7),
    ], names, 'p2');
    // Scores favor Beta from turn 3 onward, so turn 2's play was decisive.
    expect(report.turningPoint).toBe(2);
    expect(report.summary).toContain('Beta won');
    expect(report.summary).toContain('turn 2');
  });

  test('a wire-to-wire win has no turning point', () => {
    const report = buildGameReport([
      mk(1, -0.2, -0.3),
      mk(2, -0.3, -0.5),
      mk(3, -0.5, -0.8),
    ], names, 'p2');
    expect(report.turningPoint).toBeNull();
    expect(report.summary).toContain('start to finish');
  });

  test('key moments are the biggest non-quiet swings, in turn order', () => {
    const report = buildGameReport([
      mk(1, 0.0, 0.5, { attribution: 'chance' }),
      mk(2, 0.5, 0.45),
      mk(3, 0.45, -0.3, { attribution: 'p1-decision' }),
      mk(4, -0.3, -0.35, { attribution: 'p2-decision' }),
      mk(5, -0.35, -0.9, { attribution: 'both-decision' }),
    ], names, 'p2');
    expect(report.keyMoments.map(moment => moment.turn)).toEqual([1, 3, 5]);
  });

  test('sums per-player regret and net chance', () => {
    const side = (regret: number) => ({ playedRaw: null, played: null, best: null, regret });
    const report = buildGameReport([
      mk(1, 0, -0.1, { p1: side(0.2), p2: side(0.05), chanceDelta: -0.1 }),
      mk(2, -0.1, -0.2, { p1: side(0.15), p2: side(0), chanceDelta: -0.3 }),
    ], names, 'p2');
    expect(report.decisionTotals.p1).toBeCloseTo(0.35, 10);
    expect(report.decisionTotals.p2).toBeCloseTo(0.05, 10);
    expect(report.chanceTotal).toBeCloseTo(-0.4, 10);
  });

  test('names the seeds of the loss: the loser\'s costliest choices before the tip', () => {
    const report = buildGameReport([
      mk(1, 0.1, 0.05),
      mk(2, 0.05, -0.3, {
        attribution: 'p1-decision',
        p1: {
          playedRaw: { kind: 'move', name: 'Recover', tera: false },
          played: ranked('move recover', 'Recover', -0.3),
          best: ranked('switch 3', '→ Dragapult', -0.05),
          regret: 0.25,
        },
      }),
      mk(3, -0.3, -0.6),
      mk(4, -0.6, -0.9),
    ], names, 'p2');
    expect(report.summary).toContain('Recover');
    expect(report.summary).toContain('switching to Dragapult');
    expect(report.summary).toContain('turn 2');
  });

  test('a clean loss is called out as matchup/variance, not blunders', () => {
    const report = buildGameReport([
      mk(1, -0.2, -0.4),
      mk(2, -0.4, -0.6),
      mk(3, -0.6, -0.9),
    ], names, 'p2');
    expect(report.summary).toContain('clean');
  });

  test('without played tracking the report never claims clean play or seeds', () => {
    const report = buildGameReport([
      mk(1, -0.2, -0.4),
      mk(2, -0.4, -0.6),
      mk(3, -0.6, -0.9),
    ], names, 'p2', false);
    expect(report.summary).toContain('Beta won');
    expect(report.summary).not.toContain('clean');
    expect(report.summary).not.toContain('seeds');
  });

  test('gaps in the sweep are tolerated', () => {
    const report = buildGameReport([
      mk(1, 0.2, 0.1),
      null,
      mk(3, -0.2, -0.5),
      mk(4, -0.5, -0.7),
    ], names, 'p2');
    expect(report.turningPoint).toBe(2);
    expect(report.keyMoments.length).toBeGreaterThanOrEqual(0);
  });
});
