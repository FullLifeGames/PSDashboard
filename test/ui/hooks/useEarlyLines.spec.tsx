import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EvalLine, EvalResult, EvalSettings, PlayedTurn, TurnAnalysis } from '@fulllifegames/eval-engine';
import { useEarlyLines, type EarlyLinesInputs } from '../../../src/hooks/useEarlyLines';
import type { EvalGraphState, TurnEvalSettings } from '../../../src/hooks/useEvaluation';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { singlesLine } from '../fixtures/lines';

/**
 * Round 89 (#104), step G13 (ruling G2b, kept by G7a): after the game report, one tree search per graded early singles turn keeps the
 * lines. The hook asks for the turns the report grades (matrix results without lines), one at a time, writes only `lines`, and stops
 * with a new sweep, a new replay or the user's Stop.
 */
const MATRIX: TurnEvalSettings = { depth: 1, samples: 3, mode: 'matrix' };
const TREE: TurnEvalSettings = { depth: 1, samples: 1, mode: 'mcts' };
const played: PlayedTurn = { p1: { kind: 'move', name: 'Stone Edge' }, p2: { kind: 'move', name: 'Leech Seed' } };
const LINES = [singlesLine as EvalLine];

/** Turns 3 and 7 graded on matrix results, turn 5 not graded, turn 12 graded on a tree result. */
function graphOfGame(): { graph: EvalGraphState; analyses: (TurnAnalysis | null)[] } {
  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 12 }, () => null);
  analyses[2] = turnAnalysis(3, { p1: misplayedSide('mistake') });
  analyses[4] = turnAnalysis(5);
  analyses[6] = turnAnalysis(7, { p2: misplayedSide('blunder') });
  analyses[11] = turnAnalysis(12, { p1: misplayedSide('mistake') });
  const base = evalGraph('singles');
  const results: (EvalResult | null)[] = analyses.map(() => null);
  const settings: (TurnEvalSettings | null)[] = analyses.map(() => null);
  for (const turn of [3, 5, 7]) { results[turn - 1] = evalResult('singles'); settings[turn - 1] = MATRIX; }
  results[11] = evalResult('singles'); settings[11] = TREE;
  const graph: EvalGraphState = { ...base, scores: results.map(() => 0), results, settings, played: analyses.map(() => played), running: false, progress: null };
  return { graph, analyses };
}

function setup(overrides: Partial<EarlyLinesInputs> = {}, searched?: (settings: EvalSettings) => Promise<EvalLine[]>) {
  const { graph, analyses } = graphOfGame();
  const calls: { turn: number; position: string; settings: EvalSettings }[] = [];
  let current = graph;
  const searchLines = vi.fn(async (position: string, settings: EvalSettings) => {
    calls.push({ turn: Number(position.replace('position-', '')), position, settings });
    return searched ? searched(settings) : LINES;
  });
  const cancel = vi.fn();
  const attachLines = vi.fn((turn: number, base: EvalResult, lines: EvalLine[], key: string) => {
    void key;
    // the graph in the hook's hands: one result replaced, every other field kept
    const results = [...current.results];
    results[turn - 1] = { ...base, lines };
    current = { ...current, results };
    return true;
  });
  const inputs = (): EarlyLinesInputs => ({
    replayId: 'gen9ou-1', doubles: false, analyses, graph: current, prefsMode: 'auto', tera: false, sleepClause: true, ruleset: 'standard',
    searchLines, attachLines, cancel, positionFor: async turn => `position-${turn}`, cacheKeyFor: turn => `key-${turn}`,
    ...overrides,
  });
  const hook = renderHook((props: EarlyLinesInputs) => useEarlyLines(props), { initialProps: inputs() });
  const refresh = () => act(() => hook.rerender(inputs()));
  const setRunning = (running: boolean) => { current = { ...current, running }; refresh(); };
  return { hook, calls, searchLines, attachLines, cancel, refresh, setRunning, graph: () => current, initial: graph, analyses };
}

describe('useEarlyLines', () => {
  test('searches the graded matrix turns 3 and 7 in order, with the card\'s rows, and attaches the lines of each', async () => {
    const run = setup();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(2));
    expect(run.calls.map(call => call.turn)).toEqual([3, 7]);
    expect(run.calls[0].settings).toMatchObject({ mode: 'mcts', depth: 1, samples: 1, keepPlayed: played, lineRows: { p1: ['Earthquake'], p2: ['Leech Seed'] }, lineReplies: { p1: ['Leech Seed'], p2: ['Earthquake'] } });
    expect(run.attachLines.mock.calls.map(call => [call[0], call[2], call[3]])).toEqual([[3, LINES, 'key-3'], [7, LINES, 'key-7']]);
    // the base of each attach is the stored result the search was asked for
    expect(run.attachLines.mock.calls[0][1]).toBe(run.initial.results[2]);
    expect(run.attachLines.mock.calls[1][1]).toBe(run.initial.results[6]);
  });

  test('the lines are the only field that changes: every other field of the result stays', async () => {
    const run = setup();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(2));
    const { graph } = graphOfGame();
    const after = run.graph().results[2]!;
    expect(after).toEqual({ ...graph.results[2]!, lines: LINES });
    expect(run.graph().results[4]).toEqual(graph.results[4]);
    expect(run.graph().results[11]).toEqual(graph.results[11]);
  });

  test('the progress counts the graded matrix turns that hold lines', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = setup({}, async () => { await gate; return LINES; });
    await waitFor(() => expect(run.hook.result.current.progress).toMatchObject({ done: 0, total: 2 }));
    release?.();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(2));
    run.refresh();
    await waitFor(() => expect(run.hook.result.current.progress).toBeNull());
  });

  test('a result that already holds lines (a reload, a second mount) is not searched again', async () => {
    const run = setup();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(2));
    const { graph, analyses } = { graph: run.graph(), analyses: run.analyses };
    const searchLines = vi.fn(async () => LINES);
    renderHook(() => useEarlyLines({
      replayId: 'gen9ou-1', doubles: false, analyses, graph, prefsMode: 'auto', tera: false, ruleset: 'standard',
      searchLines, attachLines: vi.fn(() => true), cancel: vi.fn(), positionFor: async turn => `position-${turn}`, cacheKeyFor: turn => `key-${turn}`,
    }));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(searchLines).not.toHaveBeenCalled();
  });

  test('a running sweep holds the stage back', async () => {
    const run = setup({ graph: { ...graphOfGame().graph, running: true } });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(run.searchLines).not.toHaveBeenCalled();
  });

  test('a sweep that starts mid-run drops the late answer', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = setup({}, async () => { await gate; return LINES; });
    await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(1));
    run.setRunning(true);
    release?.();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(run.attachLines).not.toHaveBeenCalled();
    expect(run.searchLines).toHaveBeenCalledTimes(1);
    // the sweep ends: the turns that still hold no lines are searched again
    run.setRunning(false);
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(2));
  });

  test.each([
    ['doubles', { doubles: true }],
    ['an explicit matrix mode', { prefsMode: 'matrix' as const }],
    ['an explicit tree mode', { prefsMode: 'mcts' as const }],
    ['no replay', { replayId: null }],
    ['no report yet', { analyses: null }],
  ])('%s: no search', async (_name, overrides) => {
    const run = setup(overrides);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(run.searchLines).not.toHaveBeenCalled();
    expect(run.hook.result.current.progress).toBeNull();
  });

  test('a search that fails leaves its turn without lines and the next turn goes on', async () => {
    let count = 0;
    const run = setup({}, async () => { count += 1; if (count === 1) throw new Error('worker crashed'); return LINES; });
    await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(1));
    expect(run.attachLines.mock.calls[0][0]).toBe(7);
  });

  test('a cancelled search ends the stage: the remaining turns wait for the next analysis', async () => {
    const run = setup({}, async () => { throw new Error('cancelled'); });
    await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(run.searchLines).toHaveBeenCalledTimes(1);
    expect(run.attachLines).not.toHaveBeenCalled();
    expect(run.hook.result.current.progress).toBeNull();
  });

  test('Stop asks the evaluation to cancel', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = setup({}, async () => { await gate; return LINES; });
    await waitFor(() => expect(run.hook.result.current.progress).not.toBeNull());
    act(() => run.hook.result.current.progress!.stop());
    expect(run.cancel).toHaveBeenCalledTimes(1);
    release?.();
  });
});
