import { describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winPctText, type EvalLine, type EvalResult } from '@fulllifegames/eval-engine';
import { LinesSection } from '../../../src/components/eval/LinesSection';
import type { LinesHost } from '../../../src/lib/line-view';
import { EvalTurnAnalysis } from '../../../src/components/EvalTurnAnalysis';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { turnAnalysis } from '../fixtures/analysis';
import { bothRolesLine, doublesLine, DOUBLES_NAMES, playedLine, singlesLine, SINGLES_NAMES } from '../fixtures/lines';

const withLines = (lines?: EvalLine[], extra: Partial<EvalResult> = {}): EvalResult => ({ ...evalResult('singles'), ...(lines ? { lines } : {}), ...extra });
const host = (onPlay = vi.fn()): LinesHost => ({ rules: { gen: 9, mod: undefined }, onPlay });

describe('LinesSection', () => {
  test('singles: a block per line with its head, its end value, its play button and one row per step', () => {
    render(<LinesSection turn={20} result={withLines([bothRolesLine, singlesLine, playedLine])} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.queryByText('Lines')).toBeNull();
    expect(screen.getByText('Tzon · played the engine\'s move: Draining Kiss')).toBeInTheDocument();
    expect(screen.getByText('Pepitopalotin · engine: Hydro Pump')).toBeInTheDocument();
    expect(screen.getByText('Pepitopalotin · played: Hyper Voice')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '▶ Play' })).toHaveLength(3);
    expect(screen.getAllByText(/^ends at \d+% for /)).toHaveLength(3);
    const turns = screen.getAllByText(/^T2\d$/).map(node => node.textContent);
    expect(turns).toEqual(['T20', 'T20', 'T21', 'T22', 'T20']);
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
    expect(onPlay).toHaveBeenCalledWith(singlesLine, 20, 'lines');
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
    const tree = withLines();
    render(<LinesSection turn={3} result={{ ...tree, matrix: { ...tree.matrix!, cells: [[{ visits: 9, verified: false }]] } }} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('No line on this turn: the search kept none for these choices.')).toBeInTheDocument();
    cleanup();
    render(<LinesSection turn={3} result={withLines(undefined, { engine: { id: 'ext', name: 'Other engine' } })} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText('No line: Other engine sends none.')).toBeInTheDocument();
  });

  test.each([['singles', false], ['doubles', true]])('%s: a turn whose lines are coming says when, and a turn that waits for nothing keeps the matrix sentence', (_kind, doubles) => {
    const names = doubles ? DOUBLES_NAMES : SINGLES_NAMES;
    const { unmount } = render(<LinesSection turn={3} result={withLines()} playerNames={names} doubles={doubles} host={{ ...host(), lineComing: () => 'stage' }} />);
    expect(screen.getByText('No line yet: the app searches this turn after the game report (the review shows the progress).')).toBeInTheDocument();
    expect(screen.queryByText(/Analyze the position with MCTS/)).toBeNull();
    unmount();
    const sweep = render(<LinesSection turn={3} result={withLines()} playerNames={names} doubles={doubles} host={{ ...host(), lineComing: () => 'sweep' }} />);
    expect(screen.getByText('No line yet: the game analysis is still running. If the report grades this turn, its lines follow the report.')).toBeInTheDocument();
    sweep.unmount();
    render(<LinesSection turn={3} result={withLines()} playerNames={names} doubles={doubles} host={{ ...host(), lineComing: () => null }} />);
    expect(screen.getByText('No line on this turn: the matrix pass keeps none. Analyze the position with MCTS to get lines.')).toBeInTheDocument();
  });

  test.each([['singles', false], ['doubles', true]])('%s: with the Game review flag off the coming-lines sentence names no review', (_kind, doubles) => {
    vi.stubEnv('VITE_FEATURE_GAME_REVIEW', '');
    try {
      render(<LinesSection turn={3} result={withLines()} playerNames={doubles ? DOUBLES_NAMES : SINGLES_NAMES} doubles={doubles} host={{ ...host(), lineComing: () => 'stage' }} />);
      expect(screen.getByText('No line yet: the app searches this turn after the game report.')).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
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
    const [first, ...rest] = doublesLine.steps;
    const slots = first.p1.slots.map((slot, index) => (index === 0 && slot?.kind === 'move' && slot.dice ? { ...slot, dice: [...slot.dice, ...slot.dice] } : slot));
    const twice = { ...doublesLine, steps: [{ ...first, p1: { ...first.p1, slots } }, ...rest] };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LinesSection turn={4} result={withLines([twice])} playerNames={DOUBLES_NAMES} doubles host={host()} />);
    expect(screen.getAllByText(/^Speed tie: .* first \(50%\)$/)).toHaveLength(2);
    expect(spy.mock.calls.filter(call => String(call[0]).includes('same key'))).toEqual([]);
    spy.mockRestore();
  });

  test('the dice chips carry their own class, not the timeline bar\'s line chip (its padding, margin broke the pill)', () => {
    const { container } = render(<LinesSection turn={4} result={withLines([doublesLine])} playerNames={DOUBLES_NAMES} doubles host={host()} />);
    const chips = screen.getAllByText(/^Speed tie: .* first \(50%\)$/);
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip).toHaveClass('ps-lines-chip');
    expect(container.querySelector('.ps-line-chip')).toBeNull();
  });

  test('a turn without a result shows nothing', () => {
    const { container } = render(<LinesSection turn={3} result={null} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a line that stops before a replacement', () => {
  test.each([['singles', singlesLine, SINGLES_NAMES, false], ['doubles', doublesLine, DOUBLES_NAMES, true]] as const)('%s: the block says why it stops', (kind, line, names, doubles) => {
    render(<LinesSection turn={5} result={{ ...withLines([{ ...line, awaits: 'p1' }]), ...(doubles ? { kind: 'doubles' } : {}) } as EvalResult} playerNames={names} doubles={doubles} host={host()} />);
    expect(screen.getByText(`The line stops before ${names[0]} sends in a replacement. Its end is the board before the switch-in.`)).toBeInTheDocument();
  });
});

describe('the Lines section in the turn card', () => {
  test('the card mounts it under its closed Lines toggle when its host hands one over, and not otherwise', async () => {
    const analysis = turnAnalysis(20, { p2: { ...turnAnalysis(20).p2, best: rankedChoice('move 1', 'Hydro Pump', 0.1) } });
    const { rerender } = render(<EvalTurnAnalysis analysis={analysis} playerNames={SINGLES_NAMES} result={withLines([singlesLine])} linesHost={host()} />);
    expect(screen.queryByText('Pepitopalotin · engine: Hydro Pump')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lines' }));
    expect(screen.getByText('Pepitopalotin · engine: Hydro Pump')).toBeInTheDocument();
    rerender(<EvalTurnAnalysis analysis={analysis} playerNames={SINGLES_NAMES} result={withLines([singlesLine])} />);
    expect(screen.queryByText('Lines')).toBeNull();
  });
});

describe('both numbers on a line', () => {
  const SENTENCE = "A row's value averages every answer and die the search tried; a line follows one answer with each die at its likeliest result.";
  const p2Rows = (engineEv: number, playedEv: number, faintedFraction?: number) => {
    const base = turnAnalysis(20).p2;
    return { ...base, best: rankedChoice('move 1', 'Hydro Pump', engineEv), played: rankedChoice('move 2', 'Hyper Voice', playedEv), ...(faintedFraction === undefined ? {} : { faintedFraction }) };
  };

  test('singles: the engine line and the played line each show their row and their end, and the sentence stands once under the section', () => {
    const analysis = turnAnalysis(20, { p2: p2Rows(0.1, 0.3) });
    render(<LinesSection turn={20} result={withLines([singlesLine, playedLine])} playerNames={SINGLES_NAMES} doubles={false} host={host()} analysis={analysis} />);
    const engineEnd = `row ${winPctText(0.1)}, this line ends at ${winPctText(singlesLine.end, singlesLine.endFainted)}`;
    const playedEnd = `row ${winPctText(0.3)}, this line ends at ${winPctText(playedLine.end, playedLine.endFainted)}`;
    expect(screen.getByText(engineEnd)).toBeInTheDocument();
    expect(screen.getByText(playedEnd)).toBeInTheDocument();
    expect(screen.getAllByText(SENTENCE)).toHaveLength(1);
  });

  test('singles: a line that ends where its row stands needs no sentence', () => {
    const share = 0.1;
    const analysis = turnAnalysis(20, { p2: p2Rows(singlesLine.end, playedLine.end, share) });
    render(<LinesSection turn={20} result={withLines([singlesLine, playedLine])} playerNames={SINGLES_NAMES} doubles={false} host={host()} analysis={analysis} />);
    const same = (line: EvalLine) => `row ${winPctText(line.end, share)}, this line ends at ${winPctText(line.end, line.endFainted)}`;
    expect(screen.getByText(same(singlesLine))).toBeInTheDocument();
    expect(screen.getByText(same(playedLine))).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });

  test('doubles: the pair line and the played pair line show both numbers, with the sentence once', () => {
    const otherPair: EvalLine = { ...doublesLine, label: 'Other pair', choice: 'move 3, move 4', for: ['played'], end: 0.2, endFainted: 0.3 };
    const base = turnAnalysis(4).p1;
    const analysis = turnAnalysis(4, { p1: { ...base, best: rankedChoice('move 1, move 2', doublesLine.label, 0.6), played: rankedChoice('move 3, move 4', 'Other pair', 0.1) } });
    render(<LinesSection turn={4} result={withLines([doublesLine, otherPair])} playerNames={DOUBLES_NAMES} doubles host={host()} analysis={analysis} />);
    expect(screen.getByText(`row ${winPctText(0.6)}, this line ends at ${winPctText(doublesLine.end, doublesLine.endFainted)}`)).toBeInTheDocument();
    expect(screen.getByText(`row ${winPctText(0.1)}, this line ends at ${winPctText(0.2, 0.3)}`)).toBeInTheDocument();
    expect(screen.getAllByText(SENTENCE)).toHaveLength(1);
  });

  test('without the card\'s analysis the section keeps its old end text and says nothing of rows', () => {
    render(<LinesSection turn={20} result={withLines([singlesLine])} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText(/^ends at \d+% for Pepitopalotin$/)).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });
});

describe('the answer a line meets', () => {
  const ranked = (kind: 'singles' | 'doubles', rows: { p1: string[]; p2: string[] }): EvalResult => {
    const base = withLines([], {});
    const labelled = (labels: string[]) => labels.map((label, index) => rankedChoice(`move ${index}`, label, 0.1 - index * 0.05));
    return { ...base, ...(kind === 'doubles' ? { kind: 'doubles' as const } : {}), perSide: { p1: labelled(rows.p1), p2: labelled(rows.p2) } };
  };

  test('singles: the top answer reads plain, an answer further down carries the explanation as its title', () => {
    const top = { ...ranked('singles', { p1: ['Draining Kiss', 'Surf'], p2: ['Hydro Pump'] }), lines: [singlesLine] };
    const { unmount } = render(<LinesSection turn={20} result={top} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    const plain = screen.getByText("vs Draining Kiss (Tzon's top choice)");
    expect(plain).not.toHaveAttribute('title');
    unmount();
    const second = { ...ranked('singles', { p1: ['Surf', 'Draining Kiss'], p2: ['Hydro Pump'] }), lines: [singlesLine] };
    render(<LinesSection turn={20} result={second} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    const off = screen.getByText("vs Draining Kiss (Tzon's second choice in this search)");
    expect(off).toHaveAttribute('title', expect.stringContaining('another answer'));
  });

  test('doubles: the pair of the other player is named with its rank', () => {
    const pair = 'Sucker Punch → Terapagos + Protect';
    const result = { ...ranked('doubles', { p1: ['Fake Out → Rillaboom + Spore → Zamazenta'], p2: ['Other pair', pair] }), lines: [doublesLine] };
    render(<LinesSection turn={4} result={result} playerNames={DOUBLES_NAMES} doubles host={host()} />);
    expect(screen.getByText(`vs ${pair} (Mstr_Hawk's second choice in this search)`)).toBeInTheDocument();
  });
});

describe('Hard mode in the Lines section', () => {
  // Surf is the lowest cell of Hydro Pump's row: p1's highest cell of its column, 0.4.
  const hurtBy = (lines: EvalLine[]): EvalResult => {
    const base = withLines(lines);
    const p1 = [rankedChoice('move 0', 'Draining Kiss', 0.1), rankedChoice('move 1', 'Surf', 0.05)];
    const p2 = [rankedChoice('move 0', 'Hydro Pump', -0.1), rankedChoice('move 1', 'Hyper Voice', -0.15)];
    return {
      ...base, perSide: { p1, p2 },
      matrix: { p1Labels: ['Draining Kiss', 'Surf'], p2Labels: ['Hydro Pump', 'Hyper Voice'], p1Choices: ['move 0', 'move 1'], p2Choices: ['move 0', 'move 1'], values: [[0.1, 0], [0.4, -0.1]], mixes: { p1: [1, 0], p2: [1, 0] } },
    };
  };
  const meetsSurf: EvalLine = {
    ...singlesLine, versus: 'worst', steps: [{ ...singlesLine.steps[0], p1: { choice: 'move 1', label: 'Surf', slots: [] } }, ...singlesLine.steps.slice(1)],
  };
  const hard = (): LinesHost => ({ ...host(), hardMode: true });

  test('singles, on: the worst line stands where the usual line stood, and its head names the reply', () => {
    render(<LinesSection turn={20} result={hurtBy([singlesLine, meetsSurf])} playerNames={SINGLES_NAMES} doubles={false} host={hard()} />);
    expect(screen.getByText('vs Surf (the reply the search rates lowest for this choice, 32% in its cell)')).toBeInTheDocument();
    expect(screen.queryByText(/Tzon's top choice/)).toBeNull();
    expect(screen.getAllByRole('button', { name: '▶ Play' })).toHaveLength(1);
    expect(screen.queryByText(/No line against/)).toBeNull();
  });

  test('the cell is printed with the card\'s fainted share', () => {
    const analysis = turnAnalysis(20, { p2: { ...turnAnalysis(20).p2, faintedFraction: 0.5, best: rankedChoice('move 1', 'Hydro Pump', 0.1) } });
    render(<LinesSection turn={20} result={hurtBy([singlesLine, meetsSurf])} playerNames={SINGLES_NAMES} doubles={false} host={hard()} analysis={analysis} />);
    expect(screen.getByText(`vs Surf (the reply the search rates lowest for this choice, ${winPctText(-0.4, 0.5)} in its cell)`)).toBeInTheDocument();
  });

  test('singles, on, and no tree holds a line against the reply: today\'s line, with the sentence that says so', () => {
    render(<LinesSection turn={20} result={hurtBy([singlesLine])} playerNames={SINGLES_NAMES} doubles={false} host={hard()} />);
    expect(screen.getByText("vs Draining Kiss (Tzon's top choice)")).toBeInTheDocument();
    expect(screen.getByText('No line against Surf, the reply the search rates lowest for this choice. This line meets Draining Kiss.')).toBeInTheDocument();
  });

  test('singles, off: the usual line and no worst line, no sentence', () => {
    render(<LinesSection turn={20} result={hurtBy([singlesLine, meetsSurf])} playerNames={SINGLES_NAMES} doubles={false} host={host()} />);
    expect(screen.getByText("vs Draining Kiss (Tzon's top choice)")).toBeInTheDocument();
    expect(screen.queryByText(/rates lowest/)).toBeNull();
    expect(screen.getAllByRole('button', { name: '▶ Play' })).toHaveLength(1);
  });

  test('a usual line that already meets the reply reads as the worst line; a thin cell says so', () => {
    const asTop = { ...hurtBy([{ ...singlesLine, steps: meetsSurf.steps }]) };
    render(<LinesSection turn={20} result={asTop} playerNames={SINGLES_NAMES} doubles={false} host={hard()} />);
    expect(screen.getByText('vs Surf (the reply the search rates lowest for this choice, 32% in its cell)')).toBeInTheDocument();
    cleanup();
    const thinCells = { ...hurtBy([{ ...singlesLine, steps: meetsSurf.steps }]) };
    thinCells.matrix = { ...thinCells.matrix!, cells: [[{ visits: 2, verified: false }, { visits: 2, verified: false }], [{ visits: 2, verified: false }, { visits: 2, verified: false }]] };
    thinCells.perSide.p1[1] = { ...thinCells.perSide.p1[1] };
    thinCells.perSide.p2[0] = { ...thinCells.perSide.p2[0], punishedBy: 'Surf' };
    render(<LinesSection turn={20} result={thinCells} playerNames={SINGLES_NAMES} doubles={false} host={hard()} />);
    expect(screen.getByText('vs Surf (the reply the search rates lowest for this choice, from a thinly searched cell)')).toBeInTheDocument();
  });

  test('doubles, on: the joint answer is named like a single one', () => {
    const pair = 'Sucker Punch → Terapagos + Protect';
    const other = 'Other pair';
    const base = withLines([], {});
    const p1 = [rankedChoice('a', 'Fake Out → Rillaboom + Spore → Zamazenta', 0.3)];
    const p2 = [rankedChoice('b', other, -0.3), rankedChoice('c', pair, -0.35)];
    const result: EvalResult = {
      ...base, perSide: { p1, p2 },
      matrix: { p1Labels: [p1[0].label], p2Labels: [other, pair], p1Choices: ['a'], p2Choices: ['b', 'c'], values: [[0.4, 0.2]], mixes: { p1: [1], p2: [1, 0] } },
      lines: [{ ...doublesLine, versus: 'worst' }, { ...doublesLine, steps: [{ ...doublesLine.steps[0], p2: { choice: 'b', label: other, slots: [] } }, ...doublesLine.steps.slice(1)] }],
    };
    render(<LinesSection turn={4} result={result} playerNames={DOUBLES_NAMES} doubles host={hard()} />);
    expect(screen.getByText(`vs ${pair} (the reply the search rates lowest for this choice, ${winPctText(0.2)} in its cell)`)).toBeInTheDocument();
  });

  const MARKER = 'Opponent reads your move: each line meets the reply that hurts its choice most.';

  test.each([
    ['singles', () => render(<LinesSection turn={20} result={hurtBy([singlesLine, meetsSurf])} playerNames={SINGLES_NAMES} doubles={false} host={hard()} />)],
    ['doubles', () => render(<LinesSection turn={4} result={withLines([doublesLine])} playerNames={DOUBLES_NAMES} doubles host={hard()} />)],
  ])('%s, on: the body opens with the marker line, once', (_kind, draw) => {
    const { container } = draw();
    const body = container.querySelector('.ps-eval-lines-body')!;
    expect(body.firstElementChild).toHaveTextContent(MARKER);
    expect(body.firstElementChild).toHaveClass('ps-eval-line');
    expect(screen.getAllByText(MARKER)).toHaveLength(1);
  });

  test.each([
    ['singles', () => render(<LinesSection turn={20} result={hurtBy([singlesLine, meetsSurf])} playerNames={SINGLES_NAMES} doubles={false} host={host()} />)],
    ['doubles', () => render(<LinesSection turn={4} result={withLines([doublesLine])} playerNames={DOUBLES_NAMES} doubles host={host()} />)],
  ])('%s, off: no marker line', (_kind, draw) => {
    draw();
    expect(screen.queryByText(/Opponent reads your move/)).toBeNull();
  });

  test('on, and a turn without lines: the no-line sentence alone', () => {
    const { container } = render(<LinesSection turn={20} result={withLines([])} playerNames={SINGLES_NAMES} doubles={false} host={hard()} />);
    expect(screen.queryByText(/Opponent reads your move/)).toBeNull();
    expect(container.querySelector('.ps-eval-lines-body')?.children).toHaveLength(1);
  });
});
