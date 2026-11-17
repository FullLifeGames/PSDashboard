import { describe, expect, test } from 'vitest';
import { allTurnEvents, summarizeTurn, type EvalResult } from '@fulllifegames/eval-engine';
import {
  analyzeTurnAt, computeGameReportData, type AnalysisGraphData, type TurnAnalysisContext,
} from '../../../src/lib/analysis-context';
import { evalResult } from '../fixtures/eval-result';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

/**
 * Round 89 (P4, ruling 39 B4a): the app prints the engine's forced-win sentence in the turn's card (EvalTurnAnalysis) and in the Game
 * review (the report's summary). A forced win that a repeated stall only delays carries one clause, "a repeated Protect only delays
 * it", on the card and "only delayed it" in the report, once in each, in singles and in doubles; a win through a choice the search's
 * list never held adds the sentence that names it. The words come from the engine (`forced-win-delay-prose.spec.ts` holds them against
 * the prover and the Dex); this row holds that the app's two readers pass the fields through and print the clause once.
 */
const FORCED: Record<ReplayKind, NonNullable<EvalResult['forcedWin']>> = {
  singles: { side: 'p1', turns: 2, mass: 1, caveat: 'sampled-rolls', delay: 'protect', delayName: 'Protect', engineScore: 0.4, states: 4 },
  doubles: {
    side: 'p1', turns: 2, mass: 1, caveat: 'sampled-rolls', delay: 'protect', delayName: 'Protect', engineScore: 0.4, states: 4,
    choice: 'move heatwave, move aquajet 1', choiceNames: { first: 'Aqua Jet', partner: 'Heat Wave' },
  },
  vgc: {
    side: 'p1', turns: 2, mass: 1, caveat: 'sampled-rolls', delay: 'detect', delayName: 'Detect', engineScore: 0.4, states: 4,
    choice: 'move heatwave, move aquajet 1', choiceNames: { first: 'Aqua Jet', partner: 'Heat Wave' },
  },
};

describe.each(['singles', 'doubles', 'vgc'] as const)('%s: the delay clause on the card and in the Game review', kind => {
  const { replayData, snapshots } = replayFixture(kind);
  const forcedWin = FORCED[kind];
  const game: 'singles' | 'doubles' = kind === 'singles' ? 'singles' : 'doubles';
  const graph: AnalysisGraphData = {
    scores: snapshots.map(() => 0.95),
    results: snapshots.map(() => evalResult(game, { score: 0.95, forcedWin })),
    played: snapshots.map(() => null), playedOutcome: snapshots.map(() => null),
    verified: snapshots.map(() => null), sensitivity: snapshots.map(() => null),
  };
  const context: TurnAnalysisContext = { snapshots, turnEventsIndex: allTurnEvents(replayData.log), activesForTurn: () => null, playedHistory: { p1: [], p2: [] } };
  const stall = forcedWin.delayName!;
  const count = (text: string, part: string): number => text.split(part).length - 1;

  test('the card says it once, with the stall the engine named', () => {
    const analysis = analyzeTurnAt({ turn: 1, graph, context, includeSacks: false });
    expect(analysis?.p1.forcedWin?.delayName).toBe(stall);
    const card = summarizeTurn(analysis!, [replayData.players[0], replayData.players[1]]);
    expect(count(card, `a repeated ${stall} only delays it`)).toBe(1);
    expect(card).toContain(`wins within 2 turns against every reply on the sampled rolls; a repeated ${stall} only delays it.`);
    expect(count(card, 'The winning line is Aqua Jet, which strikes first, with Heat Wave beside it.')).toBe(forcedWin.choiceNames ? 1 : 0);
  });

  // the doubles fixture is two turns long, under the three a report needs; the VGC fixture is the doubles case of the report
  test.skipIf(kind === 'doubles')('the Game review says it once, in the past tense', () => {
    const walk = computeGameReportData({ replayData, graph, context, winner: 'p1', tendencies: null });
    const summary = walk!.report.summary;
    expect(count(summary, `a repeated ${stall} only delayed it`)).toBe(1);
    expect(summary).toContain(`every reply lost within 2 turns on the sampled rolls; a repeated ${stall} only delayed it.`);
    expect(count(summary, 'The winning line was Aqua Jet, which struck first, with Heat Wave beside it.')).toBe(forcedWin.choiceNames ? 1 : 0);
  });
});
