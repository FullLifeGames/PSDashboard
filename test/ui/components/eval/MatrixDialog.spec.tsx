import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winPercent, type EvalResult, type RankedChoice, type TurnAnalysis } from '@fulllifegames/eval-engine';
import { MatrixDialogButton } from '../../../../src/components/eval/MatrixDialog';
import { worstReply } from '../../../../src/lib/worst-reply';
import { evalResult, rankedChoice } from '../../fixtures/eval-result';
import { sideAnalysis, turnAnalysis } from '../../fixtures/analysis';

const names: [string, string] = ['Alice', 'Bob'];

/** The fixture's singles turn: p1 played Swords Dance (row 1) against Body Press (column 1); the engine's rows are Earthquake and Leech Seed. */
function singles(): { result: EvalResult; analysis: TurnAnalysis } {
  const result = evalResult('singles');
  const [earthquake, swordsDance] = result.perSide.p1;
  const [leechSeed, bodyPress] = result.perSide.p2;
  const analysis = turnAnalysis(5, {
    p1: sideAnalysis({ played: swordsDance, best: earthquake, safe: earthquake, regret: 0.15 }),
    p2: sideAnalysis({ played: bodyPress, best: leechSeed, safe: leechSeed, regret: 0.1 }),
  });
  return { result, analysis };
}

/** A doubles turn with a 12 x 19 matrix (the size of Doubles OU 912045 turn 8): joint choices as pairs, long labels. */
function doubles(): { result: EvalResult; analysis: TurnAnalysis } {
  const rows = Array.from({ length: 12 }, (_, i) => rankedChoice(`move a${i} 1, move b${i}`, `Fake Out → Rillaboom ${i} + Spore → Tornadus ${i}`, 0.3 - i * 0.02));
  const columns = Array.from({ length: 19 }, (_, j) => rankedChoice(`move c${j}, move d${j} 1`, `Tailwind ${j} + Grassy Glide → Incineroar ${j}`, -0.2 - j * 0.01));
  const result = evalResult('doubles', {
    perSide: { p1: rows, p2: columns },
    matrix: {
      p1Labels: rows.map(r => r.label), p2Labels: columns.map(c => c.label),
      p1Choices: rows.map(r => r.choice), p2Choices: columns.map(c => c.choice),
      values: rows.map((_, i) => columns.map((__, j) => 0.3 - i * 0.02 + ((i * 7 + j * 3) % 11) * 0.03 - 0.1)),
      mixes: { p1: rows.map((_, i) => (i === 2 ? 0.7 : i === 3 ? 0.3 : 0)), p2: columns.map((_, j) => (j === 4 ? 1 : 0)) },
    },
  });
  const analysis = turnAnalysis(8, {
    p1: sideAnalysis({ played: rows[5], best: rows[2], safe: rows[2], regret: 0.1 }),
    p2: sideAnalysis({ played: columns[9], best: columns[4], safe: columns[4], regret: 0.1 }),
  });
  return { result, analysis };
}

type Scene = { result: EvalResult | null; analysis: TurnAnalysis };

function renderButton(scene: Scene, extra: Partial<React.ComponentProps<typeof MatrixDialogButton>> = {}) {
  return render(<MatrixDialogButton result={scene.result} analysis={scene.analysis} playerNames={names} {...extra} />);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headerOf = (table: HTMLElement, label: string) => within(table).getByText(label).closest('th')!;

describe('MatrixDialogButton', () => {
  test('no matrix, no button', () => {
    renderButton({ result: evalResult('singles', { matrix: undefined }), analysis: singles().analysis });
    expect(screen.queryByRole('button', { name: 'Open matrix' })).toBeNull();
    renderButton({ result: null, analysis: singles().analysis });
    expect(screen.queryByRole('button', { name: 'Open matrix' })).toBeNull();
  });

  test('the button takes the size of the panel\'s other buttons (Re-analyze, Analyze game: 10 px, 1px 6px), not the full .ps-btn', () => {
    renderButton(singles());
    const button = screen.getByRole('button', { name: 'Open matrix' });
    expect(button).toHaveStyle({ fontSize: '10px', padding: '1px 6px' });
  });

  test('"worst" is a tag in the style of "played" and "engine": light red text in a bordered box, not the dashed outline\'s dark red', async () => {
    renderButton(singles());
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const worst = within(screen.getByRole('table')).getAllByText('worst')[0];
    const played = within(screen.getByRole('table')).getAllByText('played')[0];
    expect(worst).toHaveStyle({ color: '#f3a6a6', fontSize: '9px', border: '1px solid #f3a6a6' });
    expect(worst.style.borderRadius).toBe(played.style.borderRadius);
    expect(worst.style.padding).toBe(played.style.padding);
  });

  test('the button opens a dialog titled with the turn and both names; the overview toggle is not in it', async () => {
    renderButton(singles());
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const dialog = screen.getByRole('dialog', { name: "Turn 5 · Alice's choices against Bob's" });
    expect(within(dialog).getByRole('table')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('row')).toHaveLength(4);
  });

  test('singles: the played row and column, the engine rows and columns, every weight and both worst cells carry a word, not only a colour', async () => {
    const { result, analysis } = singles();
    renderButton({ result, analysis });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const table = screen.getByRole('table');
    // p1 played Swords Dance, the engine's row is Earthquake; p2 played Body Press, the engine's column is Leech Seed
    expect(headerOf(table, 'Swords Dance')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Swords Dance')).not.toHaveTextContent(/engine/);
    expect(headerOf(table, 'Earthquake')).toHaveTextContent(/engine/);
    expect(headerOf(table, 'Earthquake')).not.toHaveTextContent(/played/);
    expect(headerOf(table, '→ Heatran')).not.toHaveTextContent(/played|engine/);
    expect(headerOf(table, 'Body Press')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Leech Seed')).toHaveTextContent(/engine/);
    expect(headerOf(table, '→ Rotom-Wash')).not.toHaveTextContent(/played|engine/);
    expect(headerOf(table, 'Earthquake')).toHaveTextContent('100%');
    expect(headerOf(table, 'Swords Dance')).toHaveTextContent('0%');
    expect(headerOf(table, 'Body Press')).toHaveTextContent('0%');
    expect(headerOf(table, 'Leech Seed')).toHaveTextContent('100%');
    // the worst cell of Alice's played row is the cell worstReply names; Bob's is the highest cell of his played column
    const aliceWorst = worstReply(result, 'p1', analysis.p1.played!)!;
    expect(aliceWorst.basis).toBe('cell');
    const bobWorst = worstReply(result, 'p2', analysis.p2.played!)!;
    expect(bobWorst.basis).toBe('cell');
    const marked = within(table).getAllByText(/worst/);
    expect(marked).toHaveLength(2);
    const aliceCell = screen.getByTitle(new RegExp(`^Swords Dance × ${escaped(aliceWorst.reply.label)}:`));
    expect(aliceCell).toHaveTextContent(/worst/);
    expect(aliceCell).toHaveAttribute('title', expect.stringContaining("worst reply to Alice's Swords Dance"));
    const bobCell = screen.getByTitle(new RegExp(`^${escaped(bobWorst.reply.label)} × Body Press:`));
    expect(bobCell).toHaveTextContent(/worst/);
    expect(bobCell).toHaveAttribute('title', expect.stringContaining("worst reply to Bob's Body Press"));
    expect(aliceCell).not.toBe(bobCell);
    expect(aliceCell).toHaveTextContent(`${winPercent(result.matrix!.values[1][2])}%`);
  });

  test('a side knocked out before it moved has no played column and no worst cell (655336 t27); the side that moved keeps both', async () => {
    const { result, analysis } = singles();
    const phantom = { ...analysis.p2.played!, label: 'stayed in (KO’d before acting)' };
    const patched: TurnAnalysis = { ...analysis, p2: { ...analysis.p2, played: phantom, neverActed: true } };
    renderButton({ result, analysis: patched });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const table = screen.getByRole('table');
    expect(headerOf(table, 'Swords Dance')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Body Press')).not.toHaveTextContent(/played/);
    expect(within(table).queryAllByText('played')).toHaveLength(1);
    expect(within(table).getAllByText(/worst/)).toHaveLength(1);
    expect(screen.queryByTitle(/worst reply to Bob's/)).toBeNull();
  });

  test('a played pair that is also the engine pair, and a cell that is worst for both, mark once each', async () => {
    const result = evalResult('singles');
    const [earthquake] = result.perSide.p1;
    const [leechSeed] = result.perSide.p2;
    const analysis = turnAnalysis(5, {
      p1: sideAnalysis({ played: earthquake, best: earthquake, safe: earthquake }),
      p2: sideAnalysis({ played: leechSeed, best: leechSeed, safe: leechSeed }),
    });
    renderButton({ result, analysis });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const table = screen.getByRole('table');
    expect(headerOf(table, 'Earthquake')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Earthquake')).toHaveTextContent(/engine/);
    expect(headerOf(table, 'Leech Seed')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Leech Seed')).toHaveTextContent(/engine/);
  });

  test('doubles 12 x 19: the pair labels stay whole, the table scrolls inside the dialog, the marks land on the right row and column', async () => {
    const { result, analysis } = doubles();
    renderButton({ result, analysis });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const dialog = screen.getByRole('dialog');
    const table = within(dialog).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(20);
    // the wide table scrolls in its own box, the dialog does not grow sideways
    const scroller = table.parentElement!;
    expect(scroller).toHaveStyle({ overflow: 'auto' });
    const label = headerOf(table, 'Fake Out → Rillaboom 5 + Spore → Tornadus 5');
    expect(label.style.whiteSpace).not.toBe('nowrap');
    expect(label.style.textOverflow).not.toBe('ellipsis');
    expect(label).toHaveTextContent(/played/);
    expect(headerOf(table, 'Fake Out → Rillaboom 2 + Spore → Tornadus 2')).toHaveTextContent(/engine/);
    expect(headerOf(table, 'Fake Out → Rillaboom 2 + Spore → Tornadus 2')).toHaveTextContent('70%');
    expect(headerOf(table, 'Fake Out → Rillaboom 3 + Spore → Tornadus 3')).toHaveTextContent('30%');
    expect(headerOf(table, 'Fake Out → Rillaboom 0 + Spore → Tornadus 0')).toHaveTextContent('0%');
    expect(headerOf(table, 'Tailwind 9 + Grassy Glide → Incineroar 9')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Tailwind 4 + Grassy Glide → Incineroar 4')).toHaveTextContent(/engine/);
    expect(headerOf(table, 'Tailwind 4 + Grassy Glide → Incineroar 4')).toHaveTextContent('100%');
    // the worst cell of p1's played row is the one the Hard mode rule names
    const worst = worstReply(result, 'p1', analysis.p1.played!)!;
    const cell = screen.getByTitle(new RegExp(`^${escaped('Fake Out → Rillaboom 5 + Spore → Tornadus 5')} × ${escaped(worst.reply.label)}:`));
    expect(cell).toHaveTextContent(/worst/);
  });

  test('a cell click hands the pair over and closes the dialog; without a handler the cells are plain', async () => {
    const onPickPair = vi.fn();
    const { result, analysis } = singles();
    const { unmount } = renderButton({ result, analysis }, { onPickPair });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    await userEvent.click(screen.getByTitle(/^Swords Dance × Body Press:/));
    expect(onPickPair).toHaveBeenCalledWith({ choice: 'move swordsdance', label: 'Swords Dance' }, { choice: 'move bodypress', label: 'Body Press' });
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    renderButton({ result, analysis });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    expect(screen.getByTitle(/^Swords Dance × Body Press:/).tagName).toBe('TD');
    expect(screen.getByText(/Cells:/)).toBeInTheDocument();
  });

  test('results without choice ids stay read-only and mark nothing but the weights', async () => {
    const { result, analysis } = singles();
    const legacy = { ...result, matrix: { ...result.matrix!, p1Choices: undefined, p2Choices: undefined } };
    renderButton({ result: legacy, analysis }, { onPickPair: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    expect(screen.getByTitle(/^Swords Dance × Body Press:/).tagName).toBe('TD');
    const table = screen.getByRole('table');
    expect(headerOf(table, 'Swords Dance')).toHaveTextContent(/played/);
    expect(headerOf(table, 'Earthquake')).toHaveTextContent(/engine/);
    expect(within(table).queryByText(/worst/)).toBeNull();
  });

  test('an open tip has no played marks, only the engine rows', async () => {
    const { result } = singles();
    const open = turnAnalysis(5, {
      p1: sideAnalysis({ played: null, best: result.perSide.p1[0], regret: null }),
      p2: sideAnalysis({ played: null, best: result.perSide.p2[0], regret: null }),
    });
    renderButton({ result, analysis: open });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    const table = screen.getByRole('table');
    expect(within(table).queryByText(/played/)).toBeNull();
    expect(within(table).queryByText(/worst/)).toBeNull();
    expect(headerOf(table, 'Earthquake')).toHaveTextContent(/engine/);
    expect(headerOf(table, 'Leech Seed')).toHaveTextContent(/engine/);
  });

  test('a played action the engine never ranked (a doubles slot it cannot read) marks no row', async () => {
    const { result, analysis } = singles();
    const stray: RankedChoice = rankedChoice('move uturn', 'U-turn', 0);
    renderButton({ result, analysis: { ...analysis, p1: { ...analysis.p1, played: stray } } });
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    expect(within(screen.getByRole('table')).queryAllByText(/played/)).toHaveLength(1);
  });

  test('Escape closes the dialog and hands the focus back to the button; Tab stays inside', async () => {
    const { result, analysis } = singles();
    renderButton({ result, analysis }, { onPickPair: vi.fn() });
    const button = screen.getByRole('button', { name: 'Open matrix' });
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    for (let step = 0; step < 14; step++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  test('the muted line under the table says what cells and headers mean', async () => {
    renderButton(singles());
    await userEvent.click(screen.getByRole('button', { name: 'Open matrix' }));
    expect(screen.getByText(/Cells: Alice's chance to win for that pair/)).toHaveTextContent(/Headers: how often the engine expects each choice/);
  });
});
