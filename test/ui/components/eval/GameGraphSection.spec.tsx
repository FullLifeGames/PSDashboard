import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureSearchBudget, parseSearchBudget, type EvalPreferences } from '@fulllifegames/eval-engine';
import { GameGraphSection, type GameGraphSectionProps } from '../../../../src/components/eval/GameGraphSection';
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
    currentTurn: 3, selectTurn: vi.fn(), showReportView: false, onBackToReport: vi.fn(), result: evalResult(), analyzeTurn: null,
    hasAnalyzeTurn: false, analysis: null, ...overrides,
  };
}

describe('GameGraphSection', () => {
  test('the header offers Analyze game, then Re-analyze, Cancel while sweeping; the line hint names the configured engine', async () => {
    const wired = props({ hasGraph: false, graph: emptyGraph() });
    const { rerender } = render(<GameGraphSection {...wired} />);
    expect(screen.getByText('Game graph')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyze game' }));
    expect(wired.onAnalyzeGame).toHaveBeenCalledTimes(1);
    // Round 67 (T109): the deeper stage left with Think deeper, so the hint names none.
    expect(screen.getByText(/^line:/)).toHaveTextContent(/^line: fast scan, then depth 2 everywhere$/);
    expect(screen.getByText(/^line:/).getAttribute('title')).not.toMatch(/deeper/i);
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
    // Round 63 default (T110): auto runs early singles turns on the matrix.
    expect(screen.getByText(/^line:/)).toHaveTextContent(/then auto \(matrix early, MCTS late\) everywhere$/);

    rerender(<GameGraphSection {...wired} hasGraph smogonPending prefs={{ ...prefs, mode: 'mcts' }} />);
    const analyze = screen.getByRole('button', { name: 'Re-analyze' });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAttribute('title', expect.stringMatching(/^Waiting for Smogon data/));
    expect(screen.getByText(/^line:/)).toHaveTextContent('then MCTS everywhere');
  });

  // Round 77 (C1): a single evaluation that took over a running sweep leaves a status line instead of a silent stop.
  test('a sweep that a single evaluation stopped says where it stopped and offers Analyze again', () => {
    const stopped = evalGraph('singles', { running: false, stopped: { done: 1, total: 2 } });
    render(<GameGraphSection {...props({ graph: stopped })} />);
    expect(screen.getByText('Analysis stopped at turn 1 of 2.')).toHaveTextContent('Analysis stopped at turn 1 of 2.');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeEnabled();
  });

  test('no stopped note while nothing was stopped or the sweep runs again', () => {
    const { rerender } = render(<GameGraphSection {...props({ graph: evalGraph('singles', { stopped: null }) })} />);
    expect(screen.queryByText(/Analysis stopped/)).toBeNull();
    rerender(<GameGraphSection {...props({ graph: evalGraph('singles', { running: true, progress: { done: 0, total: 2 }, stopped: { done: 1, total: 2 } }) })} />);
    expect(screen.queryByText(/Analysis stopped/)).toBeNull();
  });

  test('the auto line hint follows the game type (round 63, T110)', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.25'));
    onTestFinished(() => configureSearchBudget(null));
    const auto = { ...prefs, mode: 'auto' as const };
    const { rerender } = render(<GameGraphSection {...props({ prefs: auto })} />);
    expect(screen.getByText(/^line:/)).toHaveTextContent(/^line: fast scan, then auto \(matrix early, MCTS late\) everywhere$/);
    rerender(<GameGraphSection {...props({ prefs: auto, doubles: true })} />);
    expect(screen.getByText(/^line:/)).toHaveTextContent('line: fast scan, then auto (MCTS every turn) everywhere');
  });

  test('the notice, the gap-turn reason with its analysis control, and the variation-only hint explain partial lines', () => {
    const evalErrors = evalGraph().evalErrors;
    evalErrors[2] = 'no legal choices';
    const graph = evalGraph('singles', { notice: 'Reconstruction diverged at turn 6; the line stops there.', evalErrors });
    const { rerender } = render(<GameGraphSection {...props({ graph, currentTurn: 3, result: null, hasAnalyzeTurn: true, analyzeTurn: <button type="button">analyze</button> })} />);
    const notices = screen.getAllByRole('status');
    expect(notices[0]).toHaveTextContent('⚠ Reconstruction diverged at turn 6; the line stops there.');
    expect(notices[1]).toHaveTextContent('⚠ This turn could not be evaluated: no legal choices');
    expect(screen.getByRole('button', { name: 'analyze' })).toBeInTheDocument();

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

  test('the decided strip stands only where the bar backs the sweep (round 50)', () => {
    // 649664 t15 to t22 named Medicham-Mega for p2 under a bar leaning to p1; t23 stood at 0.89 for p2.
    const graph = evalGraph();
    const sweep = { p1: [], p2: [], decided: { side: 'p2' as const, species: 'Medicham-Mega' } };
    graph.scores[3] = 0.2;
    graph.results[3] = evalResult('singles', { score: 0.2, unanswered: sweep });
    graph.scores[7] = -0.89;
    graph.results[7] = evalResult('singles', { score: -0.89, unanswered: sweep });
    render(<GameGraphSection {...props({ graph })} />);
    const strips = [...document.querySelectorAll('line > title')].filter(title => title.textContent === 'practically decided: Medicham-Mega');
    expect(strips).toHaveLength(1);
    expect(document.querySelector('rect[data-turn="4"] > title')?.textContent).not.toContain('practically decided');
    expect(document.querySelector('rect[data-turn="8"] > title')?.textContent).toContain('practically decided: Medicham-Mega');
  });
});
