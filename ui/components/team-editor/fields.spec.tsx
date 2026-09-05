import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { AbilityField, EvGrid, ItemField, MovesField, NatureField, TeraField } from '../../../src/components/team-editor/fields';
import { useTeamDraft } from '../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../src/lib/team-editor';
import { revealedPokemon } from '../../fixtures/team-info';

const pools: EditorPools = {
  items: ['Choice Scarf', 'Leftovers', 'Loaded Dice'],
  teraTypes: ['Fire', 'Steel'],
  natures: ['Jolly', 'Timid'],
  movesBySpecies: { Garchomp: ['Earthquake', 'Fire Fang', 'Scale Shot', 'Stone Edge'] },
  abilitiesBySpecies: { Garchomp: ['Sand Veil', 'Rough Skin'] },
};

/** All fields of one Pokémon over a live draft, as the editor's row composes them. */
function Fields({ initial, withPools }: { initial: RevealedPokemonInfo; withPools: EditorPools | null }) {
  const draft = useTeamDraft([initial], withPools);
  const entry = draft.pokemon[0];
  return (
    <div>
      <AbilityField entry={entry} index={0} pools={withPools} draft={draft} />
      <ItemField entry={entry} index={0} pools={withPools} draft={draft} />
      <TeraField entry={entry} index={0} pools={withPools} draft={draft} />
      <NatureField entry={entry} index={0} pools={withPools} draft={draft} />
      <EvGrid entry={entry} index={0} draft={draft} />
      <MovesField entry={entry} index={0} pools={withPools} draft={draft} />
      <output data-testid="draft">{JSON.stringify(entry)}</output>
    </div>
  );
}

const draftOf = () => JSON.parse(screen.getByTestId('draft').textContent!) as RevealedPokemonInfo;

describe('team editor fields', () => {
  test('with pools the ability, tera, and nature are selects; picking marks the field manual', async () => {
    render(<Fields initial={revealedPokemon('Garchomp')} withPools={pools} />);
    expect(screen.getByText('Ability (GUESSED 90%)')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Garchomp ability' }), 'Sand Veil');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Garchomp tera type' }), 'Steel');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Garchomp nature' }), 'Timid');
    const draft = draftOf();
    expect(draft.ability).toEqual({ value: 'Sand Veil', source: 'manual' });
    expect(draft.teraType).toEqual({ value: 'Steel', source: 'manual' });
    expect(draft.nature).toEqual({ value: 'Timid', source: 'manual' });
    expect(screen.getByText('Ability (MANUAL)')).toBeInTheDocument();
  });

  test('without pools the same fields are free text inputs', async () => {
    render(<Fields initial={revealedPokemon('Garchomp')} withPools={null} />);
    const ability = screen.getByRole('textbox', { name: 'Garchomp ability' });
    await userEvent.clear(ability);
    await userEvent.type(ability, 'Rough Skin');
    expect(draftOf().ability.value).toBe('Rough Skin');
  });

  test('the item combo box warns about an unknown item on blur and clears the warning on a pick', async () => {
    render(<Fields initial={revealedPokemon('Garchomp')} withPools={pools} />);
    const item = screen.getByRole('combobox', { name: 'Garchomp item' });
    await userEvent.clear(item);
    await userEvent.type(item, 'Mystery Orb');
    await userEvent.tab();
    expect(draftOf().item.value).toBe('Mystery Orb');
    // The warning lives on the row; the field only records it.
    await userEvent.click(item);
    await userEvent.clear(item);
    await userEvent.type(item, 'load');
    await userEvent.click(screen.getByRole('option', { name: 'Loaded Dice' }));
    expect(draftOf().item).toEqual({ value: 'Loaded Dice', source: 'manual' });
  });

  test('EV inputs clamp and moves can be added through the pool and removed', async () => {
    render(<Fields initial={revealedPokemon('Garchomp')} withPools={pools} />);
    const speed = screen.getByRole('spinbutton', { name: 'Garchomp Spe EVs' });
    await userEvent.clear(speed);
    await userEvent.type(speed, '300');
    expect(draftOf().evs.value.spe).toBe(252);

    expect(screen.getByText('Moves (2/4)')).toBeInTheDocument();
    const adder = screen.getByPlaceholderText('Add move...');
    await userEvent.type(adder, 'scale');
    await userEvent.click(screen.getByRole('option', { name: 'Scale Shot' }));
    expect(draftOf().moves.map(move => move.name)).toEqual(['Protect', 'Earthquake', 'Scale Shot']);
    expect(screen.getByText('Moves (3/4)')).toBeInTheDocument();

    await userEvent.type(adder, 'Spore{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent("Spore is not in Garchomp's legal moves for this generation.");

    await userEvent.click(screen.getByRole('button', { name: 'Remove Earthquake from Garchomp' }));
    expect(draftOf().moves.map(move => move.name)).toEqual(['Protect', 'Scale Shot']);
  });
});
