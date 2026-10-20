import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { SwitchBtn } from '../../../src/components/branch/ChoiceButtons';
import { FightSection, type FightSectionProps } from '../../../src/components/branch/FightSection';
import { useGimmickToggles } from '../../../src/hooks/useSideControlsState';
import { displayName } from '../../../src/lib/branch-history';
import { NO_MODIFIERS, simState, switchOption } from '../../fixtures/sim-state';

/** The nickname-and-species label of a body: one rule for the history, the switch buttons and the picker. */
describe('displayName', () => {
  test('a nicknamed body reads "Nickname (Species)", a body without a nickname reads its species alone', () => {
    expect(displayName('Power Police', 'Meowstic')).toBe('Power Police (Meowstic)');
    expect(displayName('Meowstic', 'Meowstic')).toBe('Meowstic');
    expect(displayName('', 'Meowstic')).toBe('Meowstic');
  });
});

describe('the switch button label', () => {
  test('singles: a nicknamed body shows "Nickname (Species)" in the full and the compact button', () => {
    const sw = switchOption('Meowstic', { name: 'Power Police' });
    const { rerender } = render(<SwitchBtn sw={sw} selected={false} disabled={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Power Police (Meowstic)');
    rerender(<SwitchBtn sw={sw} selected={false} disabled={false} compact onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Power Police (Meowstic)');
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Power Police (Meowstic) · 300/300');
  });

  test('singles: a body without a nickname shows its species alone', () => {
    render(<SwitchBtn sw={switchOption('Meowstic')} selected={false} disabled={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent(/^Meowstic/);
    expect(screen.getByRole('button')).not.toHaveTextContent('(');
  });

  test('doubles: the bench of the second slot shows both kinds of body, nicknamed and plain', () => {
    const bench = simState('doubles').p1SwitchesBySlot[1];
    const nicknamed = { ...bench[0], name: 'Power Police', species: 'Meowstic' };
    render(<>
      <SwitchBtn sw={nicknamed} selected={false} disabled={false} onClick={vi.fn()} />
      <SwitchBtn sw={bench[1]} selected={false} disabled={false} onClick={vi.fn()} />
    </>);
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveTextContent('Power Police (Meowstic)');
    expect(second).toHaveTextContent(bench[1].species);
    expect(second).not.toHaveTextContent('(');
  });
});

type HostProps = Partial<Omit<FightSectionProps, 'gimmick' | 'whatIf'>>;

function Host(props: HostProps) {
  const singles = simState('singles');
  const gimmick = useGimmickToggles([NO_MODIFIERS], []).gimmickFor('p1', 0);
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  return (
    <FightSection
      label="P1" activeSpecies="Garchomp" moves={singles.p1MovesBySlot[0]} switches={singles.p1SwitchesBySlot[0]}
      pending={null} blockedSwitchKeys={new Set()} dmgResults={[]} spreadDamageResults={{}} targetDamageResults={{}}
      advanced movePool={[]} onChoice={vi.fn()} onHypotheticalMove={vi.fn()}
      {...props}
      modifiers={NO_MODIFIERS} gimmick={gimmick} whatIf={{ whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace }}
    />
  );
}

describe('the switch option of the choice picker', () => {
  test('singles: a nicknamed body reads "Switch: Nickname (Species) (HP% HP)", a plain body its species', () => {
    const switches = [switchOption('Meowstic', { name: 'Power Police', slot: 2 }), switchOption('Heatran', { slot: 3 })];
    render(<Host switches={switches} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: 'Switch: Power Police (Meowstic) (100% HP)' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Switch: Heatran (100% HP)' })).toBeInTheDocument();
  });

  test('doubles: the same labels on the second active slot', () => {
    const doubles = simState('doubles');
    const bench = doubles.p1SwitchesBySlot[1];
    const switches = [{ ...bench[0], name: 'Power Police', species: 'Meowstic' }, bench[1]];
    render(<Host switches={switches} moves={doubles.p1MovesBySlot[1]} />);
    const picker = screen.getByRole('combobox', { name: 'Choice picker for P1' });
    expect(within(picker).getByRole('option', { name: 'Switch: Power Police (Meowstic) (100% HP)' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: `Switch: ${bench[1].species} (100% HP)` })).toBeInTheDocument();
  });
});
