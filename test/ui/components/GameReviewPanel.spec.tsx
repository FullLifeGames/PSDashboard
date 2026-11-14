import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winPctText, type EvalLine, type EvalResult, type SideAnalysis, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { GameReviewPanel } from '../../../src/components/eval/GameReviewPanel';
import type { LinesHost } from '../../../src/lib/line-view';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import type { WinPathsHost } from '../../../src/lib/win-paths-host';
import { doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/** Round 89 (#104), step G4: the Game review panel, singles and doubles. */
const host = (onPlay = vi.fn()): LinesHost => ({ rules: { gen: 9, mod: undefined }, onPlay });
/** The ranking that holds the fixtures' answers: Tzon's Draining Kiss and pixelfrost's opponent pair are each side's top choice. */
const topped = (labels: string[]) => labels.map((label, index) => rankedChoice(`move ${index + 1}`, label, 0.2 - index * 0.05));
const withLines = (kind: 'singles' | 'doubles', lines: EvalLine[]): EvalResult => ({
  ...evalResult(kind), lines,
  perSide: kind === 'singles'
    ? { p1: topped(['Draining Kiss', 'Surf']), p2: topped(['Hydro Pump', 'Hyper Voice']) }
    : { p1: topped([doublesLine.label]), p2: topped(['Sucker Punch → Terapagos + Protect']) },
});

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
    expect(within(pepito).getByText("Hydro Pump vs Draining Kiss (Tzon's top choice), then Moonblast vs → Corviknight, then Moonblast vs Brave Bird")).toBeInTheDocument();
    expect(within(pepito).getByText("Hyper Voice vs Draining Kiss (Tzon's top choice)")).toBeInTheDocument();
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
    expect(screen.getByText("Hyper Voice vs Draining Kiss (Tzon's top choice)")).toBeInTheDocument();
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
    expect(within(group).getByText(/then Mstr_Hawk replaces: → Zamazenta-Crowned, then pixelfrost: Fake Out → Zamazenta-Crowned \+ Protect/)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: '▶ Play' }));
    expect(onPlay).toHaveBeenCalledWith(doublesLine, 4);
    expect(screen.getByText('Mstr_Hawk: no inaccuracy, mistake or blunder.')).toBeInTheDocument();
  });

  test('a line is labelled "engine line:" or "played line:", so the head\'s "engine" is not repeated by its line', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.37) } })];
    render(<GameReviewPanel analyses={analyses} results={[null, null, null, withLines('doubles', [doublesLine])]} playerNames={DOUBLES_NAMES} doubles host={host(vi.fn())} />);
    expect(screen.getByText('engine line:')).toBeInTheDocument();
  });

  test('a line that ends on a switch nobody chose says why under its row', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.37) } })];
    render(<GameReviewPanel analyses={analyses} results={[null, null, null, withLines('doubles', [{ ...doublesLine, awaits: 'p1' }])]} playerNames={DOUBLES_NAMES} doubles host={host(vi.fn())} />);
    expect(screen.getByText(`The line ends where ${DOUBLES_NAMES[0]} must choose who to send in; the search made no choice there.`)).toBeInTheDocument();
  });
});

/** Round 89 (#130), step G8b: the Endgame row of the player who lost. */
const endgameHost = (extra: Partial<WinPathsHost> = {}): LinesHost & { winPaths: WinPathsHost } => ({
  rules: { gen: 9, mod: undefined },
  winPaths: { endgame: { loser: 'p2', turns: [23, 24] }, run: null, unavailable: null, playedLabel: () => null, show: vi.fn(), hide: vi.fn(), ...extra },
});

describe('GameReviewPanel, the Endgame row', () => {
  test('singles: one row for the player who lost, named by the first turn of the endgame; a click searches that turn', async () => {
    const { analyses, results } = singlesGame();
    const lined = endgameHost();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={lined} />);
    const group = screen.getByRole('group', { name: 'Endgame' });
    const button = within(group).getByRole('button', { name: 'Endgame · T23 · How could Pepitopalotin have won?' });
    await userEvent.click(button);
    expect(lined.winPaths.show).toHaveBeenCalledWith(23);
    // only for the loser: the winner has no such row
    expect(screen.queryByRole('button', { name: /How could Tzon have won/ })).toBeNull();
  });

  test('doubles: the same row for the loser of a doubles game', () => {
    render(<GameReviewPanel analyses={[null, null, null, null]} results={[null, null, null, null]} playerNames={DOUBLES_NAMES} doubles host={endgameHost({ endgame: { loser: 'p1', turns: [8] } })} />);
    expect(screen.getByRole('button', { name: 'Endgame · T8 · How could pixelfrost have won?' })).toBeInTheDocument();
  });

  test('no row for a game that never reached its endgame, one without a loser or a host without the job', () => {
    const { analyses, results } = singlesGame();
    const { rerender } = render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={endgameHost({ endgame: null })} />);
    expect(screen.queryByRole('group', { name: 'Endgame' })).toBeNull();
    rerender(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.queryByRole('group', { name: 'Endgame' })).toBeNull();
  });

  test('with a search open the row closes it, and the panel stands under the row', async () => {
    const { analyses, results } = singlesGame();
    const lined = endgameHost({ run: { turn: 23, side: 'p2', steps: [], status: 'searching' } });
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={lined} />);
    const group = screen.getByRole('group', { name: 'Endgame' });
    expect(within(group).getByRole('region', { name: 'How could Pepitopalotin have won?' })).toBeInTheDocument();
    const button = within(group).getByRole('button', { name: 'Endgame · T23 · How could Pepitopalotin have won?' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(button);
    expect(lined.winPaths.hide).toHaveBeenCalled();
  });

  test('while the sets load the row is disabled and says why', () => {
    const { analyses, results } = singlesGame();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={endgameHost({ unavailable: 'Waiting for Smogon data.' })} />);
    const button = screen.getByRole('button', { name: /^Endgame/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Waiting for Smogon data.');
  });
});

/** Round 89 (#104), step G10 (ruling G5a): each review line ends with its own number, and one sentence stands under the review when a line differs. */
describe('GameReviewPanel, both numbers', () => {
  const SENTENCE = "A row's value averages every answer and die the search tried; a line follows one answer with each die at its likeliest result.";

  test('singles: every line ends at its value, and the sentence stands once under the review', () => {
    const { analyses, results } = singlesGame();
    render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    const pepito = screen.getByRole('group', { name: 'Pepitopalotin' });
    expect(within(pepito).getByText(`ends at ${winPctText(singlesLine.end, singlesLine.endFainted)}`)).toBeInTheDocument();
    expect(within(pepito).getByText(`ends at ${winPctText(playedLine.end, playedLine.endFainted)}`)).toBeInTheDocument();
    expect(screen.getAllByText(SENTENCE)).toHaveLength(1);
    expect(within(pepito).queryByText(SENTENCE)).toBeNull();
  });

  test('doubles: the pair line ends at its value, with the same sentence once', () => {
    const analyses: (TurnAnalysis | null)[] = [null, null, null, turnAnalysis(4, { p1: { ...misplayedSide('mistake'), best: rankedChoice('move 1, move 2', doublesLine.label, 0.6) } })];
    render(<GameReviewPanel analyses={analyses} results={[null, null, null, withLines('doubles', [doublesLine])]} playerNames={DOUBLES_NAMES} doubles host={host()} />);
    expect(screen.getByText(`ends at ${winPctText(doublesLine.end, doublesLine.endFainted)}`)).toBeInTheDocument();
    expect(screen.getAllByText(SENTENCE)).toHaveLength(1);
  });

  test('no sentence when no line differs from its row, and none without a line', () => {
    const share = 0.1;
    const side = gradedP2('inaccuracy');
    const same: SideAnalysis = { ...side, faintedFraction: share, best: rankedChoice('move 1', 'Hydro Pump', singlesLine.end), played: rankedChoice('move 2', 'Hyper Voice', playedLine.end) };
    const analyses: (TurnAnalysis | null)[] = Array.from({ length: 20 }, () => null);
    analyses[19] = turnAnalysis(20, { p2: same });
    const results: (EvalResult | null)[] = analyses.map(() => null);
    results[19] = withLines('singles', [singlesLine, playedLine]);
    const { rerender } = render(<GameReviewPanel analyses={analyses} results={results} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.queryByText(SENTENCE)).toBeNull();
    rerender(<GameReviewPanel analyses={analyses} results={[]} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });
});
