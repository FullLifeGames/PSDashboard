import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalLine, EvalResult, SideAnalysis, TurnAnalysis } from '@fulllifegames/eval-engine';
import { GameReviewPanel } from '../../../src/components/eval/GameReviewPanel';
import type { LinesHost } from '../../../src/lib/line-view';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/** Round 89 (#104), step G4: the Game review panel, singles and doubles. */
const host = (onPlay = vi.fn()): LinesHost => ({ rules: { gen: 9, mod: undefined }, onPlay });
const withLines = (kind: 'singles' | 'doubles', lines: EvalLine[]): EvalResult => ({ ...evalResult(kind), lines });

const gradedP2 = (tier: 'inaccuracy' | 'mistake' | 'blunder'): SideAnalysis => {
  const best = rankedChoice('move 1', 'Hydro Pump', 0.1);
  const played = rankedChoice('move 2', 'Hyper Voice', tier === 'inaccuracy' ? 0.06 : -0.24);
  return { playedRaw: { kind: 'move', name: 'Hyper Voice' }, played, best, safe: best, regret: Math.round((best.ev - played.ev) * 100) / 100, tier };
};

function singlesGame() {
  const analyses: (TurnAnalysis | null)[] = Array.from({ length: 22 }, () => null);
  analyses[8] = turnAnalysis(9, { p1: misplayedSide('mistake') });
  analyses[19] = turnAnalysis(20, { p2: gradedP2('inaccuracy') });
  analyses[20] = turnAnalysis(21, { p2: gradedP2('blunder') });
  const results: (EvalResult | null)[] = analyses.map(() => null);
  results[19] = withLines('singles', [singlesLine, playedLine]);
  return { analyses, results };
}

describe('GameReviewPanel, singles', () => {
  test('the title, one list per player and the graded turns only', () => {
    const { analyses, results } = singlesGame();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('Game review · what the engine would have played')).toBeInTheDocument();
    const tzon = screen.getByRole('group', { name: 'Tzon' });
    const pepito = screen.getByRole('group', { name: 'Pepitopalotin' });
    expect(within(tzon).getAllByRole('button', { name: /^T\d+$/ }).map(button => button.textContent)).toEqual(['T9']);
    expect(within(pepito).getAllByRole('button', { name: /^T\d+$/ }).map(button => button.textContent)).toEqual(['T20', 'T21']);
    // the quiet turns are not listed
    expect(screen.queryByRole('button', { name: 'T1' })).toBeNull();
    expect(within(pepito).getByText(/inaccuracy/)).toBeInTheDocument();
    expect(within(pepito).getByText(/blunder/)).toBeInTheDocument();
    expect(within(tzon).getByText(/mistake/)).toBeInTheDocument();
  });

  test('a row shows the played and the engine value, and the engine and played line each with its play button', async () => {
    const { analyses, results } = singlesGame();
    const onPlay = vi.fn();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host(onPlay)} />);
    const pepito = screen.getByRole('group', { name: 'Pepitopalotin' });
    expect(within(pepito).getByText('played Hyper Voice 53%')).toBeInTheDocument();
    expect(within(pepito).getAllByText('engine Hydro Pump 55%')).toHaveLength(2);
    expect(within(pepito).getByText('Hydro Pump vs Draining Kiss, then Moonblast vs → Corviknight, then Moonblast vs Brave Bird')).toBeInTheDocument();
    expect(within(pepito).getByText('Hyper Voice vs Draining Kiss')).toBeInTheDocument();
    const plays = within(pepito).getAllByRole('button', { name: '▶ Play' });
    expect(plays).toHaveLength(2);
    expect(plays[0]).toHaveAttribute('title', expect.stringContaining('Hydro Pump: no crit (96%)'));
    await userEvent.click(plays[0]);
    expect(onPlay).toHaveBeenCalledWith(singlesLine, 20);
    await userEvent.click(plays[1]);
    expect(onPlay).toHaveBeenLastCalledWith(playedLine, 20);
  });

  test('a click on the turn opens it', async () => {
    const { analyses, results } = singlesGame();
    const onSelectTurn = vi.fn();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host()} onSelectTurn={onSelectTurn} />);
    await userEvent.click(screen.getByRole('button', { name: 'T21' }));
    expect(onSelectTurn).toHaveBeenCalledWith(21);
  });

  test('a graded turn without a line keeps its row and says so; without a play handler the lines show without buttons', () => {
    const { analyses, results } = singlesGame();
    const { rerender } = render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    const t21 = screen.getByRole('button', { name: 'T21' }).closest('.ps-eval-review-row') as HTMLElement;
    expect(within(t21).getByText('no line')).toBeInTheDocument();
    expect(within(t21).queryByRole('button', { name: '▶ Play' })).toBeNull();
    rerender(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={{ rules: { gen: 9, mod: undefined } }} />);
    expect(screen.queryByRole('button', { name: '▶ Play' })).toBeNull();
    expect(screen.getByText('Hyper Voice vs Draining Kiss')).toBeInTheDocument();
  });

  test('a player with no graded turn says so; a game with none says it once per player', () => {
    const analyses = [turnAnalysis(1), turnAnalysis(2), turnAnalysis(3)];
    render(<GameReviewPanel analyses={analyses} results={[]} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('Tzon: no inaccuracy, mistake or blunder.')).toBeInTheDocument();
    expect(screen.getByText('Pepitopalotin: no inaccuracy, mistake or blunder.')).toBeInTheDocument();
  });
});

describe('GameReviewPanel, doubles', () => {
  test('the pair\'s labels and the replacement stay in the line text; ▶ Play hands the line over', async () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.37) } })];
    const results: (EvalResult | null)[] = [null, null, null, withLines('doubles', [doublesLine])];
    const onPlay = vi.fn();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={DOUBLES_NAMES} doubles host={host(onPlay)} />);
    const group = screen.getByRole('group', { name: 'pixelfrost' });
    expect(within(group).getByText(/then Mstr_Hawk replaces: → Zamazenta-Crowned, then Fake Out → Zamazenta-Crowned \+ Protect/)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: '▶ Play' }));
    expect(onPlay).toHaveBeenCalledWith(doublesLine, 4);
    expect(screen.getByText('Mstr_Hawk: no inaccuracy, mistake or blunder.')).toBeInTheDocument();
  });
});
