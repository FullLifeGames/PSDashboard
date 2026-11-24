import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { EvalPanel } from '../../../src/components/EvalPanel';
import { evalGraph, evalResult, gameReport } from '../fixtures/eval-result';
import { turnAnalysis } from '../fixtures/analysis';

const names: [string, string] = ['Alice', 'Bob'];
const prefs: EvalPreferences = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };
const emptyGraph = () => evalGraph('singles', {
  scores: [], results: [], settings: [], faintedFractions: [], played: [], playedOutcome: [], verified: [], sensitivity: [], evalErrors: [],
});

type Props = Parameters<typeof EvalPanel>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    playerNames: names, status: 'idle', result: null, progress: null, reconstructProgress: null, error: null, prefs,
    onPrefsChange: vi.fn(), onCancel: vi.fn(), showAuto: false, showTera: true, graph: emptyGraph(), currentTurn: 1, analysis: null,
    ...overrides,
  };
}

describe('EvalPanel', () => {
  test('branch mode: header, position label, and the single result with clickable lines; no graph section without a sweep', async () => {
    const onPickChoice = vi.fn();
    const result = evalResult();
    const wired = props({ status: 'done', result, onEvaluate: vi.fn(), showAuto: true, positionLabel: 'Turn 3 · variation', onPickChoice, resultSettings: { depth: 1, samples: 1, mode: 'matrix' } });
    render(<EvalPanel {...wired} />);
    expect(screen.getByText('Evaluation')).toBeInTheDocument();
    expect(screen.queryByText('Game graph')).toBeNull();
    expect(screen.getByText('Turn 3 · variation')).toBeInTheDocument();
    expect(screen.getByText('depth 1 · 1 sample')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Earthquake/ }));
    expect(onPickChoice).toHaveBeenCalledWith('p1', result.perSide.p1[0], result.perSide.p2[0], result);
    expect(screen.queryByText('Depth')).toBeNull();
    await userEvent.selectOptions(within(screen.getByText('Tera')).getByRole('combobox'), 'on');
    expect(wired.onPrefsChange).toHaveBeenCalledWith({ ...prefs, tera: 'on' });
  });

  test.each([['singles'], ['doubles']] as const)('the ranked rows (%s) name the reply by the hardMode preference', kind => {
    const wired = props({ status: 'done', result: evalResult(kind), onPickChoice: vi.fn() });
    const { rerender } = render(<EvalPanel {...wired} />);
    expect(document.querySelector('button.ps-eval-choice')).toHaveAttribute('title', expect.stringContaining('the opponent plays its top choice.'));
    rerender(<EvalPanel {...wired} prefs={{ ...prefs, hardMode: true }} />);
    expect(document.querySelector('button.ps-eval-choice')).toHaveAttribute('title', expect.stringContaining('the opponent reads your move and plays the reply'));
  });

  // Evaluate at a finished variation showed a 100 % bar and an empty line list. The panel says who won, as the branch panel does; the end
  // of a game reads the same in singles and doubles.
  test('at a finished variation the panel names the winner instead of a bar and empty lines, and offers no Evaluate', () => {
    const stale = evalResult('singles', { score: 1, perSide: { p1: [], p2: [] } });
    const { rerender } = render(<EvalPanel {...props({ status: 'done', result: stale, onEvaluate: vi.fn(), showAuto: true, positionLabel: 'Turn 21 · variation', ended: { winner: 'Alice' } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Alice wins this variation.');
    expect(screen.queryByRole('img', { name: /Advantage estimate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /valuate/ })).toBeNull();
    expect(screen.queryByText('Position changed; re-evaluate.')).toBeNull();

    rerender(<EvalPanel {...props({ status: 'stale', result: stale, onEvaluate: vi.fn(), showAuto: true, ended: { winner: null } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('The variation ended without a winner.');
    expect(screen.queryByText('Position changed; re-evaluate.')).toBeNull();

    rerender(<EvalPanel {...props({ status: 'done', result: evalResult(), onEvaluate: vi.fn(), showAuto: true, ended: null })} />);
    expect(screen.getByRole('img', { name: /Advantage estimate/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeInTheDocument();
    expect(screen.queryByText(/wins this variation/)).toBeNull();
  });

  test('searching shows the progress, an error the alert; stale results lose their click handlers', () => {
    const { rerender } = render(<EvalPanel {...props({ status: 'searching', progress: { done: 10, total: 40, depth: 1 } })} />);
    expect(screen.getByText('Searching… depth 1')).toBeInTheDocument();
    rerender(<EvalPanel {...props({ status: 'error', error: 'worker died' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Evaluation failed: worker died');
    rerender(<EvalPanel {...props({ status: 'stale', result: evalResult(), onPickChoice: vi.fn() })} />);
    expect(screen.getByText('Position changed; re-evaluate.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Earthquake/ })).toBeNull();
  });

  test.each([['singles'], ['doubles']] as const)('%s: a stopped search says so, keeps its rows playable and never claims the position changed', async kind => {
    const onPickChoice = vi.fn();
    const result = evalResult(kind, { depthCompleted: 1 });
    const { rerender } = render(<EvalPanel {...props({ status: 'stale', result, stoppedAt: 1, onPickChoice })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Search stopped. Showing the quick estimate.');
    expect(screen.queryByText('Position changed; re-evaluate.')).toBeNull();
    expect(document.querySelector('.ps-eval-stale')).toBeNull();
    await userEvent.click(document.querySelector('button.ps-eval-choice')!);
    expect(onPickChoice).toHaveBeenCalledTimes(1);
    rerender(<EvalPanel {...props({ status: 'stale', result, stoppedAt: 3, onPickChoice })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Search stopped. Showing the result so far.');
    rerender(<EvalPanel {...props({ status: 'stale', result, onPickChoice })} />);
    expect(screen.getByText('Position changed; re-evaluate.')).toBeInTheDocument();
    expect(document.querySelector('.ps-eval-stale')).not.toBeNull();
  });

  // A stop before any partial result (a tree search before its first interim result) leaves no card; the panel says why.
  test.each([['singles', false], ['doubles', true]] as const)('%s: a search stopped before a first result says so beside Evaluate, and only then', (_kind, doubles) => {
    const onEvaluate = vi.fn();
    const { rerender } = render(<EvalPanel {...props({ status: 'idle', result: null, doubles, onEvaluate, stoppedEmpty: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Search stopped before a first result.');
    expect(screen.getByRole('button', { name: /Evaluate/ })).toBeInTheDocument();
    rerender(<EvalPanel {...props({ status: 'idle', result: null, doubles, onEvaluate })} />);
    expect(screen.queryByText(/Search stopped/)).toBeNull();
    rerender(<EvalPanel {...props({ status: 'searching', result: null, doubles, onEvaluate, stoppedEmpty: true })} />);
    expect(screen.queryByText(/Search stopped/)).toBeNull();
  });

  test('replay view: the report is the overview; a card or a navigation opens the turn view, with a way back', async () => {
    const onSelectTurn = vi.fn();
    const onAnalyzeTurn = vi.fn();
    const onAnalyzeGame = vi.fn();
    const graph = evalGraph();
    const report = gameReport({ keyMoments: [turnAnalysis(6, { attribution: 'chance', swing: -0.4 })] });
    const wired = props({
      graph, report, analysis: turnAnalysis(3), onSelectTurn, onAnalyzeGame, onAnalyzeTurn, analyzeTarget: { depth: 2, samples: 1, mode: 'matrix' },
      result: graph.results[2], resultSettings: graph.settings[2], currentTurn: 3, analysisTurn: 3, graphMaxTurn: 12,
    });
    const { rerender } = render(<EvalPanel {...wired} />);
    expect(screen.getByText('Game report', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Evaluation over 10 turns/ })).toBeInTheDocument();
    expect(screen.queryByText('Turn 3')).toBeNull();
    expect(screen.queryByRole('button', { name: /Think deeper/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^T6(?!\d)/ }));
    expect(onSelectTurn).toHaveBeenCalledWith(6, undefined);
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.getByText('depth 1 · 1 sample')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Think deeper/ })).toBeNull();
    expect(onAnalyzeTurn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '← Game report' }));
    expect(screen.getByText('Game report', { selector: 'span' })).toBeInTheDocument();

    rerender(<EvalPanel {...wired} analysisTurn={4} currentTurn={4} analysis={turnAnalysis(4)} result={graph.results[3]} />);
    expect(screen.getByText('Turn 4')).toBeInTheDocument();
    await userEvent.click(document.querySelector('rect[data-turn="5"]')!);
    expect(onSelectTurn).toHaveBeenLastCalledWith(5, 'main');
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));
    expect(onAnalyzeGame).toHaveBeenCalledTimes(1);
  });

  // "Back to the main line" from a played win path opened the last turn's card, not the Game review the click came from. The panel returns
  // to where the line was started: the review (from the review or the win-path panel), the card of its turn (from a card).
  describe.each([['singles', false], ['doubles', true]])('%s: back from a variation', (_kind, doubles) => {
    const graph = evalGraph(doubles ? 'doubles' : 'singles');
    const report = gameReport({ keyMoments: [turnAnalysis(6, { attribution: 'chance', swing: -0.4 })] });
    const replay = (extra: Partial<Props> = {}) => props({
      graph, report, analysis: turnAnalysis(3), onSelectTurn: vi.fn(), onAnalyzeGame: vi.fn(), result: graph.results[2], resultSettings: graph.settings[2],
      currentTurn: 3, analysisTurn: 3, graphMaxTurn: 12, doubles, ...extra,
    });
    const inLine = (extra: Partial<Props> = {}) => replay({ report: null, currentLine: 'variation', variation: { startTurn: 3, scores: [null, 0.4] }, ...extra });

    test('a line started from the review returns to the review, although the main line moves to another turn on the way back', async () => {
      const back = vi.fn();
      const { rerender } = render(<EvalPanel {...replay()} />);
      expect(screen.getByText('Game report', { selector: 'span' })).toBeInTheDocument();
      rerender(<EvalPanel {...inLine({ onBackToMain: back })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Back to the main line' }));
      expect(back).toHaveBeenCalledWith(null);
      // the report is back and the analysis turn moved in the same render (the main line's last turn)
      rerender(<EvalPanel {...replay({ analysisTurn: 12, currentTurn: 12, analysis: turnAnalysis(12) })} />);
      expect(screen.getByText('Game report', { selector: 'span' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '← Game report' })).toBeNull();
      rerender(<EvalPanel {...replay({ analysisTurn: 4, currentTurn: 4, analysis: turnAnalysis(4) })} />);
      expect(screen.getByRole('button', { name: '← Game report' })).toBeInTheDocument();
    });

    test('a line started from a card returns to the card of its turn', async () => {
      const back = vi.fn();
      const { rerender } = render(<EvalPanel {...replay()} />);
      await userEvent.click(screen.getByRole('button', { name: /^T6(?!\d)/ }));
      expect(screen.getByRole('button', { name: '← Game report' })).toBeInTheDocument();
      rerender(<EvalPanel {...inLine({ onBackToMain: back })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Back to the main line' }));
      expect(back).toHaveBeenCalledWith(3);
      rerender(<EvalPanel {...replay()} />);
      expect(screen.getByRole('button', { name: '← Game report' })).toBeInTheDocument();
      expect(screen.getByText('Turn 3')).toBeInTheDocument();
    });
  });

  test('the open tip of a game names an open position in the turn view; the same turn of a replay keeps its card', () => {
    const graph = evalGraph();
    const base = props({ graph, analysis: turnAnalysis(4), result: graph.results[3], resultSettings: graph.settings[3], currentTurn: 4, analysisTurn: 4, graphMaxTurn: 12, onSelectTurn: vi.fn(), onAnalyzeGame: vi.fn() });
    const { rerender } = render(<EvalPanel {...base} />);
    expect(screen.queryByText('open position: nothing played yet')).toBeNull();
    rerender(<EvalPanel {...base} openTurn={4} />);
    expect(screen.getByText('open position: nothing played yet')).toBeInTheDocument();
    rerender(<EvalPanel {...base} openTurn={5} />);
    expect(screen.queryByText('open position: nothing played yet')).toBeNull();
  });

  test('a gap turn of the replay view offers its analysis at the named settings', async () => {
    const onAnalyzeTurn = vi.fn();
    const graph = evalGraph('singles', { scores: [0.1, null, 0.2], results: [evalResult(), null, evalResult()], settings: [null, null, null], faintedFractions: [0, null, 0.1] });
    render(<EvalPanel {...props({
      graph, analysis: null, onSelectTurn: vi.fn(), onAnalyzeGame: vi.fn(), onAnalyzeTurn, analyzeTarget: { depth: 1, samples: 3, mode: 'matrix' },
      result: null, currentTurn: 2, analysisTurn: 2, graphMaxTurn: 3,
    })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Analyze this position (depth 1)' }));
    expect(onAnalyzeTurn).toHaveBeenCalledTimes(1);
  });

  test('a running play-out replaces the result block; Smogon pending disables the sweep; a variation alone still shows the graph', () => {
    const { rerender } = render(<EvalPanel {...props({ graph: evalGraph(), result: evalResult(), onAnalyzeGame: vi.fn(), smogonPending: true, playOutProgress: { startTurn: 4, turns: 2, atTurn: 6 } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Engine is playing both sides from turn 4. 2 turns played, now at turn 6.');
    expect(document.querySelector('.ps-eval-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeDisabled();

    rerender(<EvalPanel {...props({ variation: { startTurn: 2, scores: [null, null, 0.3] }, graphMaxTurn: 8, currentLine: 'variation', currentTurn: 3 })} />);
    expect(screen.getByText('Game graph')).toBeInTheDocument();
    expect(screen.getByText(/Gold = your variation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Analyze game/ })).toBeNull();
  });
});
