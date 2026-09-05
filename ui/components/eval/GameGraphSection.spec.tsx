import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { GameGraphSection, type GameGraphSectionProps } from '../../../src/components/eval/GameGraphSection';
import { evalGraph, evalResult, gameReport } from '../../fixtures/eval-result';
import { leadAnalysis, turnAnalysis } from '../../fixtures/analysis';

const names: [string, string] = ['Alice', 'Bob'];
const prefs: EvalPreferences = { depth: 2, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };
const emptyGraph = () => evalGraph('singles', {
  scores: [], results: [], settings: [], faintedFractions: [], played: [], playedOutcome: [], verified: [], sensitivity: [], evalErrors: [],
});

function props(overrides: Partial<GameGraphSectionProps> = {}): GameGraphSectionProps {
  return {
    onAnalyzeGame: vi.fn(), onCancel: vi.fn(), running: false, hasGraph: true, prefs, graph: evalGraph(), playerNames: names,
    currentTurn: 3, selectTurn: vi.fn(), showReportView: false, onBackToReport: vi.fn(), result: evalResult(), thinkDeeper: null,
    hasThinkDeeper: false, analysis: null, ...overrides,
  };
}

describe('GameGraphSection', () => {
  test('the header offers Analyze game, then Re-analyze, Cancel while sweeping; the line hint names the configured engine', async () => {
    const wired = props({ hasGraph: false, graph: emptyGraph() });
    const { rerender } = render(<GameGraphSection {...wired} />);
    expect(screen.getByText('Game graph')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze game' }));
    expect(wired.onAnalyzeGame).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^line:/)).toHaveTextContent('line: fast scan, then depth 2 everywhere · deeper: per turn');
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<GameGraphSection {...wired} hasGraph graph={evalGraph()} />);
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Evaluation over 10 turns/ })).toBeInTheDocument();
    expect(screen.getByText('Click a point for that turn\'s analysis; its movement lights up on the line.')).toBeInTheDocument();
    await userEvent.click(document.querySelector('rect[data-turn="5"]')!);
    expect(wired.selectTurn).toHaveBeenCalledWith(5, 'main');

    rerender(<GameGraphSection {...wired} hasGraph graph={evalGraph('singles', { running: true, progress: { done: 4, total: 10 } })} prefs={{ ...prefs, mode: 'auto' }} />);
    expect(screen.getByText('analyzing… turn 4/10')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(wired.onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^line:/)).toHaveTextContent('then auto (matrix early, MCTS late) everywhere');

    rerender(<GameGraphSection {...wired} hasGraph smogonPending prefs={{ ...prefs, mode: 'mcts' }} />);
    const analyze = screen.getByRole('button', { name: 'Re-analyze' });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAttribute('title', expect.stringMatching(/^Waiting for Smogon data/));
    expect(screen.getByText(/^line:/)).toHaveTextContent('then MCTS everywhere');
  });

  test('the notice, the gap-turn reason with its escalation control, and the variation-only hint explain partial lines', () => {
    const evalErrors = evalGraph().evalErrors;
    evalErrors[2] = 'no legal choices';
    const graph = evalGraph('singles', { notice: 'Reconstruction diverged at turn 6; the line stops there.', evalErrors });
    const { rerender } = render(<GameGraphSection {...props({ graph, currentTurn: 3, result: null, hasThinkDeeper: true, thinkDeeper: <button type="button">deeper</button> })} />);
    const notices = screen.getAllByRole('status');
    expect(notices[0]).toHaveTextContent('⚠ Reconstruction diverged at turn 6; the line stops there.');
    expect(notices[1]).toHaveTextContent('⚠ This turn could not be evaluated: no legal choices');
    expect(screen.getByRole('button', { name: 'deeper' })).toBeInTheDocument();

    rerender(<GameGraphSection {...props({ hasGraph: false, graph: emptyGraph(), variation: { startTurn: 2, scores: [null, null, 0.3] }, graphMaxTurn: 8 })} />);
    expect(screen.getByText('Gold = your variation. The main line has no curve yet; Analyze game fills it for comparison.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Evaluation over 0 turns/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('the report view shows the cards with the sweep\'s settings badges; the turn view shows the analysis with a way back', async () => {
    const misplays = [{ turn: 3, side: 'p1' as const, regret: 0.3, played: 'Stone Edge', better: 'Earthquake', tier: 'mistake' as const }];
    const wired = props({ showReportView: true, report: gameReport({ misplays }), analysis: turnAnalysis(3) });
    const { rerender } = render(<GameGraphSection {...wired} />);
    expect(screen.getByText('Game report')).toBeInTheDocument();
    expect(screen.queryByText('Turn 3')).toBeNull();
    const chip = screen.getByRole('button', { name: /^T3(?!\d)/ });
    expect(within(chip).getByText('d1')).toHaveAttribute('title', expect.stringContaining('(fast scan)'));
    await userEvent.click(chip);
    expect(wired.selectTurn).toHaveBeenCalledWith(3);

    rerender(<GameGraphSection {...wired} showReportView={false} />);
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.queryByText('Game report', { selector: 'span' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '← Game report' }));
    expect(wired.onBackToReport).toHaveBeenCalledTimes(1);

    rerender(<GameGraphSection {...wired} showReportView={false} currentTurn={0} leadAnalysis={leadAnalysis()} />);
    expect(screen.getByText('Team preview')).toBeInTheDocument();
    expect(screen.queryByText('Turn 3')).toBeNull();
  });
});
