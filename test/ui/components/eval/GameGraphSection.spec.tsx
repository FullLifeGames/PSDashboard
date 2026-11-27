import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureSearchBudget, parseSearchBudget, type EvalPreferences } from '@fulllifegames/eval-engine';
import { GameGraphSection, type GameGraphSectionProps } from '../../../../src/components/eval/GameGraphSection';
import { evalGraph, evalResult, gameReport } from '../../fixtures/eval-result';
import { leadAnalysis, turnAnalysis, misplayedSide } from '../../fixtures/analysis';
import type { TurnAnalysis } from '@fulllifegames/eval-engine';

const names: [string, string] = ['Alice', 'Bob'];
const hintTitle = (mode: string) => `Analyze game makes a quick depth-1 pass over every turn, then re-evaluates each turn with ${mode}, starting with the swings worth reporting. Tera applies to every turn.`;
const headingTitle = () => screen.getByText('Game graph').getAttribute('title');
const prefs: EvalPreferences = { depth: 2, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };
const emptyGraph = () => evalGraph('singles', {
  scores: [], results: [], settings: [], faintedFractions: [], played: [], playedOutcome: [], verified: [], sensitivity: [], evalErrors: [], gameSwept: false,
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
    expect(screen.queryByText(/^graph:/)).toBeNull();
    expect(headingTitle()).not.toMatch(/deeper/i);
    expect(headingTitle()).toBe(hintTitle('depth 2'));
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
    expect(headingTitle()).toBe(hintTitle('auto (matrix early, MCTS late)'));

    rerender(<GameGraphSection {...wired} hasGraph graph={evalGraph()} smogonPending prefs={{ ...prefs, mode: 'mcts' }} />);
    const analyze = screen.getByRole('button', { name: 'Re-analyze' });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAttribute('title', expect.stringMatching(/^Waiting for Smogon data/));
    expect(headingTitle()).toBe(hintTitle('MCTS'));
  });

  test.each([['singles'], ['doubles']] as const)('%s: one analyzed turn keeps the header at Analyze game, a swept game reads Re-analyze', kind => {
    const oneTurn = evalGraph(kind, { scores: [null, 0.2, null], results: [null, evalResult(kind), null], gameSwept: false });
    const { rerender } = render(<GameGraphSection {...props({ graph: oneTurn })} />);
    expect(screen.getByRole('button', { name: 'Analyze game' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-analyze' })).toBeNull();
    expect(screen.getByRole('img', { name: /Evaluation over 3 turns/ })).toBeInTheDocument();
    rerender(<GameGraphSection {...props({ graph: { ...oneTurn, gameSwept: true } })} />);
    expect(screen.getByRole('button', { name: 'Re-analyze' })).toBeInTheDocument();
  });

  test('a running sweep names its progress only once it has one: no count before the first turn, the count after', () => {
    const { rerender } = render(<GameGraphSection {...props({ graph: evalGraph('singles', { running: true, progress: null }) })} />);
    expect(screen.getByText('analyzing…')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/turn 0\/\?|\/\?/);
    rerender(<GameGraphSection {...props({ graph: evalGraph('singles', { running: true, progress: { done: 3, total: 12 } }) })} />);
    expect(screen.getByText('analyzing… turn 3/12')).toBeInTheDocument();
  });

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

  test('the auto line hint follows the game type', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.25'));
    onTestFinished(() => configureSearchBudget(null));
    const auto = { ...prefs, mode: 'auto' as const };
    const { rerender } = render(<GameGraphSection {...props({ prefs: auto })} />);
    expect(headingTitle()).toBe(hintTitle('auto (matrix early, MCTS late)'));
    rerender(<GameGraphSection {...props({ prefs: auto, doubles: true })} />);
    expect(headingTitle()).toBe(hintTitle('auto (MCTS every turn)'));
    rerender(<GameGraphSection {...props({ prefs: { ...prefs, mode: 'mcts' } })} />);
    expect(headingTitle()).toBe(hintTitle('MCTS'));
    expect(screen.queryByText(/^graph:/)).toBeNull();
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

  test('the turn card of the section opens the matrix of the turn\'s own result and a cell click reaches the panel\'s pair handler', async () => {
    const onPickPair = vi.fn();
    const graph = evalGraph();
    render(<GameGraphSection {...props({ graph, analysis: turnAnalysis(3), onPickPair })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    expect(screen.getByRole('dialog', { name: "Turn 3 · Alice's choices against Bob's" })).toBeInTheDocument();
    await userEvent.click(screen.getByTitle(/^Earthquake × Leech Seed:/));
    expect(onPickPair).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('the decided strip stands only where the bar backs the sweep', () => {
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

describe('GameGraphSection.review', () => {
  const names: [string, string] = ['Alice', 'Bob'];
  const prefs: EvalPreferences = { depth: 2, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };
  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 10 }, (_, index) => turnAnalysis(index + 1));
  analyses[3] = turnAnalysis(4, { p1: misplayedSide('mistake') });
  analyses[6] = turnAnalysis(7, { p2: { ...misplayedSide('blunder'), playedRaw: { kind: 'move', name: 'Stone Edge' } } });

  function props(overrides: Partial<GameGraphSectionProps> = {}): GameGraphSectionProps {
    return {
      onAnalyzeGame: vi.fn(), onCancel: vi.fn(), running: false, hasGraph: true, prefs, graph: evalGraph(), playerNames: names,
      currentTurn: 3, selectTurn: vi.fn(), showReportView: true, onBackToReport: vi.fn(), result: evalResult(), analyzeTurn: null,
      hasAnalyzeTurn: false, analysis: null, report: gameReport(), reviewAnalyses: analyses,
      linesHost: { rules: { gen: 9, mod: undefined } }, ...overrides,
    };
  }

  describe('GameGraphSection: the Game review', () => {
    test('the report view lists the graded turns under the report; a click on a turn selects it', async () => {
      const wired = props();
      render(<GameGraphSection {...wired} />);
      expect(screen.getByText('Game review · what the engine would have played')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'T7' }));
      expect(wired.selectTurn).toHaveBeenCalledWith(7);
    });

    test('the graph marks the listed turns in the report view and in the turn view; the turn view lists nothing', () => {
      const { container, rerender } = render(<GameGraphSection {...props()} />);
      expect(container.querySelectorAll('circle[data-review-mark="p1"]')).toHaveLength(1);
      expect(container.querySelectorAll('rect[data-review-mark="p2"]')).toHaveLength(1);
      rerender(<GameGraphSection {...props({ showReportView: false, analysis: turnAnalysis(3) })} />);
      expect(screen.queryByText('Game review · what the engine would have played')).toBeNull();
      expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(2);
    });

    test('no analyses, no marks and no panel; no host, marks without the panel', () => {
      const { container, rerender } = render(<GameGraphSection {...props({ reviewAnalyses: null })} />);
      expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(0);
      expect(screen.queryByText('Game review · what the engine would have played')).toBeNull();
      rerender(<GameGraphSection {...props({ linesHost: undefined })} />);
      expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(2);
      expect(screen.queryByText('Game review · what the engine would have played')).toBeNull();
    });
  });

  describe('GameGraphSection: the way back from a variation', () => {
    const inVariation = (overrides: Partial<GameGraphSectionProps> = {}) => props({ showReportView: false, report: null, reviewAnalyses: null, currentLine: 'variation', ...overrides });

    test.each([['singles', false], ['doubles', true]])('%s: "Back to the main line" calls the Main line handler', async (_kind, doubles) => {
      const back = vi.fn();
      render(<GameGraphSection {...inVariation({ onBackToMain: back, doubles })} />);
      await userEvent.click(screen.getByRole('button', { name: 'Back to the main line' }));
      expect(back).toHaveBeenCalledTimes(1);
    });

    test('no handler, no button; the report view and the report\'s own button leave it out', () => {
      const { rerender } = render(<GameGraphSection {...inVariation()} />);
      expect(screen.queryByRole('button', { name: 'Back to the main line' })).toBeNull();
      rerender(<GameGraphSection {...props({ showReportView: false, analysis: turnAnalysis(3), onBackToMain: vi.fn() })} />);
      expect(screen.getByRole('button', { name: /Game report/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Back to the main line' })).toBeNull();
    });
  });
});

describe('graph-marks-legend', () => {
  const names: [string, string] = ['Alice', 'Bob'];
  const prefs: EvalPreferences = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };

  describe.each(['singles', 'doubles'] as const)('%s: the legend of the graph marks', kind => {
    const graph = evalGraph(kind);
    const section = (reviewAnalyses: ReturnType<typeof turnAnalysis>[]) => (
      <GameGraphSection
        onAnalyzeGame={vi.fn()} onCancel={vi.fn()} running={false} hasGraph prefs={prefs} graph={graph} playerNames={names}
        currentTurn={7} selectTurn={vi.fn()} showReportView={false} onBackToReport={vi.fn()} result={graph.results[6]}
        analyzeTurn={null} hasAnalyzeTurn={false} analysis={null} reviewAnalyses={reviewAnalyses}
      />
    );

    test('both shapes are named when both players carry a graded turn', () => {
      const { container } = render(section([turnAnalysis(3, { p1: misplayedSide('mistake'), p2: misplayedSide('blunder') })]));
      expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(2);
      const legend = screen.getByTestId('graph-marks-legend');
      expect(legend).toHaveTextContent("○ Alice · □ Bob: graded turns (an inaccuracy, a mistake or a blunder), listed in the Game review");
    });

    test('only the side that carries a mark is named', () => {
      render(section([turnAnalysis(3, { p1: misplayedSide('mistake') })]));
      expect(screen.getByTestId('graph-marks-legend')).toHaveTextContent('○ Alice: graded turns');
      expect(screen.getByTestId('graph-marks-legend')).not.toHaveTextContent('Bob');
    });

    test('no mark, no legend', () => {
      render(section([turnAnalysis(3)]));
      expect(screen.queryByTestId('graph-marks-legend')).toBeNull();
    });
  });
});
