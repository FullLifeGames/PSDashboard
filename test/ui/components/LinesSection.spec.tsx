import { describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalLine, EvalResult } from '@fulllifegames/eval-engine';
import { LinesSection } from '../../../src/components/eval/LinesSection';
import type { LinesHost } from '../../../src/lib/line-view';
import { EvalTurnAnalysis } from '../../../src/components/EvalTurnAnalysis';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { turnAnalysis } from '../fixtures/analysis';
import { bothRolesLine, doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

/** Round 89 (#104), step G3: the Lines section under a turn's rows, singles and doubles. */
const withLines = (lines?: EvalLine[], extra: Partial<EvalResult> = {}): EvalResult => ({ ...evalResult('singles'), ...(lines ? { lines } : {}), ...extra });
const host = (onPlay = vi.fn()): LinesHost => ({ rules: { gen: 9, mod: undefined }, onPlay });

describe('LinesSection', () => {
  test('singles: a block per line with its head, its end value, its play button and one row per step', () => {
    render(<LinesSection turn={20} result={withLines([bothRolesLine, singlesLine, playedLine])} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('Lines')).toBeInTheDocument();
    expect(screen.getByText('Tzon · played the engine\'s move: Draining Kiss')).toBeInTheDocument();
    expect(screen.getByText('Pepitopalotin · engine: Hydro Pump')).toBeInTheDocument();
    expect(screen.getByText('Pepitopalotin · played: Hyper Voice')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '▶ Play' })).toHaveLength(3);
    expect(screen.getAllByText(/^ends at \d+% for /)).toHaveLength(3);
    const turns = screen.getAllByText(/^T2\d$/).map(node => node.textContent);
    expect(turns).toEqual(['T20', 'T20', 'T21', 'T22', 'T20']);
    // chips: only the dice that could have gone the other way
    expect(screen.getByText('Hydro Pump: hits (80%)')).toBeInTheDocument();
    expect(screen.getByText('Brave Bird: KO (10 of 16 rolls)')).toBeInTheDocument();
    expect(screen.queryByText(/no crit/)).toBeNull();
  });

  test('a click on ▶ Play hands the line and the graded turn to the host; the tooltip lists every forced die', async () => {
    const onPlay = vi.fn();
    render(<LinesSection turn={20} result={withLines([singlesLine])} playerNames={SINGLES_NAMES} doubles={false} host={host(onPlay)} />);
    const button = screen.getByRole('button', { name: '▶ Play' });
    expect(button).toHaveAttribute('title', expect.stringContaining('Hydro Pump: no crit (96%)'));
    await userEvent.click(button);
    expect(onPlay).toHaveBeenCalledWith(singlesLine, 20);
  });

  test('doubles: one row per player and step, a replacement as its own row', () => {
    const { container } = render(<LinesSection turn={4} result={withLines([doublesLine])} playerNames={DOUBLES_NAMES} doubles host={host()} />);
    const rows = [...container.querySelectorAll('.ps-eval-line-turn')].map(row => row.textContent);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toContain('Mstr_Hawk replaces: → Zamazenta-Crowned');
    expect(within(container as HTMLElement).getByText('Behemoth Bash: KO (12 of 16 rolls)')).toBeInTheDocument();
  });

  test('a line that leaves a draw to the seed carries the note', () => {
    render(<LinesSection turn={20} result={withLines([{ ...singlesLine, unforced: ['unnamed draw'] }])} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText(/The click cannot force sleep turns, random targets and similar draws/)).toBeInTheDocument();
  });

  test('without a play handler the line shows and has no button', () => {
    render(<LinesSection turn={20} result={withLines([singlesLine])} playerNames={SINGLES_NAMES} doubles={false} host={{ rules: { gen: 9, mod: undefined } }} />);
    expect(screen.queryByRole('button', { name: '▶ Play' })).toBeNull();
    expect(screen.getByText('Pepitopalotin · engine: Hydro Pump')).toBeInTheDocument();
  });

  test('a turn whose result holds no line says so, and an external engine says that it sends none', () => {
    const { unmount } = render(<LinesSection turn={3} result={withLines()} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('No line on this turn: the matrix pass keeps none. Analyze the position with MCTS to get lines.')).toBeInTheDocument();
    unmount();
    // a tree search that kept none says so of the search
    const tree = withLines();
    render(<LinesSection turn={3} result={{ ...tree, matrix: { ...tree.matrix!, cells: [[{ visits: 9, verified: false }]] } }} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('No line on this turn: the search kept none for these choices.')).toBeInTheDocument();
    cleanup();
    render(<LinesSection turn={3} result={withLines(undefined, { engine: { id: 'ext', name: 'Other engine' } })} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('No line: Other engine sends none.')).toBeInTheDocument();
  });

  test('with the card\'s analysis the engine line is the line of the card\'s engine choice (singles and doubles)', () => {
    const stale: EvalLine = { ...singlesLine, label: 'Surf', choice: 'move 4' };
    const analysis = turnAnalysis(20, { p2: { ...turnAnalysis(20).p2, best: rankedChoice('move 1', 'Hydro Pump', 0.1) } });
    const { unmount } = render(<LinesSection turn={20} result={withLines([stale, playedLine])} playerNames={SINGLES_NAMES} doubles={false} host={host()} analysis={analysis} />);
    expect(screen.queryByText(/engine: Surf/)).toBeNull();
    expect(screen.getByText('Pepitopalotin · played: Hyper Voice')).toBeInTheDocument();
    unmount();
    const pair = turnAnalysis(4, { p1: { ...turnAnalysis(4).p1, best: rankedChoice('move 1, move 2', doublesLine.label, 0.37) } });
    render(<LinesSection turn={4} result={withLines([doublesLine, { ...doublesLine, label: 'Other pair', for: ['engine'] }])} playerNames={DOUBLES_NAMES} doubles host={host()} analysis={pair} />);
    expect(screen.getAllByText(/^pixelfrost · engine: /)).toHaveLength(1);
    expect(screen.queryByText(/Other pair/)).toBeNull();
  });

  test('two chips with the same words do not collide as React keys', () => {
    // one die listed twice on a slot: two chips with the same words
    const [first, ...rest] = doublesLine.steps;
    const slots = first.p1.slots.map((slot, index) => (index === 0 && slot?.kind === 'move' && slot.dice ? { ...slot, dice: [...slot.dice, ...slot.dice] } : slot));
    const twice = { ...doublesLine, steps: [{ ...first, p1: { ...first.p1, slots } }, ...rest] };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LinesSection turn={4} result={withLines([twice])} playerNames={DOUBLES_NAMES} doubles host={host()} />);
    expect(screen.getAllByText(/^Speed tie: .* first \(50%\)$/)).toHaveLength(2);
    expect(spy.mock.calls.filter(call => String(call[0]).includes('same key'))).toEqual([]);
    spy.mockRestore();
  });

  test('a turn without a result shows nothing', () => {
    const { container } = render(<LinesSection turn={3} result={null} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a line that ends on a switch nobody chose', () => {
  test.each([['singles', singlesLine, SINGLES_NAMES, false], ['doubles', doublesLine, DOUBLES_NAMES, true]] as const)('%s: the block says why it stops', (kind, line, names, doubles) => {
    render(<LinesSection turn={5} result={{ ...withLines([{ ...line, awaits: 'p1' }]), ...(doubles ? { kind: 'doubles' } : {}) } as EvalResult} playerNames={names} doubles={doubles} host={host()} />);
    expect(screen.getByText(`The line ends where ${names[0]} must choose who to send in; the search made no choice there.`)).toBeInTheDocument();
  });
});

describe('the Lines section in the turn card', () => {
  test('the card mounts it under the rows when its host hands one over, and not otherwise', () => {
    const analysis = turnAnalysis(20, { p2: { ...turnAnalysis(20).p2, best: rankedChoice('move 1', 'Hydro Pump', 0.1) } });
    const { rerender } = render(<EvalTurnAnalysis analysis={analysis} playerNames={SINGLES_NAMES} result={withLines([singlesLine])} linesHost={host()} />);
    expect(screen.getByText('Pepitopalotin · engine: Hydro Pump')).toBeInTheDocument();
    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={SINGLES_NAMES} result={withLines([singlesLine])} />);
    expect(screen.queryByText('Lines')).toBeNull();
  });
});
