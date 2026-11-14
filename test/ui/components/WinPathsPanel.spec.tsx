import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalLine, WinStep } from '@fulllifegames/eval-engine';
import { WinPathsPanel } from '../../../src/components/eval/WinPathsPanel';
import { WinPathsEntry } from '../../../src/components/eval/WinPathsEntry';
import type { LinesHost } from '../../../src/lib/line-view';
import type { WinPathsHost, WinPathsRun } from '../../../src/lib/win-paths-host';
import { doublesLine, DOUBLES_NAMES, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/** Round 89 (#130), step G8b: the win-path panel and the turn card's entry, singles and doubles. */
const spent = { cells: 3, turns: 5 };
const step = (kind: WinStep['kind'], status: WinStep['status'], extra: Partial<WinStep> = {}): WinStep => ({ kind, status, spent, ...extra });
const line = (base: EvalLine = singlesLine): EvalLine => ({ ...base, for: [] });

function hostOf(run: WinPathsRun | null, extra: Partial<WinPathsHost> = {}, base: Partial<LinesHost> = {}): LinesHost & { winPaths: WinPathsHost } {
  const winPaths: WinPathsHost = {
    endgame: { loser: 'p2', turns: [23, 24, 25] }, run, unavailable: null, playedLabel: () => 'Hydro Pump', show: vi.fn(), hide: vi.fn(), ...extra,
  };
  return { rules: { gen: 9, mod: undefined }, onPlay: vi.fn(), winPaths, ...base };
}

const run = (steps: WinStep[], status: WinPathsRun['status'] = 'done', turn = 23): WinPathsRun => ({ turn, side: 'p2', steps, status });
const ALL = [
  step('stronger', 'found', { chance: 0.5175, played: 0, line: line() }),
  step('luck', 'found', { chance: 0.108, line: line() }),
  step('mistake', 'found', { chance: 0.84, deviation: { turn: 24, label: 'Scald', rank: 2 }, line: line() }),
];

describe('WinPathsPanel, singles', () => {
  test('nothing renders without an open search', () => {
    const { container } = render(<WinPathsPanel host={hostOf(null)} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('the title, the three steps in order, each with its words and its play button', async () => {
    const host = hostOf(run(ALL));
    render(<WinPathsPanel host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    const panel = screen.getByRole('region', { name: 'How could Pepitopalotin have won?' });
    expect(within(panel).getByText('How could Pepitopalotin have won?')).toBeInTheDocument();
    expect(within(panel).getAllByText(/^[123] · /).map(node => node.textContent)).toEqual(['1 · A stronger play', '2 · Luck', '3 · A mistake by Tzon']);
    expect(within(panel).getByText('Hydro Pump wins within 3 turns in 52 % of the dice whatever Tzon plays. Played Hydro Pump: 0 %.')).toBeInTheDocument();
    expect(within(panel).getByText('This sequence: 10.8 %.')).toBeInTheDocument();
    expect(within(panel).getByText('If Tzon had played Scald (its 2nd choice) on turn 24. This sequence: 84 %.')).toBeInTheDocument();
    const plays = within(panel).getAllByRole('button', { name: '▶ Play' });
    expect(plays).toHaveLength(3);
    await userEvent.click(plays[1]);
    expect(host.onPlay).toHaveBeenCalledWith(ALL[1].line, 23);
    expect(plays[1]).toHaveAttribute('title', expect.stringContaining('Hydro Pump: no crit (96%)'));
  });

  test('every step shows after a find (the later steps do not wait for a miss), steps without a find say so', () => {
    render(<WinPathsPanel host={hostOf(run([ALL[0], step('luck', 'none'), step('mistake', 'stopped')]))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getAllByText(/^[123] · /)).toHaveLength(3);
    expect(screen.getByText('None within 3 turns at 1 in 1,000 or better.')).toBeInTheDocument();
    expect(screen.getByText('Stopped at the search limit; nothing found so far.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '▶ Play' })).toHaveLength(1);
  });

  test('the steps appear as they arrive and the panel says which one it is searching', () => {
    const { rerender } = render(<WinPathsPanel host={hostOf(run([], 'positioning'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Rebuilding turn 23…');
    rerender(<WinPathsPanel host={hostOf(run([ALL[0]], 'searching'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Searching step 2 of 3…');
    expect(screen.getAllByText(/^[123] · /)).toHaveLength(1);
    rerender(<WinPathsPanel host={hostOf(run(ALL, 'done'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<WinPathsPanel host={hostOf(run([], 'failed'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('The search could not run.');
  });

  test('the picker names every turn of the endgame and searches the one picked; Close stops the search', async () => {
    const host = hostOf(run(ALL));
    render(<WinPathsPanel host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    const picker = screen.getByRole('group', { name: 'Endgame turn' });
    expect(within(picker).getAllByRole('button').map(button => button.textContent)).toEqual(['T23', 'T24', 'T25']);
    expect(within(picker).getByRole('button', { name: 'T23' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(picker).getByRole('button', { name: 'T25' }));
    expect(host.winPaths.show).toHaveBeenCalledWith(25);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(host.winPaths.hide).toHaveBeenCalled();
  });

  test('a single-turn endgame has no picker, and the card\'s panel has none either', () => {
    const { rerender } = render(<WinPathsPanel host={hostOf(run(ALL), { endgame: { loser: 'p2', turns: [23] } })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.queryByRole('group', { name: 'Endgame turn' })).toBeNull();
    rerender(<WinPathsPanel host={hostOf(run(ALL))} playerNames={SINGLES_NAMES} doubles={false} picker={false} />);
    expect(screen.queryByRole('group', { name: 'Endgame turn' })).toBeNull();
  });

  test('the replace question stands under the step that was clicked', async () => {
    const confirm = { anchor: `23|p2|Hydro Pump|`, message: 'Play this line from turn 23: replace the existing variation from turn 5 (3 turns)?', proceed: vi.fn(), cancel: vi.fn() };
    const host = hostOf(run(ALL), {}, { confirm });
    render(<WinPathsPanel host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.queryByText(confirm.message)).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: '▶ Play' })[1]);
    const luck = document.querySelector('[data-step="luck"]') as HTMLElement;
    expect(within(luck).getByText(confirm.message)).toBeInTheDocument();
    expect(screen.getAllByText(confirm.message)).toHaveLength(1);
  });
});

describe('WinPathsPanel, doubles', () => {
  test('a line of doubles reads one row per player and step, and the sentence says the rolls were sampled', () => {
    const doubles = [step('stronger', 'found', { chance: 0.25, line: line(doublesLine) }), step('luck', 'found', { chance: 0.4, line: line(doublesLine) })];
    render(<WinPathsPanel host={hostOf({ turn: 8, side: 'p1', steps: doubles, status: 'done' }, { endgame: { loser: 'p1', turns: [8] }, playedLabel: () => null })} playerNames={DOUBLES_NAMES} doubles />);
    expect(screen.getByRole('region', { name: 'How could pixelfrost have won?' })).toBeInTheDocument();
    expect(screen.getByText(/wins within 3 turns in 25 % of the dice whatever Mstr_Hawk plays \(over sampled rolls\)\./)).toBeInTheDocument();
    const first = document.querySelector('[data-step="stronger"]') as HTMLElement;
    expect(within(first).getAllByText('pixelfrost', { selector: '.side' }).length).toBeGreaterThanOrEqual(2);
    expect(within(first).getAllByText('Mstr_Hawk', { selector: '.side' }).length).toBeGreaterThanOrEqual(2);
    // the chips of the dice that could have gone the other way
    expect(within(first).getByText('Speed tie: p2a first (50%)')).toBeInTheDocument();
    expect(within(first).getByText('Behemoth Bash: KO (12 of 16 rolls)')).toBeInTheDocument();
  });
});

describe('WinPathsEntry (the turn card)', () => {
  test('an endgame turn offers the question for the player who lost and opens the panel under it', async () => {
    const host = hostOf(null);
    const { rerender } = render(<WinPathsEntry turn={24} host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' }));
    expect(host.winPaths.show).toHaveBeenCalledWith(24);
    expect(screen.queryByRole('region')).toBeNull();
    rerender(<WinPathsEntry turn={24} host={hostOf(run(ALL, 'done', 24))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('region', { name: 'How could Pepitopalotin have won?' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Endgame turn' })).toBeNull();
  });

  test('a turn of another endgame turn\'s search, a turn outside the endgame and a game without a loser show nothing', () => {
    const { container, rerender } = render(<WinPathsEntry turn={10} host={hostOf(null)} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WinPathsEntry turn={24} host={hostOf(null, { endgame: null })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WinPathsEntry turn={24} host={{ rules: { gen: 9, mod: undefined } }} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    // the open search is for turn 23: the card of 24 offers the question but shows no panel
    rerender(<WinPathsEntry turn={24} host={hostOf(run(ALL, 'done', 23))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' })).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
  });

  test('while the sets still load, the question is disabled and says why', () => {
    render(<WinPathsEntry turn={24} host={hostOf(null, { unavailable: 'Waiting for Smogon data.' })} playerNames={SINGLES_NAMES} doubles={false} />);
    const button = screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Waiting for Smogon data.');
  });
});
