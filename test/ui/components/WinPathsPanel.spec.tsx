import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalLine, WinStep } from '@fulllifegames/eval-engine';
import { WinPathsPanel } from '../../../src/components/eval/WinPathsPanel';
import { WinPathsEntry } from '../../../src/components/eval/WinPathsEntry';
import type { LinesHost } from '../../../src/lib/line-view';
import type { WinPathsHost, WinPathsRun } from '../../../src/lib/win-paths-host';
import { doublesLine, DOUBLES_NAMES, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

const spent = { cells: 3, turns: 5 };
const step = (kind: WinStep['kind'], status: WinStep['status'], extra: Partial<WinStep> = {}): WinStep => ({ kind, status, spent, ...extra });
const line = (base: EvalLine = singlesLine): EvalLine => ({ ...base, for: [] });

function hostOf(run: WinPathsRun | null, extra: Partial<WinPathsHost> = {}, base: Partial<LinesHost> = {}): LinesHost & { winPaths: WinPathsHost } {
  const winPaths: WinPathsHost = {
    endgame: { loser: 'p2', turns: [23, 24, 25] }, offered: { loser: 'p2', turns: [10, 23, 24, 25] }, run, unavailable: null, playedLabel: () => 'Hydro Pump', proofAt: () => null, show: vi.fn(), hide: vi.fn(), ...extra,
  };
  return { rules: { gen: 9, mod: undefined }, onPlay: vi.fn(), winPaths, ...base };
}

const run = (steps: WinStep[], status: WinPathsRun['status'] = 'done', turn = 23, from: WinPathsRun['from'] = 'review', question: WinPathsRun['question'] = 'lost'): WinPathsRun => ({ turn, side: 'p2', steps, status, from, question });
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

  test('a panel shows only the run its own place opened: the review\'s panel not a card\'s run, the card\'s not a review run', () => {
    const { container, rerender } = render(<WinPathsPanel host={hostOf(run(ALL, 'done', 23, 'card'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WinPathsPanel host={hostOf(run(ALL, 'done', 23, 'card'))} playerNames={SINGLES_NAMES} doubles={false} from="card" picker={false} />);
    expect(screen.getByRole('region', { name: 'How could Pepitopalotin have won?' })).toBeInTheDocument();
    rerender(<WinPathsPanel host={hostOf(run(ALL, 'done', 23, 'review'))} playerNames={SINGLES_NAMES} doubles={false} from="card" picker={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('the title, the three steps in order, each with its words and its play button', async () => {
    const host = hostOf(run(ALL));
    render(<WinPathsPanel host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    const panel = screen.getByRole('region', { name: 'How could Pepitopalotin have won?' });
    expect(within(panel).getByText('How could Pepitopalotin have won?')).toBeInTheDocument();
    expect(within(panel).getAllByText(/^[123] · /).map(node => node.textContent)).toEqual(['1 · A stronger play', '2 · Luck', '3 · A mistake by Tzon']);
    expect(within(panel).getByText('Hydro Pump wins within 3 turns in 52 % of the dice whatever Tzon plays. What Pepitopalotin played, Hydro Pump, wins in 0 % of the dice.')).toBeInTheDocument();
    expect(within(panel).getByText('This sequence: 10.8 %.')).toBeInTheDocument();
    expect(within(panel).getAllByText(/^A sequence's chance multiplies the dice whose other result would change who faints/)).toHaveLength(1);
    expect(within(panel).getByText('If Tzon had played Scald (its second choice) on turn 24, Pepitopalotin wins: this sequence has 84 %.')).toBeInTheDocument();
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
    expect(host.winPaths.show).toHaveBeenCalledWith(25, 'review');
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
    const confirm = { anchor: `lines|23|p2|Hydro Pump|`, message: 'Play this line from turn 23: replace the existing variation from turn 5 (3 turns)?', proceed: vi.fn(), cancel: vi.fn() };
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
    render(<WinPathsPanel host={hostOf({ turn: 8, side: 'p1', steps: doubles, status: 'done', from: 'review', question: 'lost' }, { endgame: { loser: 'p1', turns: [8] }, offered: { loser: 'p1', turns: [8] }, playedLabel: () => null })} playerNames={DOUBLES_NAMES} doubles />);
    expect(screen.getByRole('region', { name: 'How could pixelfrost have won?' })).toBeInTheDocument();
    expect(screen.getByText(/wins within 3 turns in 25 % of the dice whatever Mstr_Hawk plays \(over sampled rolls\)\./)).toBeInTheDocument();
    const first = document.querySelector('[data-step="stronger"]') as HTMLElement;
    expect(within(first).getAllByText('pixelfrost', { selector: '.side' }).length).toBeGreaterThanOrEqual(2);
    expect(within(first).getAllByText('Mstr_Hawk', { selector: '.side' }).length).toBeGreaterThanOrEqual(2);
    expect(within(first).getByText('Speed tie: p2a first (50%)')).toBeInTheDocument();
    expect(within(first).getByText('Behemoth Bash: KO (12 of 16 rolls)')).toBeInTheDocument();
  });
});

describe('WinPathsEntry (the turn card)', () => {
  test('an endgame turn offers the question for the player who lost and opens the panel under it', async () => {
    const host = hostOf(null);
    const { rerender } = render(<WinPathsEntry turn={24} host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' }));
    expect(host.winPaths.show).toHaveBeenCalledWith(24, 'card', 'lost');
    expect(screen.queryByRole('region')).toBeNull();
    rerender(<WinPathsEntry turn={24} host={hostOf(run(ALL, 'done', 24, 'card'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('region', { name: 'How could Pepitopalotin have won?' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Endgame turn' })).toBeNull();
  });

  test('a turn of another endgame turn\'s search, a turn outside the endgame and a game without a loser show nothing', () => {
    const { container, rerender } = render(<WinPathsEntry turn={11} host={hostOf(null)} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WinPathsEntry turn={24} host={hostOf(null, { endgame: null, offered: null })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WinPathsEntry turn={24} host={{ rules: { gen: 9, mod: undefined } }} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WinPathsEntry turn={24} host={hostOf(run(ALL, 'done', 23, 'card'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' })).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    rerender(<WinPathsEntry turn={24} host={hostOf(run(ALL, 'done', 24, 'review'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
  });

  test.each([['singles', SINGLES_NAMES, false, 'Pepitopalotin'], ['doubles', DOUBLES_NAMES, true, 'Mstr_Hawk']] as const)('%s: a turn behind the bar outside the endgame offers the question too, with or without any endgame turn', async (_type, names, doubles, loser) => {
    const label = `How could ${loser} have won from here?`;
    const host = hostOf(null);
    const { rerender } = render(<WinPathsEntry turn={10} host={host} playerNames={names} doubles={doubles} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(host.winPaths.show).toHaveBeenCalledWith(10, 'card', 'lost');
    const calm = hostOf(null, { endgame: null, offered: { loser: 'p2', turns: [10] } });
    rerender(<WinPathsEntry turn={10} host={calm} playerNames={names} doubles={doubles} />);
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(calm.winPaths.show).toHaveBeenCalledWith(10, 'card', 'lost');
    rerender(<WinPathsEntry turn={10} host={hostOf(run(ALL, 'done', 10, 'card'), { endgame: null, offered: { loser: 'p2', turns: [10] } })} playerNames={names} doubles={doubles} />);
    expect(screen.getByRole('region', { name: `How could ${loser} have won?` })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Endgame turn' })).toBeNull();
  });

  test('while the sets still load, the question is disabled and says why', () => {
    render(<WinPathsEntry turn={24} host={hostOf(null, { unavailable: 'Waiting for Smogon data.' })} playerNames={SINGLES_NAMES} doubles={false} />);
    const button = screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Waiting for Smogon data.');
  });
});

describe('the winner\'s line on the turn card', () => {
  const PROOF = (turn: number) => (turn === 24 || turn === 23 ? { side: 'p2' as const, turns: 1 } : null);
  const proofRun = (steps: WinStep[], turn = 24, status: WinPathsRun['status'] = 'done') => run(steps, status, turn, 'card', 'proof');
  const FOUND = [step('stronger', 'found', { chance: 1, played: 1, line: line() })];

  test('a proof turn offers the question for the player who wins, opens a panel with one step and no picker, and a turn without a proof offers none', async () => {
    const host = hostOf(null, { endgame: null, offered: null, proofAt: PROOF });
    const { container, rerender } = render(<WinPathsEntry turn={24} host={host} playerNames={SINGLES_NAMES} doubles={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'How does Pepitopalotin win from here?' }));
    expect(host.winPaths.show).toHaveBeenCalledWith(24, 'card', 'proof');
    expect(screen.getByRole('button', { name: 'How does Pepitopalotin win from here?' })).toHaveAttribute('title', 'Show the line of the forced win the engine proved from this position');
    rerender(<WinPathsEntry turn={24} host={hostOf(proofRun(FOUND), { endgame: null, offered: null, proofAt: PROOF })} playerNames={SINGLES_NAMES} doubles={false} />);
    const panel = screen.getByRole('region', { name: 'How does Pepitopalotin win?' });
    expect(within(panel).getByText('The proof\'s line')).toBeInTheDocument();
    expect(panel.querySelectorAll('[data-step]')).toHaveLength(1);
    expect(within(panel).getByText('Hydro Pump wins within 1 turn in 100 % of the dice whatever Tzon plays. Pepitopalotin played this choice.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '▶ Play' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Endgame turn' })).toBeNull();
    expect(screen.queryByText(/^A sequence/)).toBeNull();
    expect(screen.queryByRole('button', { name: /How could/ })).toBeNull();
    rerender(<WinPathsEntry turn={11} host={hostOf(null, { endgame: null, offered: null, proofAt: PROOF })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a turn that proves a win for the player who lost shows both questions for that player, and each panel opens only for its own run', () => {
    const both = (current: WinPathsRun | null) => hostOf(current, { proofAt: PROOF });
    const { rerender } = render(<WinPathsEntry turn={23} host={both(null)} playerNames={SINGLES_NAMES} doubles={false} />);
    const lost = screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' });
    const proof = screen.getByRole('button', { name: 'How does Pepitopalotin win from here?' });
    expect(lost.compareDocumentPosition(proof) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    rerender(<WinPathsEntry turn={23} host={both(proofRun(FOUND, 23))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('button', { name: 'How does Pepitopalotin win from here?' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('region')).toHaveLength(1);
    rerender(<WinPathsEntry turn={23} host={both(run(ALL, 'done', 23, 'card'))} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('button', { name: 'How could Pepitopalotin have won from here?' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'How does Pepitopalotin win from here?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'How could Pepitopalotin have won?' })).toBeInTheDocument();
  });

  test('the proof panel says what it is doing while it searches', () => {
    const { rerender } = render(<WinPathsEntry turn={24} host={hostOf(proofRun([], 24, 'positioning'), { proofAt: PROOF })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Rebuilding turn 24…');
    rerender(<WinPathsEntry turn={24} host={hostOf(proofRun([], 24, 'searching'), { proofAt: PROOF })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Searching for the proof\'s line…');
    rerender(<WinPathsEntry turn={24} host={hostOf(proofRun([], 24, 'failed'), { proofAt: PROOF })} playerNames={SINGLES_NAMES} doubles={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('The search could not run.');
  });

  test('doubles: a proof line reads one row per player and step, and the sentence says the rolls were sampled', () => {
    const steps = [step('stronger', 'found', { chance: 0.667, line: line(doublesLine) })];
    const host = hostOf({ turn: 13, side: 'p1', steps, status: 'done', from: 'card', question: 'proof' }, { endgame: null, offered: null, playedLabel: () => null, proofAt: () => ({ side: 'p1', turns: 4 }) });
    render(<WinPathsEntry turn={13} host={host} playerNames={DOUBLES_NAMES} doubles />);
    const panel = screen.getByRole('region', { name: 'How does pixelfrost win?' });
    expect(within(panel).getByText(/wins within 4 turns in 67 % of the dice whatever Mstr_Hawk plays \(over sampled rolls\)\.$/)).toBeInTheDocument();
    const block = document.querySelector('[data-step="stronger"]') as HTMLElement;
    expect(within(block).getAllByText('pixelfrost', { selector: '.side' }).length).toBeGreaterThanOrEqual(2);
    expect(within(block).getAllByText('Mstr_Hawk', { selector: '.side' }).length).toBeGreaterThanOrEqual(2);
    expect(within(block).getByText('Behemoth Bash: KO (12 of 16 rolls)')).toBeInTheDocument();
  });
});
