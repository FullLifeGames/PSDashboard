import { beforeEach, describe, expect, test, vi } from 'vitest';
import { allTurnEvents, type BiggestRoll, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';

/**
 * Round 86 (T304): the report's walk and the sweep's last stage read one set of analyses. The walk hands the graph's `rollFlip` (the
 * engine's score of the next root with the biggest roll's die turned over) to the report; the stage asks the same walk for the roll to
 * play (`namedRollOf`), with the replay's winner and the dice turns the report reads.
 */

const seen = vi.hoisted(() => ({
  report: [] as unknown[][],
  roll: [] as unknown[][],
  named: null as unknown,
}));

vi.mock('@fulllifegames/eval-engine', async importOriginal => {
  const actual = await importOriginal<typeof import('@fulllifegames/eval-engine')>();
  return {
    ...actual,
    buildGameReport: (...args: Parameters<typeof actual.buildGameReport>) => {
      seen.report.push(args);
      return actual.buildGameReport(...args);
    },
    rollToCopy: (...args: Parameters<typeof actual.rollToCopy>) => {
      seen.roll.push(args);
      return seen.named as BiggestRoll | null;
    },
  };
});

const { buildAnalysisContext, computeGameReportData, namedRollOf, replayWinnerOf } = await import('../../../src/lib/analysis-context');

const { replayData: finished, snapshots } = replayFixture('singles');
/** The fixture log's win line (if any) goes; the winner is the first player. */
const replayData = { ...finished, log: `${finished.log.replace(/\n\|win\|.*/, '')}\n|win|${finished.players[0]}` };
const turns = snapshots.length;
const scores = evalGraph('singles').scores.slice(0, turns);
const graph = {
  scores, results: scores.map(score => evalResult('singles', { score })),
  played: scores.map(() => null), playedOutcome: scores.map(() => null),
  verified: scores.map(() => null), sensitivity: scores.map(() => null),
};
const context = buildAnalysisContext({
  snapshots, turnEventsIndex: allTurnEvents(replayData.log), graphPlayed: graph.played, replayGen: 9, mod: undefined,
});
const roll: BiggestRoll = { turn: 2, side: 'p1', winner: 'p2', amount: 0.3, move: 'Fire Fang', accuracy: 0.95, after: { score: -0.6 } };

beforeEach(() => {
  seen.report = [];
  seen.roll = [];
  seen.named = roll;
});

describe('the report walk and the sweep\'s biggest-roll stage', () => {
  test('the walk hands the graph\'s flip to the report, and null where the graph holds none', () => {
    const flip = { turn: 2, score: -0.9 };
    computeGameReportData({ replayData, graph: { ...graph, rollFlip: flip }, context, winner: 'p1', tendencies: null });
    computeGameReportData({ replayData, graph, context, winner: 'p1', tendencies: null });
    computeGameReportData({ replayData, graph: { ...graph, rollFlip: null }, context, winner: 'p1', tendencies: null });
    expect(seen.report.map(args => args[5])).toEqual([flip, null, null]);
  });

  test('the stage asks for the roll with the replay\'s winner and the dice turns of the report', () => {
    const winner = replayWinnerOf(replayData);
    expect(winner).not.toBeNull();
    expect(namedRollOf({ replayData, graph, context, tendencies: null })).toBe(roll);
    expect(seen.roll).toHaveLength(1);
    const [known, side, diceTurns] = seen.roll[0] as [TurnAnalysis[], string, ReadonlySet<number>];
    expect(side).toBe(winner);
    expect(known.every(Boolean)).toBe(true);
    const walk = computeGameReportData({ replayData, graph, context, winner, tendencies: null })!;
    expect(known).toEqual(walk.analyses.filter(Boolean));
    expect(diceTurns).toEqual(seen.report[0][4]);
  });

  test('a replay with no recorded winner, or a graph too short for a report, names no roll', () => {
    expect(namedRollOf({ replayData: { ...replayData, log: replayData.log.replace(/\n\|win\|.*/, '') }, graph, context, tendencies: null })).toBeNull();
    const short = { ...graph, results: graph.results.map((_, index) => (index < 2 ? graph.results[index] : null)) };
    expect(namedRollOf({ replayData, graph: short, context, tendencies: null })).toBeNull();
    expect(seen.roll).toHaveLength(0);
  });
});
