import { afterEach, beforeEach, describe, expect, test, vi, onTestFinished } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupMenu } from '../../../src/components/SetupMenu';
import { UI_SCALE_STORAGE_KEY } from '../../../src/lib/ui-scale-setting';
import { getUiScaleState, startUiScale } from '../../../src/lib/ui-scale-store';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { BUILTIN_ENGINE, type EngineEntry } from '../../../src/lib/engines/registry';

describe('SetupMenu.size', () => {
  let stop: (() => void) | null = null;

  function windowOf(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  async function openMenu() {
    render(<SetupMenu animateBranchTurns onAnimateChange={vi.fn()} opponentReads={false} onOpponentReadsChange={vi.fn()} onEditSide={vi.fn()} onOpenSets={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    return screen.getByRole('combobox', { name: 'Size' }) as HTMLSelectElement;
  }

  const labels = (select: HTMLSelectElement) => within(select).getAllByRole('option').map(option => option.textContent);

  beforeEach(() => { localStorage.clear(); windowOf(2560, 1290); });
  afterEach(() => { stop?.(); stop = null; });

  describe('the Size select', () => {
    test('stands in the Setup menu, reads Auto with the step it gives, and lists the five steps', async () => {
      stop = startUiScale();
      const select = await openMenu();
      expect(select.value).toBe('auto');
      expect(labels(select)).toEqual(['Auto (150 %)', '100 %', '125 %', '150 %', '175 %', '200 %']);
      expect(select.closest('.ps-setup-panel')).not.toBeNull();
    });

    test('a choice overrides Auto, persists, and the menu stays open; Auto takes it back', async () => {
      stop = startUiScale();
      const select = await openMenu();
      await userEvent.selectOptions(select, '125 %');
      expect(getUiScaleState()).toMatchObject({ setting: 1.25, scale: 1.25 });
      expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBe('1.25');
      expect(select.value).toBe('1.25');
      expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
      await userEvent.selectOptions(select, 'Auto (150 %)');
      expect(getUiScaleState()).toMatchObject({ setting: 'auto', scale: 1.5 });
      expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBeNull();
    });

    test('a stored step is the select\'s value after a reload', async () => {
      localStorage.setItem(UI_SCALE_STORAGE_KEY, '1.75');
      stop = startUiScale();
      const select = await openMenu();
      expect(select.value).toBe('1.75');
      expect(labels(select)[0]).toBe('Auto (150 %)');
    });

    test('a step that leaves the app less than 1050 px is disabled and names the width it needs', async () => {
      windowOf(1600, 1000);
      stop = startUiScale();
      const select = await openMenu();
      const option = (name: RegExp) => within(select).getByRole('option', { name }) as HTMLOptionElement;
      expect(option(/^150 %/).disabled).toBe(false);
      expect(option(/^175 %/).disabled).toBe(true);
      expect(option(/^200 %/).disabled).toBe(true);
      // 1050 times the step, rounded up: 1838 px for 175 %, 2100 px for 200 %.
      expect(option(/^175 %/).textContent).toBe('175 % (needs a window at least 1838 px wide)');
      expect(option(/^200 %/).textContent).toBe('200 % (needs a window at least 2100 px wide)');
      expect(option(/^100 %/).textContent).toBe('100 %');
    });

    test('the window growing enables a step the menu showed disabled', async () => {
      windowOf(1600, 1000);
      stop = startUiScale();
      const select = await openMenu();
      expect((within(select).getByRole('option', { name: /^175 %/ }) as HTMLOptionElement).disabled).toBe(true);
      windowOf(2000, 1000);
      window.dispatchEvent(new Event('resize'));
      expect((await screen.findByRole('option', { name: '175 %' }) as HTMLOptionElement).disabled).toBe(false);
    });

    test('the window shrinking disables the steps it can no longer hold, relabels them, and holds a chosen 200 % back to 150 %', async () => {
      localStorage.setItem(UI_SCALE_STORAGE_KEY, '2');
      stop = startUiScale();
      const select = await openMenu();
      const option = (name: RegExp) => within(select).getByRole('option', { name }) as HTMLOptionElement;
      expect(option(/^175 %/).disabled).toBe(false);
      expect(option(/^200 %/).disabled).toBe(false);
      expect(getUiScaleState()).toMatchObject({ setting: 2, scale: 2 });
      windowOf(1600, 1000);
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(option(/^175 %/).disabled).toBe(true);
      expect(option(/^200 %/).disabled).toBe(true);
      expect(option(/^175 %/).textContent).toBe('175 % (needs a window at least 1838 px wide)');
      expect(option(/^150 %/).disabled).toBe(false);
      expect(getUiScaleState()).toMatchObject({ setting: 2, scale: 1.5, width: 1600 });
      expect(document.documentElement.style.getPropertyValue('--ps-scale')).toBe('1.5');
      windowOf(2560, 1290);
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(option(/^200 %/).disabled).toBe(false);
      expect(document.documentElement.style.getPropertyValue('--ps-scale')).toBe('2');
    });
  });
});

function menu(opponentReads: boolean, onOpponentReadsChange = vi.fn()) {
  render(
    <SetupMenu
      animateBranchTurns={false} onAnimateChange={vi.fn()} opponentReads={opponentReads} onOpponentReadsChange={onOpponentReadsChange}
      onEditSide={vi.fn()} onOpenSets={vi.fn()}
    />,
  );
  return onOpponentReadsChange;
}

describe('the "Opponent reads my move" checkbox in the Setup menu', () => {
  test.each([[false], [true]])('mirrors the flag (%s), stands under "Animate branch turns", and keeps the menu open on a click', async flag => {
    const onChange = menu(flag);
    expect(screen.queryByRole('checkbox', { name: 'Opponent reads my move' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    const box = screen.getByRole('checkbox', { name: 'Opponent reads my move' });
    if (flag) expect(box).toBeChecked(); else expect(box).not.toBeChecked();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map(item => item.closest('label')?.textContent?.trim())).toEqual(['Animate branch turns', 'Opponent reads my move']);
    expect(box.closest('.ps-setup-panel')).not.toBeNull();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(!flag);
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('its title says what the opponent does, where, and that grades stay', async () => {
    menu(false);
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByRole('checkbox', { name: 'Opponent reads my move' }).closest('label')).toHaveAttribute(
      'title',
      'In a variation the opponent answers each move you pick with the reply the search rates lowest for it, as if it had read your move: '
      + 'when you click an engine move, in the turn dock, and in a turn\'s lines and the Game review. '
      + 'Off, it plays its own top choice, which does not depend on your move. Grades and scores stay as they are. A change applies from your next pick.',
    );
  });
});

const prefs: EvalPreferences = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' };

type Search = NonNullable<Parameters<typeof SetupMenu>[0]['search']>;

async function openMenu(overrides: Partial<Search> = {}) {
  const search: Search = { prefs, onPrefsChange: vi.fn(), running: false, external: false, showTera: true, ...overrides };
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
    expect(screen.getByText('Depth')).toHaveAttribute('title', 'Auto picks the engine per turn. Singles: the depth-1 matrix with 3 samples until 50% of all Pokémon have fainted, then the MCTS tree. Doubles: the depth-1 matrix with 5 samples until 25% of all Pokémon have fainted, then the MCTS tree. The MCTS search runs 8 trees of 1200 iterations each.');
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

describe('Tera in the Setup menu', () => {
  const TERA_TITLE = 'Auto: in a new game on wherever the format allows Tera, in a replay off until someone terastallizes. '
    + 'Draft and custom formats keep the option only for the Pokémon that terastallized. Revealed: force that restriction for any format.';

  test('the row stands below Depth and Samples with its title, and a pick writes the preference', async () => {
    const { search } = await openMenu();
    const rows = [...document.querySelectorAll('.ps-setup-panel .ps-setup-row')].map(row => row.firstChild?.textContent?.trim());
    expect(rows).toEqual(['Depth', 'Samples', 'Tera']);
    expect(screen.getByText('Tera')).toHaveAttribute('title', TERA_TITLE);
    expect([...select('Tera').querySelectorAll('option')].map(option => [option.value, option.textContent])).toEqual([['auto', 'Auto'], ['on', 'On'], ['off', 'Off'], ['revealed', 'Revealed']]);
    expect(select('Tera')).toHaveValue('auto');
    await userEvent.selectOptions(select('Tera'), 'revealed');
    expect(search.onPrefsChange).toHaveBeenLastCalledWith({ ...prefs, tera: 'revealed' });
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a format without Tera draws no row', async () => {
    await openMenu({ showTera: false });
    expect(screen.queryByText('Tera')).toBeNull();
    expect(screen.getByText('Depth')).toBeInTheDocument();
  });

  test('while the format check is pending the row stays drawn, locked, and its title says why', async () => {
    await openMenu({ showTera: false, teraPending: true });
    expect(select('Tera')).toBeDisabled();
    expect(select('Tera')).toHaveValue('auto');
    expect(screen.getByText('Tera')).toHaveAttribute('title', 'Locked until the format check answers whether this format allows Tera.');
  });

  test('the answer unlocks the row and brings back the usual title', async () => {
    await openMenu({ showTera: true, teraPending: false });
    expect(select('Tera')).toBeEnabled();
    expect(screen.getByText('Tera')).toHaveAttribute('title', TERA_TITLE);
  });

  test('another engine still gets the row, since the request carries the Tera setting, and no Depth', async () => {
    await openMenu({ external: true });
    expect(select('Tera')).toBeEnabled();
    expect(screen.queryByText('Depth')).toBeNull();
  });

  test('the row locks while a search runs', async () => {
    await openMenu({ running: true });
    expect(select('Tera')).toBeDisabled();
  });
});

describe('the titles of the search rows', () => {
  const bot: EngineEntry = { id: 'url:http://localhost:8765/', name: 'My bot', url: 'http://localhost:8765/', source: 'added' };

  test('each row carries its title on its label and no select carries one, so the hover reads the same across the row', async () => {
    await openMenu({ engines: { engines: [BUILTIN_ENGINE, bot], selected: BUILTIN_ENGINE, select: vi.fn() } });
    const rows = [...document.querySelectorAll('.ps-setup-panel .ps-setup-row')];
    expect(rows.map(row => row.firstChild?.textContent?.trim())).toEqual(['Engine', 'Depth', 'Samples', 'Tera']);
    for (const row of rows) {
      expect(row).toHaveAttribute('title', expect.stringMatching(/\S/));
      expect(row.querySelector('select')).not.toHaveAttribute('title');
    }
  });
});

describe('the Engine select in the Setup menu', () => {
  const bot: EngineEntry = { id: 'url:http://localhost:8765/', name: 'My bot', url: 'http://localhost:8765/', source: 'added' };
  const choice = (selected: EngineEntry, engines: EngineEntry[] = [BUILTIN_ENGINE, bot]) => ({ engines, selected, select: vi.fn() });
  const engineSelect = () => screen.getByRole('combobox', { name: 'Engine' });
  const rowNames = () => [...document.querySelectorAll('.ps-setup-panel .ps-setup-row')].map(row => row.firstChild?.textContent?.trim());

  test('the built-in engine alone leaves no row, so the menu has no dead select', async () => {
    await openMenu({ engines: choice(BUILTIN_ENGINE, [BUILTIN_ENGINE]) });
    expect(screen.queryByRole('combobox', { name: 'Engine' })).toBeNull();
    expect(rowNames()).toEqual(['Depth', 'Samples', 'Tera']);
  });

  test('a second engine adds the row above Depth; a pick reaches the handler and keeps the menu open', async () => {
    const engines = choice(BUILTIN_ENGINE);
    await openMenu({ engines });
    expect(rowNames()).toEqual(['Engine', 'Depth', 'Samples', 'Tera']);
    expect(engineSelect()).toHaveValue('ps-dashboard');
    expect([...engineSelect().querySelectorAll('option')].map(option => option.textContent)).toEqual(['PS Dashboard', 'My bot']);
    await userEvent.selectOptions(engineSelect(), bot.id);
    expect(engines.select).toHaveBeenCalledWith(bot.id);
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('an added engine keeps the row, so the user can return, and the title names the engine in use', async () => {
    await openMenu({ external: true, engines: choice(bot) });
    expect(engineSelect()).toHaveValue(bot.id);
    expect(engineSelect().closest('label')).toHaveAttribute('title', expect.stringContaining('Estimate from My bot.'));
    expect(rowNames()).toEqual(['Engine', 'Tera']);
  });

  test('the built-in engine in the title says it plays the turns in the simulator', async () => {
    await openMenu({ engines: choice(BUILTIN_ENGINE) });
    expect(engineSelect().closest('label')).toHaveAttribute(
      'title',
      expect.stringContaining("Which engine evaluates: the dashboard's own search or another one (ENGINES.md). Built-in engine: it plays the turns in the simulator."),
    );
  });

  test('the row locks while a search runs', async () => {
    await openMenu({ running: true, engines: choice(BUILTIN_ENGINE) });
    expect(engineSelect()).toBeDisabled();
  });
});
