import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { switchOptionKey } from '@fulllifegames/eval-engine';
import { FightSection, type FightSectionProps } from '../../../src/components/branch/FightSection';
import { useGimmick } from '../../../src/hooks/useSideControlsState';
import { NO_MODIFIERS, simState } from '../../fixtures/sim-state';

const singles = simState('singles');
const doubles = simState('doubles');

type HostProps = Partial<Omit<FightSectionProps, 'gimmick' | 'whatIf'>>;

/** The Fight face over the real gimmick toggle and what-if state, as SideControls hosts it. */
function Host(props: HostProps) {
  const modifiers = props.modifiers ?? NO_MODIFIERS;
  const gimmick = useGimmick(modifiers);
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  return (
    <FightSection
      label="P1" activeSpecies="Garchomp" moves={singles.p1MovesBySlot[0]} switches={singles.p1SwitchesBySlot[0]}
      pending={null} blockedSwitchKeys={new Set()} dmgResults={[]} spreadDamageResults={{}} targetDamageResults={{}}
      advanced={false} movePool={[]} onChoice={vi.fn()} onHypotheticalMove={vi.fn()}
      {...props}
      modifiers={modifiers} gimmick={gimmick} whatIf={{ whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace }}
    />
  );
}

describe('FightSection', () => {
  test('compact: the moves are chips, a click sends the move, and no power tools show', async () => {
    const onChoice = vi.fn();
    render(<Host onChoice={onChoice} />);
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Earthquake16/16', 'Stone Edge16/16', 'Swords Dance16/16', 'Scale Shot16/16']);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Earthquake/ }));
    expect(onChoice).toHaveBeenCalledWith({ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' });
  });

  test('a gimmick toggle rides on the next move; the Z toggle only on moves with a Z option', async () => {
    const onChoice = vi.fn();
    render(<Host onChoice={onChoice} modifiers={{ ...NO_MODIFIERS, teraType: 'Steel', zMoves: [null, 'Continental Crush', null, null] }} />);
    const group = screen.getByRole('group', { name: 'Battle gimmicks for P1' });
    await userEvent.click(within(group).getByRole('button', { name: 'Tera (Steel)' }));
    expect(within(group).getByRole('button', { name: 'Tera (Steel)' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Earthquake/ }));
    expect(onChoice).toHaveBeenLastCalledWith({ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' });

    await userEvent.click(within(group).getByRole('button', { name: 'Z-Move' }));
    expect(within(group).getByRole('button', { name: 'Tera (Steel)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('→ Continental Crush')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Stone Edge/ }));
    expect(onChoice).toHaveBeenLastCalledWith({ kind: 'move', moveId: 'stoneedge', moveName: 'Stone Edge', modifier: 'zmove' });
    await userEvent.click(screen.getByRole('button', { name: /Earthquake/ }));
    expect(onChoice).toHaveBeenLastCalledWith({ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' });
  });

  test('advanced: the free-choice dropdown sends moves with targets and switches, and blocks reserved switch-ins', async () => {
    const onChoice = vi.fn();
    const switches = doubles.p1SwitchesBySlot[0];
    render(<Host advanced onChoice={onChoice} moves={doubles.p1MovesBySlot[0]} switches={switches} blockedSwitchKeys={new Set([switchOptionKey(switches[0])])} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: 'Flare Blitz → P2B Tornadus' })).toBeInTheDocument();
    await userEvent.selectOptions(picker, 'move:2:2');
    expect(onChoice).toHaveBeenLastCalledWith({ kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 });
    await userEvent.selectOptions(picker, 'switch:4');
    expect(onChoice).toHaveBeenLastCalledWith({ kind: 'switch', speciesId: 'urshifu', pokemonName: 'Urshifu' });
    expect(within(picker).getByRole('option', { name: 'Switch: Flutter Mane (100% HP)' })).toBeDisabled();
    expect(within(picker).getByRole('option', { name: 'Protect' })).toBeInTheDocument();
  });

  test('the what-if row loads a pool move, replacing the last known move unless another is picked', async () => {
    const onHypotheticalMove = vi.fn();
    render(<Host advanced movePool={['Dragon Claw', 'Earthquake', 'Fire Fang']} onHypotheticalMove={onHypotheticalMove} />);
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

  test('with fewer than four moves nothing is replaced; without a pool the row is absent', async () => {
    const onHypotheticalMove = vi.fn();
    const { rerender } = render(<Host advanced moves={singles.p1MovesBySlot[0].slice(0, 2)} movePool={['Dragon Claw']} onHypotheticalMove={onHypotheticalMove} />);
    expect(screen.queryByRole('combobox', { name: 'Replaced move for P1' })).toBeNull();
    await userEvent.type(screen.getByRole('combobox', { name: 'Hypothetical move for P1' }), 'Dragon Claw');
    await userEvent.click(screen.getByRole('button', { name: 'Load move' }));
    expect(onHypotheticalMove).toHaveBeenCalledWith({ species: 'Garchomp', move: 'Dragon Claw', replace: null });

    rerender(<Host advanced movePool={[]} />);
    expect(screen.queryByRole('combobox', { name: 'Hypothetical move for P1' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Choice picker for P1' })).toBeInTheDocument();
  });
});
