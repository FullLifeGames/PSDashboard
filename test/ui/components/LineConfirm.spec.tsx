import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalLine, EvalResult, TurnAnalysis } from '@fulllifegames/eval-engine';
import { GameReviewPanel } from '../../../src/components/eval/GameReviewPanel';
import { LinesSection } from '../../../src/components/eval/LinesSection';
import { lineAnchor, type LinesHost } from '../../../src/lib/line-view';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/**
 * Round 89 (#104), step G4b: the question "replace the existing variation?" after ▶ Play stands under the line the user clicked,
 * in the turn card's Lines section and in the Game review, singles and doubles (the tester saw it 800 px above the screen, and
 * under the dock bar).
 */
const MESSAGE = 'Play this line from turn 20: replace the existing variation from turn 12 (3 turns)?';
const withLines = (kind: 'singles' | 'doubles', lines: EvalLine[]): EvalResult => ({ ...evalResult(kind), lines });
const hostWith = (line: EvalLine, turn: number, proceed = vi.fn(), cancel = vi.fn()): LinesHost => ({
  rules: { gen: 9, mod: undefined }, onPlay: vi.fn(), confirm: { anchor: lineAnchor(line, turn), message: MESSAGE, proceed, cancel },
});

describe('the replace question of ▶ Play', () => {
  test('Lines section, singles: the question stands in the block of the clicked line and nowhere else', async () => {
    const proceed = vi.fn();
    const cancel = vi.fn();
    render(<LinesSection turn={20} result={withLines('singles', [singlesLine, playedLine])} playerNames={SINGLES_NAMES} doubles={false} host={hostWith(playedLine, 20, proceed, cancel)} />);
    const banner = screen.getByRole('alertdialog');
    expect(banner).toHaveTextContent(MESSAGE);
    const block = banner.closest('.ps-eval-line-block') as HTMLElement;
    expect(within(block).getByText('Pepitopalotin · played: Hyper Voice')).toBeInTheDocument();
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await userEvent.click(within(banner).getByRole('button', { name: 'Replace' }));
    expect(proceed).toHaveBeenCalledTimes(1);
    await userEvent.click(within(banner).getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('Lines section, doubles: the same under the doubles line', () => {
    render(<LinesSection turn={4} result={withLines('doubles', [doublesLine])} playerNames={DOUBLES_NAMES} doubles host={hostWith(doublesLine, 4)} />);
    expect(screen.getByRole('alertdialog').closest('.ps-eval-line-block')).toHaveTextContent('pixelfrost');
  });

  test('a question for another turn shows in no block', () => {
    render(<LinesSection turn={20} result={withLines('singles', [singlesLine])} playerNames={SINGLES_NAMES} doubles={false} host={hostWith(singlesLine, 21)} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('Game review, singles: the question stands in the row of the clicked line', () => {
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    const best = rankedChoice('move 1', 'Hydro Pump', 0.1);
    const played = rankedChoice('move 2', 'Hyper Voice', -0.24);
    analyses[19] = turnAnalysis(20, { p2: { playedRaw: { kind: 'move', name: 'Hyper Voice' }, played, best, safe: best, regret: 0.34, tier: 'blunder' } });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = withLines('singles', [singlesLine, playedLine]);
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={hostWith(singlesLine, 20)} />);
    const banner = screen.getByRole('alertdialog');
    const row = banner.closest('.ps-eval-review-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'T20' })).toBeInTheDocument();
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    // it follows the clicked line: the engine's, not the played one
    expect(banner.parentElement!.previousElementSibling).toHaveTextContent('engine:');
  });

  test('Game review, doubles: the same under the doubles row', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.37) } })];
    const results: (EvalResult | null)[] = [null, null, null, withLines('doubles', [doublesLine])];
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={DOUBLES_NAMES} doubles host={hostWith(doublesLine, 4)} />);
    expect(screen.getByRole('alertdialog').closest('.ps-eval-review-row')).toHaveTextContent('T4');
  });
});
