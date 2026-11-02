import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { ModifierRow } from '../../../../src/components/dock/GimmickRow';
import { TurnDock } from '../../../../src/components/dock/TurnDock';
import { gimmickView } from '../../../../src/hooks/useSideControlsState';
import { pickerStateFromSnapshot } from '../../../../src/lib/picker-state';
import { NO_MODIFIERS, simState } from '../../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A3b: the gimmick cases of the old FightSection, SideControls and snapshot-tera-toggle specs. The row
 * shows what the slot's gimmick state holds and reports a click; the dock wires it to the slot's pending move (C4) or, with none,
 * arms the next pick.
 */
describe('ModifierRow', () => {
  test('shows the toggle armed and reports the click', async () => {
    const modifiers = { ...NO_MODIFIERS, teraType: 'Steel' };
    const toggle = vi.fn();
    render(<ModifierRow label="P1" modifiers={modifiers} gimmick={gimmickView(modifiers, 'terastallize', toggle)} />);
    const tera = screen.getByRole('button', { name: 'Tera (Steel)' });
    expect(tera).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(tera);
    expect(toggle).toHaveBeenCalledWith('terastallize');
  });

  test('a toggle a partner holds is disabled and names the partner', () => {
    const modifiers = { ...NO_MODIFIERS, teraType: 'Bug', canMegaEvo: true };
    render(<ModifierRow label="P1B" modifiers={modifiers} gimmick={gimmickView(modifiers, null, vi.fn(), { terastallize: 'P1A' })} />);
    expect(screen.getByRole('button', { name: 'Tera (Bug)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tera (Bug)' })).toHaveAttribute('title', 'P1A already terastallizes this turn.');
    expect(screen.getByRole('button', { name: 'Mega Evolve' })).toBeEnabled();
  });
});

type Props = Parameters<typeof TurnDock>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    simState: simState('singles'), executeError: null, executing: false, gen: 9,
    onSetChoice: vi.fn(), onHypotheticalMove: vi.fn(), onExecuteTurn: vi.fn(), ...overrides,
  };
}

const chip = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });
const tray = () => within(document.querySelector('.ps-tray') as HTMLElement);

describe('the gimmick toggle in the open tray', () => {
  test('a toggle without a pending move rides on the next tile; the Z toggle only on moves with a Z option', async () => {
    const onSetChoice = vi.fn();
    const modifiers = { ...NO_MODIFIERS, teraType: 'Steel', zMoves: [null, 'Continental Crush', null, null] };
    render(<TurnDock {...props({ onSetChoice, simState: simState('singles', { p1ModifiersBySlot: [modifiers] }) })} />);
    await userEvent.click(chip('P1'));
    const group = screen.getByRole('group', { name: 'Battle gimmicks for P1' });
    await userEvent.click(within(group).getByRole('button', { name: 'Tera (Steel)' }));
    expect(within(group).getByRole('button', { name: 'Tera (Steel)' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(tray().getByRole('button', { name: /Earthquake/ }));
    expect(onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' }, 0);

    await userEvent.click(within(group).getByRole('button', { name: 'Z-Move' }));
    expect(within(group).getByRole('button', { name: 'Tera (Steel)' })).toHaveAttribute('aria-pressed', 'false');
    expect(tray().getByText('→ Continental Crush')).toBeInTheDocument();
    await userEvent.click(tray().getByRole('button', { name: /Stone Edge/ }));
    expect(onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'move', moveId: 'stoneedge', moveName: 'Stone Edge', modifier: 'zmove' }, 0);
    await userEvent.click(tray().getByRole('button', { name: /Earthquake/ }));
    expect(onSetChoice).toHaveBeenLastCalledWith('p1', { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }, 0);
  });
});

/** Round 67 (T136 point 2): the fast snapshot picker carries the Tera type, so the toggle shows before the exact position arrives. */
const mon = (name: string, active: boolean): TurnSnapshot['p1']['pokemon'][number] => ({
  name, speciesForme: name, hp: 100, maxhp: 100, hpPercent: 100, status: '', fainted: false, isActive: active,
  boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const set = (species: string, moves: string[], teraType?: string): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: '', gender: '', teraType,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

const snapshot: TurnSnapshot = {
  turn: 3,
  p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: [mon('Garchomp', true), mon('Heatran', false)] },
  p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: [mon('Zapdos', true)] },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
};

describe('snapshot picker Tera toggle (T136 point 2)', () => {
  test('the fast picker shows the Tera toggle of the guessed set', async () => {
    const state = pickerStateFromSnapshot(snapshot, [set('Garchomp', ['Earthquake'], 'Fairy'), set('Heatran', ['Magma Storm'])], [set('Zapdos', ['Roost'])], 9, null, { format: 'gen9ou' });
    render(<TurnDock {...props({ simState: state, source: 'snapshot' })} />);
    await userEvent.click(chip('P1'));
    const group = screen.getByRole('group', { name: 'Battle gimmicks for P1' });
    expect(within(group).getByRole('button', { name: 'Tera (Fairy)' })).toBeInTheDocument();
  });
});
