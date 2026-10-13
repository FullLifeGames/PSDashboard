import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { finalPlayedTurn } from '@fulllifegames/replay-core';
import { useGameAnalysis } from '../../src/hooks/useGameAnalysis';
import type { useEvaluation } from '../../src/hooks/useEvaluation';
import { evalGraph } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';

type Evaluation = ReturnType<typeof useEvaluation>;
type Inputs = Parameters<typeof useGameAnalysis>[0];

const { replayData, snapshots } = replayFixture('singles');
const turns = finalPlayedTurn(snapshots);

/** A finished sweep cut to the replay's played turns. */
function sweptGraph(overrides: Partial<Evaluation['graph']> = {}): Evaluation['graph'] {
  const full = evalGraph('singles');
  const cut = <T,>(list: T[]) => list.slice(0, turns);
  return {
    ...full,
    scores: cut(full.scores), results: cut(full.results), settings: cut(full.settings), faintedFractions: cut(full.faintedFractions),
    played: cut(full.played), playedOutcome: cut(full.playedOutcome), verified: cut(full.verified), sensitivity: cut(full.sensitivity),
    evalErrors: cut(full.evalErrors),
    ...overrides,
  };
}

const evaluationWith = (graph: Evaluation['graph']) => ({ graph }) as unknown as Evaluation;

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return { replayData, snapshots, evaluation: evaluationWith(sweptGraph()), analysisTurn: null, sweepAlignment: null, replayGen: 9, ...overrides };
}

describe('the graph shares (round 69, T51: the graph and the card read one map in every engine mode)', () => {
  test.each(['singles', 'doubles'] as const)('%s: a matrix or MCTS sweep records no shares, the graph still gets the share of the card for every turn', kind => {
    const fixture = replayFixture(kind);
    const last = finalPlayedTurn(fixture.snapshots);
    const full = evalGraph(kind);
    const unrecorded = sweptGraph({
      scores: full.scores.slice(0, last), results: full.results.slice(0, last),
      faintedFractions: full.scores.slice(0, last).map(() => null),
    });
    const graph = { ...unrecorded, played: unrecorded.scores.map(() => null) };
    const base = { replayData: fixture.replayData, snapshots: fixture.snapshots, evaluation: evaluationWith(graph), sweepAlignment: null, replayGen: 9 };
    const { result: overview } = renderHook(() => useGameAnalysis({ ...base, analysisTurn: null }));
    const shares = overview.current.faintedShares;
    expect(shares).toHaveLength(last);
    expect(shares.every(share => share !== null)).toBe(true);
    // The short doubles fixture has no faint before its last turn: only the singles game holds a share above the opening one.
    if (kind === 'singles') expect(Math.max(...shares.map(share => share ?? 0))).toBeGreaterThan(0);
    for (const turn of [1, Math.ceil(last / 2), last]) {
      const { result } = renderHook(() => useGameAnalysis({ ...base, analysisTurn: turn }));
      expect(shares[turn - 1]).toBe(result.current.turnAnalysis?.faintedFraction);
    }
  });
});

describe('useGameAnalysis', () => {
  test('a finished sweep yields the game report and no turn analysis without a selected turn', () => {
    // Stable inputs: the report memo keys on the graph object, as the app's state does.
    const props = inputs();
    const { result } = renderHook(() => useGameAnalysis(props));
    expect(turns).toBeGreaterThan(1);
    expect(result.current.turnAnalysis).toBeNull();
    expect(result.current.turnReads).toBeNull();
    expect(result.current.leadAnalysisData).toBeNull();
    const report = result.current.gameReport;
    expect(report).not.toBeNull();
    expect(typeof report!.summary).toBe('string');
    expect(['p1', 'p2', null]).toContain(report!.winner);
    // The feedback harness reads the same objects through the window handle.
    const debug = (window as Window & { __psDebug?: { gameReport: unknown } }).__psDebug;
    expect(debug?.gameReport).toBe(report);
  });

  test('the selected turn is analyzed against the sweep', () => {
    const graph = sweptGraph();
    const { result, rerender } = renderHook((props: Inputs) => useGameAnalysis(props), { initialProps: inputs({ evaluation: evaluationWith(graph), analysisTurn: 2 }) });
    expect(result.current.turnAnalysis?.turn).toBe(2);
    expect(result.current.turnAnalysis?.scoreBefore).toBe(graph.scores[1]);
    rerender(inputs({ evaluation: evaluationWith(graph), analysisTurn: 1 }));
    expect(result.current.turnAnalysis?.turn).toBe(1);
  });

  test('while the sweep runs the last report stays up instead of blinking away', () => {
    const done = evaluationWith(sweptGraph());
    const running = evaluationWith(sweptGraph({ running: true }));
    const { result, rerender } = renderHook((props: Inputs) => useGameAnalysis(props), { initialProps: inputs({ evaluation: running }) });
    expect(result.current.gameReport).toBeNull();

    rerender(inputs({ evaluation: done }));
    const report = result.current.gameReport;
    expect(report).not.toBeNull();

    rerender(inputs({ evaluation: running }));
    expect(result.current.gameReport).toBe(report);
  });

  test('without a replay there is nothing to report', () => {
    const props = inputs({ replayData: null, snapshots: [], analysisTurn: 2 });
    const { result } = renderHook(() => useGameAnalysis(props));
    expect(result.current.gameReport).toBeNull();
  });
});
