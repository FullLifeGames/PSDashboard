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
 * with a new sweep, a new replay or the user's Stop. Step G14b (ruling G9a, option L): the stage covers every graded turn in Auto, tree
 * turns and doubles included, with the line pass in the search's settings; a result is done when it carries the pass.
 */
const MATRIX: TurnEvalSettings = { depth: 1, samples: 3, mode: 'matrix' };
const TREE: TurnEvalSettings = { depth: 1, samples: 1, mode: 'mcts' };
const played: PlayedTurn = { p1: { kind: 'move', name: 'Stone Edge' }, p2: { kind: 'move', name: 'Leech Seed' } };
const LINES = [singlesLine as EvalLine];
const PASSED = 300;

/** Turns 3 and 7 graded on matrix results, turn 5 not graded, turn 12 graded on a tree result (which holds the sweep's own lines). */
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
  results[11] = evalResult('singles', { lines: [] }); settings[11] = TREE;
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
    results[turn - 1] = { ...base, lines, linePass: PASSED };
    current = { ...current, results };
    return true;
  });
  const inputs = (): EarlyLinesInputs => ({
    replayId: 'gen9ou-1', analyses, graph: current, prefsMode: 'auto', tera: false, sleepClause: true, ruleset: 'standard',
    searchLines, attachLines, cancel, positionFor: async turn => `position-${turn}`, cacheKeyFor: turn => `key-${turn}`,
    ...overrides,
  });
  const hook = renderHook((props: EarlyLinesInputs) => useEarlyLines(props), { initialProps: inputs() });
  const refresh = () => act(() => hook.rerender(inputs()));
  const setRunning = (running: boolean) => { current = { ...current, running }; refresh(); };
  return { hook, calls, searchLines, attachLines, cancel, refresh, setRunning, graph: () => current, initial: graph, analyses };
}

describe('useEarlyLines', () => {
  test('searches the graded turns 3, 7 and 12 in order, with the card\'s rows and the line pass, and attaches the lines of each', async () => {
    const run = setup();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
    expect(run.calls.map(call => call.turn)).toEqual([3, 7, 12]);
    expect(run.calls[0].settings).toMatchObject({ mode: 'mcts', depth: 1, samples: 1, linePass: 300, keepPlayed: played, lineRows: { p1: ['Earthquake'], p2: ['Leech Seed'] }, lineReplies: { p1: ['Leech Seed'], p2: ['Earthquake'] } });
    expect(run.attachLines.mock.calls.map(call => [call[0], call[2], call[3]])).toEqual([[3, LINES, 'key-3'], [7, LINES, 'key-7'], [12, LINES, 'key-12']]);
    // the base of each attach is the stored result the search was asked for
    expect(run.attachLines.mock.calls[0][1]).toBe(run.initial.results[2]);
    expect(run.attachLines.mock.calls[1][1]).toBe(run.initial.results[6]);
    expect(run.attachLines.mock.calls[2][1]).toBe(run.initial.results[11]);
  });

  test('the lines are the only field that changes: every other field of the result stays', async () => {
    const run = setup();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
    const { graph } = graphOfGame();
    const after = run.graph().results[2]!;
    expect(after).toEqual({ ...graph.results[2]!, lines: LINES, linePass: PASSED });
    expect(run.graph().results[11]).toEqual({ ...graph.results[11]!, lines: LINES, linePass: PASSED });
    // the turn nobody grades keeps its result
    expect(run.graph().results[4]).toEqual(graph.results[4]);
  });

  test('the progress counts the graded turns that had the pass', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const run = setup({}, async () => { await gate; return LINES; });
    await waitFor(() => expect(run.hook.result.current.progress).toMatchObject({ done: 0, total: 3 }));
    release?.();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
    run.refresh();
    await waitFor(() => expect(run.hook.result.current.progress).toBeNull());
  });

  test('a result that carries the pass (a reload, a second mount) is not searched again', async () => {
    const run = setup();
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
    const { graph, analyses } = { graph: run.graph(), analyses: run.analyses };
    const searchLines = vi.fn(async () => LINES);
    renderHook(() => useEarlyLines({
      replayId: 'gen9ou-1', analyses, graph, prefsMode: 'auto', tera: false, ruleset: 'standard',
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
    // the sweep ends: the turns that have not had the pass are searched again
    run.setRunning(false);
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
  });

  test('a doubles game (every turn a tree turn that holds the sweep\'s lines) is searched for its graded turns too', async () => {
    const { graph, analyses } = graphOfGame();
    const doubles = {
      ...graph, results: graph.results.map(result => result && evalResult('doubles', { lines: LINES })),
      settings: graph.settings.map(entry => entry && TREE),
    };
    const run = setup({ analyses, graph: doubles });
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
    expect(run.calls.map(call => call.turn)).toEqual([3, 7, 12]);
    expect(run.calls[0].settings).toMatchObject({ mode: 'mcts', linePass: 300 });
  });

  test.each([
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
    await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(2));
    expect(run.attachLines.mock.calls.map(call => call[0])).toEqual([7, 12]);
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

  describe('the window handle of the feedback harness (`__psEarlyLines`)', () => {
    type Handle = { active: boolean; done: number; total: number } | undefined;
    const handle = () => (window as Window & { __psEarlyLines?: Handle }).__psEarlyLines;

    test('active from the render that ends the sweep until the last turn holds its lines, so a dump taken then is the same every run', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const run = setup({}, async () => { await gate; return LINES; });
      // before the first search even starts (the effect's own await): the stage is already named active
      expect(handle()).toMatchObject({ active: true, done: 0, total: 3 });
      await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(1));
      expect(handle()?.active).toBe(true);
      release?.();
      await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
      run.refresh();
      await waitFor(() => expect(handle()).toMatchObject({ active: false, done: 3, total: 3 }));
    });

    test('inactive while a sweep runs (the sweep is waited for by its own flag)', async () => {
      const run = setup({ graph: { ...graphOfGame().graph, running: true } });
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(run.searchLines).not.toHaveBeenCalled();
      expect(handle()?.active).toBe(false);
    });

    test('a turn whose search failed ends the stage: inactive although that turn holds no lines', async () => {
      const run = setup({}, async () => { throw new Error('worker crashed'); });
      await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(handle()?.active).toBe(false));
      expect(run.attachLines).not.toHaveBeenCalled();
    });

    test('a cancelled search (Stop) ends the stage: inactive with the turns left', async () => {
      const run = setup({}, async () => { throw new Error('cancelled'); });
      await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(handle()?.active).toBe(false));
    });

    test.each([
      ['an explicit matrix mode', { prefsMode: 'matrix' as const }],
      ['no report yet', { analyses: null }],
    ])('%s: never active', async (_name, overrides) => {
      setup(overrides);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(handle()?.active).toBe(false);
    });

    test('a new sweep that ends starts the stage again: active once more', async () => {
      const run = setup({}, async () => { throw new Error('worker crashed'); });
      await waitFor(() => expect(handle()?.active).toBe(false));
      run.setRunning(true);
      run.setRunning(false);
      expect(handle()?.active).toBe(true);
    });
  });

  // Round 89 (G13b, tester, third pass): the card of a turn that was about to get its lines said "the matrix pass keeps none. Analyze the
  // position with MCTS". The stage names the turns it will search and the sweep says lines may follow.
  describe('lineComing: what a turn without lines waits for', () => {
    test('a graded turn the stage has not reached (matrix or tree) waits for the stage; one it has searched, or one nobody grades, waits for nothing', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const run = setup({}, async () => { await gate; return LINES; });
      await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(1));
      expect(run.hook.result.current.lineComing(3)).toBe('stage');
      expect(run.hook.result.current.lineComing(7)).toBe('stage');
      expect(run.hook.result.current.lineComing(5)).toBeNull();
      expect(run.hook.result.current.lineComing(12)).toBe('stage');
      release?.();
      await waitFor(() => expect(run.attachLines).toHaveBeenCalledTimes(3));
      run.refresh();
      await waitFor(() => expect(run.hook.result.current.lineComing(3)).toBeNull());
      expect(run.hook.result.current.lineComing(7)).toBeNull();
      expect(run.hook.result.current.lineComing(12)).toBeNull();
    });

    test('while the sweep runs in Auto, a matrix turn may get lines after the report; a tree turn and the other modes wait for nothing', async () => {
      const running = { ...graphOfGame().graph, running: true };
      const auto = setup({ graph: running });
      expect(auto.hook.result.current.lineComing(5)).toBe('sweep');
      expect(auto.hook.result.current.lineComing(12)).toBeNull();
      expect(setup({ graph: running, prefsMode: 'matrix' }).hook.result.current.lineComing(5)).toBeNull();
      expect(setup({ graph: running, replayId: null }).hook.result.current.lineComing(5)).toBeNull();
    });

    test('a stage that ended (a failed turn, a Stop) leaves its turns waiting for the next analysis, not for the stage', async () => {
      const run = setup({}, async () => { throw new Error('worker crashed'); });
      await waitFor(() => expect(run.searchLines).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(run.hook.result.current.lineComing(3)).toBeNull());
    });
  });
});
