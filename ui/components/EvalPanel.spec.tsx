import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { EvalPanel } from '../../src/components/EvalPanel';
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
    expect(onPickChoice).toHaveBeenCalledWith('p1', result.perSide.p1[0], result.perSide.p2[0]);
    await userEvent.selectOptions(within(screen.getByText('Depth')).getByRole('combobox'), '2');
    expect(wired.onPrefsChange).toHaveBeenCalledWith({ ...prefs, mode: 'matrix', depth: 2 });
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

  test('replay view: the report is the overview; a card or a navigation opens the turn view, with a way back', async () => {
    const onSelectTurn = vi.fn();
    const onThinkDeeper = vi.fn();
    const onAnalyzeGame = vi.fn();
    const graph = evalGraph();
    const report = gameReport({ keyMoments: [turnAnalysis(6, { attribution: 'chance', swing: -0.4 })] });
    const wired = props({
      graph, report, analysis: turnAnalysis(3), onSelectTurn, onAnalyzeGame, onThinkDeeper, thinkDeeperTarget: { depth: 2, samples: 1, mode: 'matrix' },
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
    await userEvent.click(screen.getByRole('button', { name: 'Think deeper about this position (depth 2)' }));
    expect(onThinkDeeper).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '← Game report' }));
    expect(screen.getByText('Game report', { selector: 'span' })).toBeInTheDocument();

    // The slider, the arrows, or the T0 button move the analysis turn: that opens the turn view by itself.
    rerender(<EvalPanel {...wired} analysisTurn={4} currentTurn={4} analysis={turnAnalysis(4)} result={graph.results[3]} />);
    expect(screen.getByText('Turn 4')).toBeInTheDocument();
    await userEvent.click(document.querySelector('rect[data-turn="5"]')!);
    expect(onSelectTurn).toHaveBeenLastCalledWith(5, 'main');
    await userEvent.click(screen.getByRole('button', { name: 'Re-analyze' }));
    expect(onAnalyzeGame).toHaveBeenCalledTimes(1);
  });

  test('a running play-out replaces the result block; Smogon pending disables the sweep; a variation alone still shows the graph', () => {
    const { rerender } = render(<EvalPanel {...props({ graph: evalGraph(), result: evalResult(), onAnalyzeGame: vi.fn(), smogonPending: true, playOutProgress: { startTurn: 4, turns: 2, atTurn: 6 } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Engine is playing both sides from turn 4 — 2 turns played, now at turn 6.');
    expect(document.querySelector('.ps-eval-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeDisabled();

    rerender(<EvalPanel {...props({ variation: { startTurn: 2, scores: [null, null, 0.3] }, graphMaxTurn: 8, currentLine: 'variation', currentTurn: 3 })} />);
    expect(screen.getByText('Game graph')).toBeInTheDocument();
    expect(screen.getByText(/Gold = your variation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Analyze game/ })).toBeNull();
  });
});
