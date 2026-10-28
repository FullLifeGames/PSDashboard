import { describe, expect, test } from 'vitest';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import {
  analyzeTurnAt, type AnalysisGraphData, type TurnAnalysisContext,
} from '../../../src/lib/analysis-context';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';

/**
 * Round 69 (T177): the analysis context hands the replay's generation to the dice detection. Thunder Wave has accuracy
 * 100 in Gen 6 (no roll) and 90 from Gen 7 (a roll); a context that names no generation keeps the round 67 reading.
 * Singles and doubles run the same line on their first slot pair.
 */

const GEN6_ACTIVES = (gen: number) => ({ p1: null, p2: null, gen });

function rolledFor(kind: 'singles' | 'doubles', actives: TurnAnalysisContext['activesForTurn']) {
  const { snapshots } = replayFixture(kind);
  const full = evalGraph(kind);
  const scores = full.scores.slice(0, snapshots.length);
  const graph: AnalysisGraphData = {
    scores, results: scores.map(score => evalResult(kind, { score })),
    played: scores.map(() => null), playedOutcome: scores.map(() => null),
    verified: scores.map(() => null), sensitivity: scores.map(() => null),
  };
  const turnEventsIndex: string[][] = snapshots.map(() => []);
  turnEventsIndex[1] = ['|move|p1a: Raichu|Thunder Wave|p2a: Bulbasaur', '|-status|p2a: Bulbasaur|par'];
  const context: TurnAnalysisContext = {
    snapshots: snapshots as TurnSnapshot[], turnEventsIndex, activesForTurn: actives, playedHistory: { p1: [], p2: [] },
  };
  return analyzeTurnAt({ turn: 1, graph, context, includeSacks: false })?.rolledFor;
}

describe.each(['singles', 'doubles'] as const)('the context hands the generation to the dice detection, %s', kind => {
  test('Gen 6: a sure Thunder Wave is no roll; Gen 9: its 90% is; no generation keeps the old reading', () => {
    expect(rolledFor(kind, () => GEN6_ACTIVES(6))).toEqual({ p1: false, p2: false });
    expect(rolledFor(kind, () => GEN6_ACTIVES(9))).toEqual({ p1: true, p2: false });
    expect(rolledFor(kind, () => null)).toEqual({ p1: true, p2: false });
  });
});
