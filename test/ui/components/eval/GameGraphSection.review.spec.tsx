import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences, TurnAnalysis } from '@fulllifegames/eval-engine';
import { GameGraphSection, type GameGraphSectionProps } from '../../../../src/components/eval/GameGraphSection';
import { evalGraph, evalResult, gameReport } from '../../fixtures/eval-result';
import { misplayedSide, turnAnalysis } from '../../fixtures/analysis';

/** Round 89 (#104), step G4: the Game review under the game report, and its marks on the graph. */
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

/**
 * Round 89 (#104), G4d: with a variation open the panel shows the variation's evaluation and neither the report nor the review, and
 * nothing said where they went (the tester, both game types). Where the report's button stands, a button names the way back and
 * does what "Main line" of the Line selector does; no report to return to, no button.
 */
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
