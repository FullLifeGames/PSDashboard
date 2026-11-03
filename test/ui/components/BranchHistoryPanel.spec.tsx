import type { ReactElement } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchHistoryPanel } from '../../../src/components/BranchHistoryPanel';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
import { replayFixture } from '../fixtures/replay';
import { pokemon } from '../fixtures/sim-state';

const { snapshots } = replayFixture('singles');

/** Round 84 (A7f, ruling 18a): the panel starts closed under a one-line toggle; these cases read what stands inside it. */
const toggle = () => screen.getByRole('button', { name: /Variation moves/ });
function renderOpen(ui: ReactElement) {
  const result = render(ui);
  fireEvent.click(toggle());
  return result;
}

const entry = (turnNumber: number, extra: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move earthquake', p2Choice: 'switch 3',
  p1SlotChoices: [{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }],
  p2SlotChoices: [{ kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }],
  p1Active: pokemon('Garchomp', { isActive: true, activeSlot: 0 }), p1ActiveSlots: [pokemon('Garchomp', { isActive: true, activeSlot: 0 })],
  p2Active: pokemon('Rotom-Wash', { isActive: true, activeSlot: 0 }), p2ActiveSlots: [pokemon('Rotom-Wash', { isActive: true, activeSlot: 0 })],
  p1Pokemon: [pokemon('Garchomp')], p2Pokemon: [pokemon('Rotom-Wash')],
  ...extra,
});

describe('BranchHistoryPanel', () => {
  test('without moves it explains what the panel will show', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[]} snapshots={snapshots} />);
    expect(toggle()).toHaveTextContent('Variation moves');
    fireEvent.click(toggle());
    expect(screen.getByText(/Execute turns to compare/)).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // Round 84 (A7f, ruling 18a): at 150 % the open panel slid under the sticky dock, so it sits closed like the turn explanation.
  test('it starts closed: the toggle counts the turns, the body and the hint are hidden, and a click opens and closes it', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), entry(3)]} snapshots={snapshots} onNavigate={vi.fn()} />);
    expect(toggle()).toHaveTextContent('▸ Variation moves · 2 turns');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    const body = document.getElementById(toggle().getAttribute('aria-controls')!)!;
    expect(body).toHaveAttribute('hidden');
    expect(screen.queryByRole('button', { name: /Tip of the variation/ })).toBeNull();
    expect(screen.getByText(/click a cell to jump/)).not.toBeVisible();
    fireEvent.click(toggle());
    expect(toggle()).toHaveTextContent('▾ Variation moves · 2 turns');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(body).not.toHaveAttribute('hidden');
    expect(screen.getByText(/click a cell to jump/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Tip of the variation/ })).toBeVisible();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  test('the count reads "1 turn", skips forced replacements, and is absent before the first turn', () => {
    const forced = entry(3, { kind: 'forced', forcedSide: 'p2', p1Choice: '—', p2Choice: 'switch 3' });
    const { rerender } = render(<BranchHistoryPanel branchStartTurn={2} history={[]} snapshots={snapshots} />);
    expect(toggle()).toHaveTextContent(/^▸ Variation moves$/);
    rerender(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} />);
    expect(toggle()).toHaveTextContent('▸ Variation moves · 1 turn');
    expect(toggle()).not.toHaveTextContent('1 turns');
    rerender(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), forced]} snapshots={snapshots} />);
    expect(toggle()).toHaveTextContent('▸ Variation moves · 1 turn');
  });

  test('the state stays as the user set it while the variation lives, and a new variation starts closed (the caller keys it by its start turn)', () => {
    const view = (start: number, history: BranchHistoryEntry[]) => <BranchHistoryPanel key={start} branchStartTurn={start} history={history} snapshots={snapshots} />;
    const { rerender } = render(view(2, [entry(2)]));
    fireEvent.click(toggle());
    rerender(view(2, [entry(2), entry(3)]));
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    rerender(view(5, [entry(5)]));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  test('every executed turn gets a row with both choices, a main-line cell, and a variation cell that navigate', async () => {
    const onNavigate = vi.fn();
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), entry(3)]} snapshots={snapshots} currentPosition={{ turn: 3, line: 'variation' }} onNavigate={onNavigate} />);
    expect(screen.getByText(/click a cell to jump/)).toBeInTheDocument();
    expect(screen.getByText('Turn 2')).toBeInTheDocument();
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.getAllByText(/Earthquake/).length).toBeGreaterThanOrEqual(2);

    // Each executed entry stands for the position AFTER its turn: entry 2 lands on turn 3.
    await userEvent.click(screen.getByRole('button', { name: /Main line \(turn 3\)/ }));
    expect(onNavigate).toHaveBeenCalledWith({ turn: 3, line: 'main' });
    const variationCells = screen.getAllByRole('button', { name: /Variation result/ });
    await userEvent.click(variationCells[0]);
    expect(onNavigate).toHaveBeenCalledWith({ turn: 3, line: 'variation' });
    expect(variationCells[0]).toHaveStyle({ outline: '1px solid #f0c76b' });

    await userEvent.click(screen.getByRole('button', { name: /Tip of the variation/ }));
    expect(onNavigate).toHaveBeenCalledWith({ turn: 4, line: 'variation' });
  });

  // Round 77 (C7): the panel does not know singles from doubles; an ended tip offers no play on.
  test('an ended tip says the game ends there and no longer invites to continue', async () => {
    const onNavigate = vi.fn();
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), entry(3)]} snapshots={snapshots} onNavigate={onNavigate} ended />);
    expect(screen.queryByRole('button', { name: /continue playing here/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'End of the variation: the game is over here' }));
    expect(onNavigate).toHaveBeenCalledWith({ turn: 4, line: 'variation' });
  });

  test('a forced replacement is its own row and consumes no turn', () => {
    const forced = entry(3, { kind: 'forced', forcedSide: 'p2', p1Choice: '—', p2Choice: 'switch 3' });
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), forced, entry(3)]} snapshots={snapshots} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Turn 3 · forced replacement \(P2\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tip of the variation/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Variation result/ })).toHaveLength(2);
  });

  describe('the variation cell names the Pokemon that stands at the row\'s position (A-5)', () => {
    const live = (species: string, slot = 0) => pokemon(species, { isActive: true, activeSlot: slot });
    const variationCell = (index: number) => screen.getAllByRole('button', { name: /Variation result/ })[index];

    test('singles: a pivot turn followed by the forced replacement shows the replacement', () => {
      const pivot = entry(8, {
        p1Choice: 'move uturn', p2Choice: 'move recover',
        p1Active: live('Talonflame'), p1ActiveSlots: [live('Talonflame')],
      });
      const replacement = entry(8, {
        kind: 'forced', forcedSide: 'p1', p1Choice: 'switch 3', p2Choice: '—',
        p1Active: live('Tentacruel'), p1ActiveSlots: [live('Tentacruel')],
      });
      renderOpen(<BranchHistoryPanel branchStartTurn={7} history={[pivot, replacement]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent('P1: Tentacruel');
      expect(variationCell(0)).not.toHaveTextContent('Talonflame');
    });

    test('singles: a knock-out followed by two chained forced entries shows the last state', () => {
      const knockOut = entry(8, { p1Active: live('Palossand'), p1ActiveSlots: [live('Palossand')] });
      const first = entry(8, { kind: 'forced', forcedSide: 'p1', p1Active: live('Kyurem'), p1ActiveSlots: [live('Kyurem')] });
      const second = entry(8, { kind: 'forced', forcedSide: 'p2', p1Active: live('Kyurem'), p1ActiveSlots: [live('Kyurem')], p2Active: live('Rotom-Wash'), p2ActiveSlots: [live('Rotom-Wash')] });
      renderOpen(<BranchHistoryPanel branchStartTurn={7} history={[knockOut, first, second]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent('P1: Kyurem');
      expect(variationCell(0)).toHaveTextContent('P2: Rotom-Wash');
    });

    test('doubles: only the replaced slot changes in the cell', () => {
      const turn = entry(8, {
        p1ActiveSlots: [live('Talonflame', 0), live('Garchomp', 1)],
        p2ActiveSlots: [live('Rotom-Wash', 0), live('Kyurem', 1)],
      });
      const replacement = entry(8, {
        kind: 'forced', forcedSide: 'p1',
        p1ActiveSlots: [live('Tentacruel', 0), live('Garchomp', 1)],
        p2ActiveSlots: [live('Rotom-Wash', 0), live('Kyurem', 1)],
      });
      renderOpen(<BranchHistoryPanel branchStartTurn={7} history={[turn, replacement]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent(/P1: Tentacruel \d+% \/ Garchomp/);
      expect(variationCell(0)).not.toHaveTextContent('Talonflame');
    });

    test('a forced entry in the middle only changes the row it follows', () => {
      const first = entry(8, { p1Active: live('Talonflame'), p1ActiveSlots: [live('Talonflame')] });
      const replacement = entry(8, { kind: 'forced', forcedSide: 'p1', p1Active: live('Tentacruel'), p1ActiveSlots: [live('Tentacruel')] });
      const second = entry(9, { p1Active: live('Tentacruel'), p1ActiveSlots: [live('Tentacruel')] });
      renderOpen(<BranchHistoryPanel branchStartTurn={7} history={[first, replacement, second]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent('P1: Tentacruel');
      expect(variationCell(1)).toHaveTextContent('P1: Tentacruel');
    });
  });

  test('without a navigation handler the cells are inert', () => {
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} />);
    expect(screen.queryByText(/click a cell to jump/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tip of the variation/ })).toBeNull();
  });
});

// Round 82 (forced dice), step A7c, decision 6a: a row lists the dice the user forced in its turn and says which took no effect.
describe('the dice of a turn in its row', () => {
  const marks = (p1: { label: string; noEffect?: string }[], p2: { label: string; noEffect?: string }[] = []) => ({ p1, p2 });
  const diceLine = () => screen.getByRole('group', { name: 'Forced dice' });

  test.each([
    ['singles', [{ label: 'Air Slash: Flinch' }], [], ['P1 Air Slash: Flinch']],
    ['doubles', [{ label: 'Air Slash: Flinch' }, { label: 'Rock Slide: Hits' }], [{ label: 'Scald: Burn' }], ['P1 Air Slash: Flinch', 'P1 Rock Slide: Hits', 'P2 Scald: Burn']],
  ])('%s: the row names each forced die with its side', (_kind, p1, p2, texts) => {
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2, { diceMarks: marks(p1, p2) })]} snapshots={snapshots} />);
    const line = diceLine();
    expect(line).toHaveTextContent('Forced dice');
    texts.forEach(text => expect(within(line).getByText(text)).toBeInTheDocument());
  });

  test('a die that took no effect says so, and the reason sits in its title', () => {
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2, { diceMarks: marks([{ label: 'Air Slash: Flinch', noEffect: 'Air Slash did not run' }, { label: 'Air Slash: Hits' }]) })]} snapshots={snapshots} />);
    const void_ = within(diceLine()).getByText('P1 Air Slash: Flinch (no effect)');
    expect(void_).toHaveAttribute('title', 'Air Slash did not run');
    expect(within(diceLine()).getByText('P1 Air Slash: Hits')).not.toHaveAttribute('title');
  });

  test('a turn without a forced die has no dice line', () => {
    renderOpen(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} />);
    expect(screen.queryByRole('group', { name: 'Forced dice' })).toBeNull();
  });

  test('a turn that paused for a switch shows the joined report once, on the turn row and not on the replacement row', () => {
    const turn = entry(8, { diceMarks: marks([], [{ label: 'Scald: Burn', noEffect: 'not reached' }]) });
    const replacement = entry(8, { kind: 'forced', forcedSide: 'p1', p1Choice: 'switch 3', p2Choice: '—', diceMarks: marks([{ label: 'Volt Switch: Hits' }], [{ label: 'Scald: Burn' }]) });
    renderOpen(<BranchHistoryPanel branchStartTurn={7} history={[turn, replacement]} snapshots={snapshots} />);
    expect(screen.getAllByRole('group', { name: 'Forced dice' })).toHaveLength(1);
    expect(within(diceLine()).getByText('P2 Scald: Burn')).toBeInTheDocument();
    expect(within(diceLine()).getByText('P1 Volt Switch: Hits')).toBeInTheDocument();
    expect(screen.queryByText(/no effect/)).toBeNull();
  });
});

/** Round 84 (A7i, ruling 20a): the caller hands in the buttons for the toggle line, a line under it, and the saved rows for the body. */
describe('the slots of the toggle line', () => {
  const slots = (onOpenChange = vi.fn()) => ({
    actions: <><button type="button">Save here</button><button type="button">Share here</button></>,
    status: (open: boolean) => <div>{open ? 'status open' : 'status closed'}</div>,
    saved: <div>saved rows</div>,
    onOpenChange,
  });

  test('the actions stand at the right end of the toggle line, outside the toggle button', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} slots={slots()} />);
    const line = toggle().parentElement!;
    for (const name of ['Save here', 'Share here']) {
      const button = screen.getByRole('button', { name });
      expect(line).toContainElement(button);
      expect(toggle()).not.toContainElement(button);
      expect(button).toBeVisible();
    }
    expect(toggle().nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Save here' }));
    expect(toggle()).toHaveAccessibleName('▸ Variation moves · 1 turn');
  });

  test('the status line shows under the toggle line, closed or open', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} slots={slots()} />);
    expect(screen.getByText('status closed')).toBeVisible();
    expect(toggle().parentElement!.nextElementSibling).toHaveTextContent('status closed');
    fireEvent.click(toggle());
    expect(screen.getByText('status open')).toBeVisible();
  });

  test('the saved rows live in the body: hidden while closed, shown when open, and the callback hears each toggle', () => {
    const onOpenChange = vi.fn();
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} slots={slots(onOpenChange)} />);
    const body = document.getElementById(toggle().getAttribute('aria-controls')!)!;
    expect(body).toContainElement(screen.getByText('saved rows'));
    expect(screen.getByText('saved rows')).not.toBeVisible();
    fireEvent.click(toggle());
    expect(screen.getByText('saved rows')).toBeVisible();
    fireEvent.click(toggle());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});
