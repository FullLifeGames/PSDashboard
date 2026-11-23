import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EvalPreferences, TurnAnalysis } from '@fulllifegames/eval-engine';
import { GameGraphSection, type GameGraphSectionProps } from '../../../../src/components/eval/GameGraphSection';
import { evalGraph, evalResult, gameReport } from '../../fixtures/eval-result';
import { misplayedSide, turnAnalysis } from '../../fixtures/analysis';

/** With VITE_FEATURE_GAME_REVIEW off (the default of every build) the report view shows the cards and the graph and nothing of the Game review. */
const names: [string, string] = ['Alice', 'Bob'];
const prefs: EvalPreferences = { depth: 2, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };

beforeEach(() => vi.stubEnv('VITE_FEATURE_GAME_REVIEW', ''));
afterEach(() => vi.unstubAllEnvs());

describe.each(['singles', 'doubles'] as const)('%s: the Game review flag off', kind => {
  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 10 }, (_, index) => turnAnalysis(index + 1));
  analyses[3] = turnAnalysis(4, { p1: misplayedSide('mistake') });
  analyses[6] = turnAnalysis(7, { p2: misplayedSide('blunder') });
  const props = (overrides: Partial<GameGraphSectionProps> = {}): GameGraphSectionProps => ({
    onAnalyzeGame: vi.fn(), onCancel: vi.fn(), running: false, hasGraph: true, prefs, graph: evalGraph(kind), playerNames: names,
    currentTurn: 3, selectTurn: vi.fn(), showReportView: true, onBackToReport: vi.fn(), result: evalResult(kind), analyzeTurn: null,
    hasAnalyzeTurn: false, analysis: null, report: gameReport(), reviewAnalyses: analyses, doubles: kind === 'doubles',
    linesHost: { rules: { gen: 9, mod: undefined } }, ...overrides,
  });

  test('the report view has no review section, no marks and no legend, and the text never says "Game review"', () => {
    const { container } = render(<GameGraphSection {...props()} />);
    expect(screen.queryByText('Game review · what the engine would have played')).toBeNull();
    expect(container.querySelectorAll('[data-review-mark]')).toHaveLength(0);
    expect(screen.queryByTestId('graph-marks-legend')).toBeNull();
    expect(container.textContent).not.toMatch(/Game review/);
    expect(container.innerHTML).not.toMatch(/Game review/);
  });

  test('the title of "Back to the main line" does not name the review', () => {
    const { container } = render(<GameGraphSection {...props({ showReportView: false, report: null, onBackToMain: vi.fn(), currentLine: 'variation' })} />);
    const back = screen.getByRole('button', { name: 'Back to the main line' });
    expect(back.getAttribute('title')).toBe('The game report shows on the main line. Same as Main line in the Line selector');
    expect(container.innerHTML).not.toMatch(/Game review/);
  });
});
