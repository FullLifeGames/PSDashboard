import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { SetupMenu } from '../../../src/components/SetupMenu';

/**
 * Round 89 (ruling 49): Depth and Samples left the Evaluation header and live in the Setup menu. They keep their options, values, titles
 * and the lock while a search runs; an external engine decides its own depth, so both stay out of the menu then.
 */
const prefs: EvalPreferences = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };

type Search = NonNullable<Parameters<typeof SetupMenu>[0]['search']>;

async function openMenu(overrides: Partial<Search> = {}) {
  const search: Search = { prefs, onPrefsChange: vi.fn(), running: false, external: false, ...overrides };
  const view = render(
    <SetupMenu
      animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={false} onOpponentReadsChange={vi.fn()}
      onEditSide={vi.fn()} onOpenSets={vi.fn()} search={search}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
  return { search, ...view };
}

const select = (label: string) => within(screen.getByText(label)).getByRole('combobox');

describe('Depth and Samples in the Setup menu', () => {
  test('the Depth select routes to a matrix depth, MCTS or Auto, and Samples shows under a matrix depth only', async () => {
    const { search } = await openMenu();
    expect(select('Depth')).toHaveValue('1');
    expect([...select('Depth').querySelectorAll('option')].map(option => [option.value, option.textContent])).toEqual([['1', '1'], ['2', '2'], ['mcts', 'MCTS'], ['auto', 'Auto']]);
    await userEvent.selectOptions(select('Depth'), '2');
    expect(search.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, mode: 'matrix', depth: 2 });
    await userEvent.selectOptions(select('Depth'), 'mcts');
    expect(search.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, mode: 'mcts' });
    await userEvent.selectOptions(select('Depth'), 'auto');
    expect(search.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, mode: 'auto' });
    expect([...select('Samples').querySelectorAll('option')].map(option => option.value)).toEqual(['1', '3', '5']);
    await userEvent.selectOptions(select('Samples'), '5');
    expect(search.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, samples: 5 });
    expect(screen.getByText('Samples')).toHaveAttribute('title', expect.stringContaining('Damage-roll seeds averaged per cell.'));
  });

  test.each([['auto'], ['mcts']] as const)('mode %s shows Depth and no Samples; a stored matrix depth of 2 shows both and lets the user return to Auto', async mode => {
    const view = await openMenu({ prefs: { ...prefs, mode } });
    expect(select('Depth')).toHaveValue(mode);
    expect(screen.queryByText('Samples')).toBeNull();
    view.unmount();
    const stored = await openMenu({ prefs: { ...prefs, depth: 2, mode: 'matrix' } });
    expect(select('Depth')).toHaveValue('2');
    expect(select('Samples')).toBeEnabled();
    await userEvent.selectOptions(select('Depth'), 'auto');
    expect(stored.search.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, depth: 2, mode: 'auto' });
  });

  test('the Auto title names the search budget in force', async () => {
    localStorage.setItem('ps-replay-interceptor:search-budget', 'trees=8,iterations=1200,singles-tree-from=0.5,doubles-tree-from=0.25,doubles-early-samples=5');
    onTestFinished(() => localStorage.removeItem('ps-replay-interceptor:search-budget'));
    await openMenu({ prefs: { ...prefs, mode: 'auto' } });
    expect(select('Depth')).toHaveAttribute('title', 'Auto picks the engine per turn. Singles: the depth-1 matrix with 3 samples until 50% of all Pokémon have fainted, then the MCTS tree. Doubles: the depth-1 matrix with 5 samples until 25% of all Pokémon have fainted, then the MCTS tree. The MCTS search runs 8 trees of 1200 iterations each.');
  });

  test('both selects lock while a search runs, and a pick keeps the menu open', async () => {
    const { search, rerender } = await openMenu();
    await userEvent.selectOptions(select('Depth'), '2');
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
    rerender(
      <SetupMenu
        animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={false} onOpponentReadsChange={vi.fn()}
        onEditSide={vi.fn()} onOpenSets={vi.fn()} search={{ ...search, running: true }}
      />,
    );
    expect(select('Depth')).toBeDisabled();
    expect(select('Samples')).toBeDisabled();
  });

  test('another engine decides its own depth: neither select is drawn', async () => {
    await openMenu({ external: true });
    expect(screen.queryByText('Depth')).toBeNull();
    expect(screen.queryByText('Samples')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Player' })).toBeInTheDocument();
  });

  test('a menu without search props (an embedded view) draws neither select', async () => {
    render(<SetupMenu animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={false} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.queryByText('Depth')).toBeNull();
  });
});
