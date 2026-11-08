import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { switchOptionKey } from '@fulllifegames/eval-engine';
import { ChoicePicker, WhatIfRow } from '../../../../src/components/dock/WhatIfSection';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { displayName } from '../../../../src/lib/branch-history';
import { simState, switchOption } from '../../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A3b: the free-choice picker and the What-if loader of the old FightSection spec, now parts of the
 * tray's "Dice · What if" section, plus the labels of the old switch-labels spec.
 */
const pool = vi.hoisted(() => ({ list: ['Dragon Claw', 'Fire Fang'] as string[] }));
vi.mock('../../../../src/lib/pokemon-options', () => ({ getMovePool: async () => pool.list }));

const singles = simState('singles');
const doubles = simState('doubles');

type WhatIfProps = Partial<Parameters<typeof WhatIfRow>[0]>;

/** The What-if row over its own state, as the tray hosts it. */
function WhatIfHost(props: WhatIfProps) {
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  return (
    <WhatIfRow
      label="P1" moves={singles.p1MovesBySlot[0]} activeSpecies="Garchomp" movePool={[]} onHypotheticalMove={vi.fn()}
      {...props} whatIf={{ whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace }}
    />
  );
}

describe('ChoicePicker (All choices)', () => {
  test('sends moves with targets and switches, and blocks reserved switch-ins', async () => {
    const onPick = vi.fn();
    const switches = doubles.p1SwitchesBySlot[0];
    render(<ChoicePicker side="p1" label="P1" moves={doubles.p1MovesBySlot[0]} switches={switches} blockedSwitchKeys={new Set([switchOptionKey(switches[0])])} onPick={onPick} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: 'Flare Blitz → P2B Tornadus' })).toBeInTheDocument();
    await userEvent.selectOptions(picker, 'move:2:2');
    expect(onPick).toHaveBeenLastCalledWith('move:2:2');
    await userEvent.selectOptions(picker, 'switch:4');
    expect(onPick).toHaveBeenLastCalledWith('switch:4');
    expect(within(picker).getByRole('option', { name: 'Switch: Flutter Mane (100% HP)' })).toBeDisabled();
    expect(within(picker).getByRole('option', { name: 'Protect' })).toBeInTheDocument();
  });

  test('a trapped Pokemon has its picker options disabled', () => {
    const trapped = singles.p1SwitchesBySlot[0].map(sw => ({ ...sw, trapped: true }));
    render(<ChoicePicker side="p1" label="P1" moves={singles.p1MovesBySlot[0]} switches={trapped} blockedSwitchKeys={new Set()} onPick={vi.fn()} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    for (const option of picker.querySelectorAll('optgroup[label="Switch to"] option')) expect(option).toBeDisabled();
  });

  test('the choice a tray picks reaches the slot as a choice with its target and slot index', async () => {
    const onSetChoice = vi.fn();
    render(<TurnDock simState={doubles} executeError={null} executing={false} gen={9} onSetChoice={onSetChoice} onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^P1A\b/ }));
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Dice · What if/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Choice picker for P1A' }), 'move:2:2');
    expect(onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 }, 0);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Choice picker for P1A' }), 'switch:4');
    expect(onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'switch', speciesId: 'urshifu', pokemonName: 'Urshifu' }, 0);
  });
});

describe('WhatIfRow', () => {
  test('loads a pool move, replacing the last known move unless another is picked', async () => {
    const onHypotheticalMove = vi.fn();
    render(<WhatIfHost movePool={['Dragon Claw', 'Earthquake', 'Fire Fang']} onHypotheticalMove={onHypotheticalMove} />);
    const box = screen.getByRole('combobox', { name: 'Hypothetical move for P1' });
    expect(screen.getByRole('button', { name: 'Load move' })).toBeDisabled();
    await userEvent.click(box);
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['Dragon Claw', 'Fire Fang']);

    await userEvent.type(box, 'dragon claw');
    const replace = screen.getByRole('combobox', { name: 'Replaced move for P1' });
    expect(replace).toHaveValue('Scale Shot');
    expect(screen.getByRole('button', { name: 'Load move' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Load move' }));
    expect(onHypotheticalMove).toHaveBeenCalledWith({ species: 'Garchomp', move: 'Dragon Claw', replace: 'Scale Shot' });
    expect(box).toHaveValue('');

    await userEvent.type(box, 'Fire Fang');
    await userEvent.selectOptions(replace, 'Swords Dance');
    await userEvent.click(screen.getByRole('button', { name: 'Load move' }));
    expect(onHypotheticalMove).toHaveBeenLastCalledWith({ species: 'Garchomp', move: 'Fire Fang', replace: 'Swords Dance' });
  });

  test('with fewer than four moves nothing is replaced', async () => {
    const onHypotheticalMove = vi.fn();
    render(<WhatIfHost moves={singles.p1MovesBySlot[0].slice(0, 2)} movePool={['Dragon Claw']} onHypotheticalMove={onHypotheticalMove} />);
    expect(screen.queryByRole('combobox', { name: 'Replaced move for P1' })).toBeNull();
    await userEvent.type(screen.getByRole('combobox', { name: 'Hypothetical move for P1' }), 'Dragon Claw');
    await userEvent.click(screen.getByRole('button', { name: 'Load move' }));
    expect(onHypotheticalMove).toHaveBeenCalledWith({ species: 'Garchomp', move: 'Dragon Claw', replace: null });
  });
});

describe('the What-if section of the tray (singles)', () => {
  const dock = () => (
    <TurnDock simState={singles} executeError={null} executing={false} gen={9} onSetChoice={vi.fn()} onHypotheticalMove={vi.fn()} onExecuteTurn={vi.fn()} />
  );
  const openMore = async () => {
    await userEvent.click(screen.getByRole('button', { name: /^P1\b/ }));
    await userEvent.click(within(document.querySelector('.ps-tray') as HTMLElement).getByRole('button', { name: /Dice · What if/ }));
  };

  test('the row shows once the species\' move pool has loaded; all choices show at once', async () => {
    pool.list = ['Dragon Claw'];
    render(dock());
    await openMore();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Hypothetical move for P1' })).toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: 'Choice picker for P1' })).toBeInTheDocument();
  });

  test('the loader hands the hypothetical move to the handler with its side and slot', async () => {
    pool.list = ['Dragon Claw'];
    const onHypotheticalMove = vi.fn();
    render(<TurnDock simState={singles} executeError={null} executing={false} gen={9} onSetChoice={vi.fn()} onHypotheticalMove={onHypotheticalMove} onExecuteTurn={vi.fn()} />);
    await openMore();
    await userEvent.type(await screen.findByRole('combobox', { name: 'Hypothetical move for P1' }), 'Dragon Claw');
    await userEvent.click(screen.getByRole('button', { name: 'Load move' }));
    expect(onHypotheticalMove).toHaveBeenCalledWith('p1', 0, { species: 'Garchomp', move: 'Dragon Claw', replace: 'Scale Shot' });
  });

  test('without a pool the row is absent and all choices stay', async () => {
    pool.list = [];
    render(dock());
    await openMore();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByRole('combobox', { name: 'Hypothetical move for P1' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Choice picker for P1' })).toBeInTheDocument();
    pool.list = ['Dragon Claw', 'Fire Fang'];
  });
});

/** The nickname-and-species label of a body: one rule for the history, the switch tiles and the picker. */
describe('displayName in the picker', () => {
  test('a nicknamed body reads "Nickname (Species)", a body without a nickname reads its species alone', () => {
    expect(displayName('Power Police', 'Meowstic')).toBe('Power Police (Meowstic)');
    expect(displayName('Meowstic', 'Meowstic')).toBe('Meowstic');
    expect(displayName('', 'Meowstic')).toBe('Meowstic');
  });

  test('singles: a nicknamed body reads "Switch: Nickname (Species) (HP% HP)", a plain body its species', () => {
    const switches = [switchOption('Meowstic', { name: 'Power Police', slot: 2 }), switchOption('Heatran', { slot: 3 })];
    render(<ChoicePicker side="p1" label="P1" moves={singles.p1MovesBySlot[0]} switches={switches} blockedSwitchKeys={new Set()} onPick={vi.fn()} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: 'Switch: Power Police (Meowstic) (100% HP)' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Switch: Heatran (100% HP)' })).toBeInTheDocument();
  });

  test('doubles: the same labels on the second active slot', () => {
    const bench = doubles.p1SwitchesBySlot[1];
    const switches = [{ ...bench[0], name: 'Power Police', species: 'Meowstic' }, bench[1]];
    render(<ChoicePicker side="p1" label="P1B" moves={doubles.p1MovesBySlot[1]} switches={switches} blockedSwitchKeys={new Set()} onPick={vi.fn()} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1B' });
    expect(within(picker).getByRole('option', { name: 'Switch: Power Police (Meowstic) (100% HP)' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: `Switch: ${bench[1].species} (100% HP)` })).toBeInTheDocument();
  });
});
