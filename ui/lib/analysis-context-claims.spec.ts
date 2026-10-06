import { describe, expect, test } from 'vitest';
import { allTurnEvents, type EvalResult } from '@fulllifegames/eval-engine';
import { computeGameReportData, type AnalysisGraphData, type TurnAnalysisContext } from '../../src/lib/analysis-context';
import { evalResult } from '../fixtures/eval-result';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

/**
 * Round 64 (T123 point 9): the report walk speaks "practically decided" once
 * per side, but a board that left the decided zone in between deserves the
 * sentence again (2630685175: decided for p1 at t6, the bar fell to 16% at
 * t7, p2 decided at t8, p1 decided again at t10 and the walk stayed silent).
 * The walk now releases a side's spoken decided and forced keys once a later
 * turn's bar reads that side under DECIDED_SCORE.
 */

const walkOver = (kind: ReplayKind, scores: number[], decidedAt: Set<number>, forcedAt: Set<number> = new Set()) => {
  const { replayData, snapshots } = replayFixture(kind);
  const format = kind === 'singles' ? 'singles' : 'doubles';
  const results: EvalResult[] = scores.map((score, index) => evalResult(format, {
    score,
    unanswered: { p1: [], p2: [], ...(decidedAt.has(index + 1) ? { decided: { side: 'p1' as const, species: 'Calyrex-Ice' } } : {}) },
    ...(forcedAt.has(index + 1) ? { forcedWin: { side: 'p1' as const, turns: 1, mass: 1, caveat: 'sampled-rolls' as const, engineScore: 1, states: 6 } } : {}),
  }));
  const graph: AnalysisGraphData = {
    scores, results,
    played: scores.map(() => null), playedOutcome: scores.map(() => null),
    verified: scores.map(() => null), sensitivity: scores.map(() => null),
  };
  const context: TurnAnalysisContext = {
    snapshots, turnEventsIndex: allTurnEvents(replayData.log), activesForTurn: () => null, playedHistory: { p1: [], p2: [] },
  };
  return computeGameReportData({ replayData, graph, context, winner: 'p1', tendencies: null })!.analyses;
};

describe('the walk speaks a side\'s decided sentence again after the board left the decided zone', () => {
  for (const kind of ['singles', 'vgc'] as const) {
    test(`${kind}: decided, the bar falls under 0.7, decided again: the second stage speaks`, () => {
      const walk = walkOver(kind, [0.8, 0.8, -0.2, 0.8, 0.8], new Set([1, 4]));
      expect(walk[0]?.p1.decided?.announce).toBe(true);
      expect(walk[3]?.p1.decided?.announce).toBe(true);
    });

    test(`${kind}: a bar that holds keeps the second stage quiet (2663093831 t12 and t13)`, () => {
      const walk = walkOver(kind, [0.8, 0.8, 0.75, 0.8, 0.8], new Set([1, 4]));
      expect(walk[0]?.p1.decided?.announce).toBe(true);
      expect(walk[3]?.p1.decided?.announce).toBe(false);
    });
  }

  test('doubles (2630685175 t7 to t11): a proof spoken before the fall no longer mutes the later decided stage, and a new proof speaks', () => {
    const walk = walkOver('vgc', [0.9, 1, -0.9, 0.85, 0.99, 1], new Set([1, 5]), new Set([2, 6]));
    expect(walk[1]?.p1.forcedWin?.announce).toBe(true);
    expect(walk[4]?.p1.decided?.announce).toBe(true);
    expect(walk[5]?.p1.forcedWin?.announce).toBe(true);
  });
});
