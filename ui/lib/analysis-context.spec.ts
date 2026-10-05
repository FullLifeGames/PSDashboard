import { describe, expect, test } from 'vitest';
import { allTurnEvents, type EvalResult } from '@fulllifegames/eval-engine';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { analyzeTurnAt, type AnalysisGraphData, type TurnAnalysisContext } from '../../src/lib/analysis-context';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';

const { replayData, snapshots } = replayFixture('singles');

/** Every result carries a near-decided roll for p1 (649664 t3 shape: a 90% roll on full teams). */
const nearResult = (score: number): EvalResult => evalResult('singles', {
  score,
  unanswered: { p1: [], p2: [], nearDecided: { side: 'p1', species: 'Medicham-Mega', odds: 0.9, removes: 'Keldeo' } },
});

const graphWith = (faintedFractions: (number | null)[] | undefined): AnalysisGraphData => {
  const full = evalGraph('singles');
  const turns = snapshots.length;
  const scores = full.scores.slice(0, turns);
  return {
    scores, results: scores.map(score => nearResult(score)),
    played: scores.map(() => null), playedOutcome: scores.map(() => null),
    verified: scores.map(() => null), sensitivity: scores.map(() => null),
    ...(faintedFractions ? { faintedFractions } : {}),
  };
};

const contextWith = (turnSnapshots: TurnSnapshot[]): TurnAnalysisContext => ({
  snapshots: turnSnapshots,
  turnEventsIndex: allTurnEvents(replayData.log),
  activesForTurn: () => null,
  playedHistory: { p1: [], p2: [] },
});

const nearAt = (turn: number, graph: AnalysisGraphData, context: TurnAnalysisContext) =>
  analyzeTurnAt({ turn, graph, context, includeSacks: false })?.p1.nearDecided;

/** Round 63 (T18): the walk and the card hand the turn's fainted share to analyzeTurn. */
describe('analyzeTurnAt passes the phase of the turn', () => {
  test('the sweep\'s recorded share decides: none fallen keeps the near sentence quiet, a quarter lets it speak', () => {
    const graph = graphWith(snapshots.map((_, index) => (index === 1 ? 0.25 : 0)));
    const context = contextWith(snapshots);
    expect(nearAt(1, graph, context)?.announce).toBe(false);
    expect(nearAt(2, graph, context)?.announce).toBe(true);
  });

  test('without a recorded share (a manual mode never records one) the pre-turn snapshot counts the fallen bodies', () => {
    const fallen = structuredClone(snapshots);
    for (const pokemon of fallen[1].p2.pokemon.slice(0, 3)) pokemon.fainted = true;
    const context = contextWith(fallen);
    for (const graph of [graphWith(undefined), graphWith(snapshots.map(() => null))]) {
      expect(nearAt(1, graph, context)?.announce).toBe(false);
      expect(nearAt(2, graph, context)?.announce).toBe(true);
    }
  });
});
