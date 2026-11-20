import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { GameGraphSection } from '../../../../src/components/eval/GameGraphSection';
import { evalGraph } from '../../fixtures/eval-result';
import { misplayedSide, turnAnalysis } from '../../fixtures/analysis';

/**
 * Round 89 (FT-1): the graph marks the Game review's graded turns with a circle for player 1 and a square for player 2, in the
 * players' colours. The marks said nothing about what they mean and the hover did not help (the marks pass clicks through to the
 * point beneath). A legend line under the graph names each shape by its player and says what a mark is, in the words of
 * GLOSSARY.md ("graded turn": an inaccuracy, a mistake or a blunder). It names only the sides that carry a mark.
 */
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
