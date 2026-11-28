import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureSearchBudget, parseSearchBudget, type EvalPreferences } from '@fulllifegames/eval-engine';
import { GameGraphSection, type GameGraphSectionProps } from '../../../../src/components/eval/GameGraphSection';
import { evalGraph, evalResult, gameReport } from '../../fixtures/eval-result';
import { leadAnalysis, turnAnalysis, misplayedSide } from '../../fixtures/analysis';
import { doublesLine, playedLine, singlesLine } from '../../fixtures/lines';
import { rankedChoice } from '../../fixtures/eval-result';
import { lineAnchor } from '../../../../src/lib/line-view';
import type { EvalLine, TurnAnalysis } from '@fulllifegames/eval-engine';

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

  test.each([['singles', false], ['doubles', true]] as const)('%s: the counter starts at turn 1, and the later passes name the turns they check', (kind, doubles) => {
    const shown = (progress: { done: number; total: number; task?: 'key' | 'rest' }) => {
      const { unmount } = render(<GameGraphSection {...props({ doubles, graph: evalGraph(kind, { running: true, progress }) })} />);
      const text = document.body.textContent ?? '';
      unmount();
      return text.match(/analyzing…[^C]*/)?.[0].trim();
    };
    expect(shown({ done: 0, total: 28 })).toBe('analyzing… turn 1/28');
    expect(shown({ done: 11, total: 11 })).toBe('analyzing… turn 11/11');
    expect(shown({ done: 0, total: 7, task: 'key' })).toBe('analyzing… key turns 1/7');
    expect(shown({ done: 2, total: 7, task: 'key' })).toBe('analyzing… key turns 2/7');
    expect(shown({ done: 2, total: 4, task: 'rest' })).toBe('analyzing… other turns 2/4');
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
    test.each([['singles', false], ['doubles', true]] as const)('%s: the report view carries the review closed with its count; a click opens it and a click on a turn selects it', async (kind, doubles) => {
      const wired = props({ graph: evalGraph(kind), doubles });
      render(<GameGraphSection {...wired} />);
      const toggle = screen.getByRole('button', { name: /Game review · what the engine would have played/ });
      expect(toggle).toHaveTextContent('· 2 graded turns');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('title', "The turns where a player lost ground, with the engine's line and the played line. Stays open or closed while this game is loaded.");
      expect(screen.queryByRole('button', { name: 'T7' })).toBeNull();
      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'T4' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'T7' }));
      expect(wired.selectTurn).toHaveBeenCalledWith(7);
    });

    test('the count reads none and one in the closed fold', () => {
      const { rerender } = render(<GameGraphSection {...props({ reviewAnalyses: [turnAnalysis(1)] })} />);
      expect(screen.getByRole('button', { name: /Game review/ })).toHaveTextContent('· no graded turn');
      rerender(<GameGraphSection {...props({ reviewAnalyses: [turnAnalysis(4, { p1: misplayedSide('mistake') })] })} />);
      expect(screen.getByRole('button', { name: /Game review/ })).toHaveTextContent('· 1 graded turn');
    });

    test.each([['singles', false], ['doubles', true]] as const)('%s: the early-lines progress and Stop show with the fold closed and open', async (kind, doubles) => {
      const stop = vi.fn();
      const linesHost = { rules: { gen: 9, mod: undefined }, earlyLines: { done: 2, total: 5, stop } };
      render(<GameGraphSection {...props({ graph: evalGraph(kind), doubles, linesHost })} />);
      expect(screen.getByRole('status')).toHaveTextContent('Finding lines for graded turns: 2 of 5');
      await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
      expect(stop).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByRole('button', { name: /Game review/ }));
      expect(screen.getByRole('status')).toHaveTextContent('Finding lines for graded turns: 2 of 5');
      expect(screen.getByRole('button', { name: 'T4' })).toBeInTheDocument();
    });

    test('the graph marks the listed turns in the report view and in the turn view', () => {
      const { container, rerender } = render(<GameGraphSection {...props()} />);
      expect(container.querySelectorAll('circle[data-review-mark="p1"]')).toHaveLength(1);
      expect(container.querySelectorAll('rect[data-review-mark="p2"]')).toHaveLength(1);
      rerender(<GameGraphSection {...props({ showReportView: false, analysis: turnAnalysis(3) })} />);
      expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(2);
    });

    describe.each([['singles', false], ['doubles', true]] as const)('%s: the review in the turn view', (kind, doubles) => {
      const graded = analyses.map(analysis => analysis);
      graded[3] = turnAnalysis(4, doubles
        ? { p1: misplayedSide('mistake'), p2: { ...misplayedSide('blunder'), playedRaw: { kind: 'move', name: 'Stone Edge' } } }
        : { p1: misplayedSide('mistake') });
      const turnView = (turn: number, extra: Partial<GameGraphSectionProps> = {}) => props({
        showReportView: false, graph: evalGraph(kind), doubles, currentTurn: turn, analysis: graded[turn - 1], reviewAnalyses: graded, ...extra,
      });
      const rowOf = (turn: number) => screen.getAllByRole('button', { name: `T${turn}` }).map(button => button.closest('.ps-eval-review-row')!);

      test('stands under the card with the rows of the shown turn marked', async () => {
        const { container } = render(<GameGraphSection {...turnView(4)} />);
        const card = container.querySelector('.ps-eval-analysis')!;
        const review = container.querySelector('.ps-eval-review')!;
        expect(card.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const fold = screen.getByRole('button', { name: /Game review/ });
        expect(fold).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(fold);
        expect(rowOf(4)).toHaveLength(doubles ? 2 : 1);
        for (const row of rowOf(4)) expect(row).toHaveAttribute('aria-current', 'true');
        expect(rowOf(4)[0].querySelector('button')).toHaveAttribute('title', "This turn's analysis is open above");
        expect(rowOf(7)[0]).not.toHaveAttribute('aria-current');
        expect(rowOf(7)[0].querySelector('button')).toHaveAttribute('title', "Open this turn's analysis");
      });

      test('a click on another row selects its turn and brings the card into view once the turn has landed', async () => {
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        onTestFinished(() => scroll.mockRestore());
        const wired = turnView(4);
        const { rerender } = render(<GameGraphSection {...wired} />);
        await userEvent.click(screen.getByRole('button', { name: /Game review/ }));
        await userEvent.click(screen.getByRole('button', { name: 'T7' }));
        expect(wired.selectTurn).toHaveBeenCalledWith(7);
        expect(scroll).not.toHaveBeenCalled();
        rerender(<GameGraphSection {...turnView(7, { selectTurn: wired.selectTurn })} />);
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
        expect((scroll.mock.contexts[0] as Element).matches('.ps-eval-analysis > .ps-eval-analysis-row')).toBe(true);
        rerender(<GameGraphSection {...turnView(9, { selectTurn: wired.selectTurn })} />);
        expect(scroll).toHaveBeenCalledTimes(1);
      });

      test('a click on a row of the report view brings the card into view once the turn view has opened', async () => {
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        onTestFinished(() => scroll.mockRestore());
        const wired = props({ graph: evalGraph(kind), doubles, reviewAnalyses: graded });
        const { rerender } = render(<GameGraphSection {...wired} />);
        await userEvent.click(screen.getByRole('button', { name: /Game review/ }));
        await userEvent.click(screen.getByRole('button', { name: 'T7' }));
        expect(wired.selectTurn).toHaveBeenCalledWith(7);
        expect(scroll).not.toHaveBeenCalled();
        rerender(<GameGraphSection {...turnView(7, { selectTurn: wired.selectTurn })} />);
        expect(scroll).toHaveBeenCalledTimes(1);
        expect((scroll.mock.contexts[0] as Element).matches('.ps-eval-analysis > .ps-eval-analysis-row')).toBe(true);
        rerender(<GameGraphSection {...turnView(9, { selectTurn: wired.selectTurn })} />);
        expect(scroll).toHaveBeenCalledTimes(1);
      });

      test('a click on a key-turn row of the game report brings the card into view once the turn view has opened', async () => {
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        onTestFinished(() => scroll.mockRestore());
        const report = gameReport({ keyMoments: [turnAnalysis(7, { attribution: 'chance', swing: -0.35 })] });
        const wired = props({ graph: evalGraph(kind), doubles, reviewAnalyses: graded, report });
        const { rerender } = render(<GameGraphSection {...wired} />);
        await userEvent.click(screen.getByRole('button', { name: /^T7/ }));
        expect(wired.selectTurn).toHaveBeenCalledWith(7);
        expect(scroll).not.toHaveBeenCalled();
        rerender(<GameGraphSection {...turnView(7, { selectTurn: wired.selectTurn })} />);
        expect(scroll).toHaveBeenCalledTimes(1);
        expect((scroll.mock.contexts[0] as Element).matches('.ps-eval-analysis > .ps-eval-analysis-row')).toBe(true);
        rerender(<GameGraphSection {...turnView(9, { selectTurn: wired.selectTurn })} />);
        expect(scroll).toHaveBeenCalledTimes(1);
      });

      test('the question to replace a variation shows once, under the clicked review button, with the card\'s Lines open', async () => {
        const line: EvalLine = doubles ? doublesLine : singlesLine;
        const lines: EvalLine[] = doubles ? [doublesLine] : [singlesLine, playedLine];
        const topped = (labels: string[]) => labels.map((label, index) => rankedChoice(`move ${index + 1}`, label, 0.2 - index * 0.05));
        const result = {
          ...evalResult(kind), lines,
          perSide: doubles ? { p1: topped([doublesLine.label]), p2: topped(['Sucker Punch → Terapagos + Protect']) } : { p1: topped(['Draining Kiss']), p2: topped(['Hydro Pump', 'Hyper Voice']) },
        };
        const best = rankedChoice('move 1', line.label, 0.3);
        const withLines = turnAnalysis(4, doubles ? { p1: { ...misplayedSide('mistake'), best } } : { p2: { ...misplayedSide('mistake'), best } });
        const graph = evalGraph(kind);
        graph.results[3] = result;
        const confirm = { anchor: lineAnchor(line, 4, 'review'), message: 'Play this line from turn 4: replace the existing variation?', proceed: vi.fn(), cancel: vi.fn() };
        const { container } = render(<GameGraphSection {...turnView(4, { graph, analysis: withLines, reviewAnalyses: [null, null, null, withLines], linesHost: { rules: { gen: 9, mod: undefined }, onPlay: vi.fn(), confirm } })} />);
        await userEvent.click(screen.getByRole('button', { name: 'Lines' }));
        await userEvent.click(screen.getByRole('button', { name: /Game review/ }));
        expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
        expect(container.querySelector('.ps-eval-review')!.contains(screen.getByRole('alertdialog'))).toBe(true);
      });
    });

    test('at turn 0 the review stands under the lead card and marks no row', async () => {
      const { container } = render(<GameGraphSection {...props({ showReportView: false, currentTurn: 0, analysis: null, leadAnalysis: leadAnalysis() })} />);
      await userEvent.click(screen.getByRole('button', { name: /Game review/ }));
      expect(screen.getByText('Team preview')).toBeInTheDocument();
      expect(container.querySelectorAll('.ps-eval-review-row[aria-current]')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'T4' })).toBeInTheDocument();
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
