import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { AbilityField, EvGrid, ItemField, MovesField, NatureField, TeraField } from '../../../../src/components/team-editor/fields';
import { useTeamDraft } from '../../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../../src/lib/team-editor';
import { revealedPokemon } from '../../fixtures/team-info';

const pools: EditorPools = {
  items: ['Choice Scarf', 'Leftovers', 'Loaded Dice'],
  teraTypes: ['Fire', 'Steel'],
  natures: ['Jolly', 'Timid'],
  movesBySpecies: { Garchomp: ['Earthquake', 'Fire Fang', 'Scale Shot', 'Stone Edge'] },
  abilitiesBySpecies: { Garchomp: ['Sand Veil', 'Rough Skin'] },
  allMoves: ['Earthquake', 'Fire Fang', 'Power Whip', 'Scale Shot', 'Spore', 'Stone Edge'],
  allAbilities: ['Intimidate', 'Rough Skin', 'Sand Veil'],
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

    await userEvent.type(adder, 'Moon Landing{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('"Moon Landing" is not a known move.');

    await userEvent.click(screen.getByRole('button', { name: 'Remove Earthquake from Garchomp' }));
    expect(draftOf().moves.map(move => move.name)).toEqual(['Protect', 'Scale Shot']);
  });

  // Round 83 (T308, GitHub issue #2): the pickers offer the species' own entries first, then the rest of the generation.
  test('the move dropdown lists the species own moves first, then the other moves of the generation with a note', async () => {
    render(<Fields initial={revealedPokemon('Garchomp')} withPools={pools} />);
    await userEvent.click(screen.getByPlaceholderText('Add move...'));
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent);
    // Protect and Earthquake stand in the set already.
    expect(names).toEqual(['Fire Fang', 'Scale Shot', 'Stone Edge', 'Power Whip not learnable', 'Spore not learnable']);
    expect(screen.getByRole('option', { name: 'Fire Fang' })).toBeInTheDocument();
  });

  test('a move the species cannot learn joins the set and its chip carries the note; a learnable one carries none', async () => {
    render(<Fields initial={revealedPokemon('Garchomp')} withPools={pools} />);
    const adder = screen.getByPlaceholderText('Add move...');
    await userEvent.type(adder, 'spore');
    await userEvent.click(screen.getByRole('option', { name: 'Spore not learnable' }));
    expect(draftOf().moves.map(move => move.name)).toEqual(['Protect', 'Earthquake', 'Spore']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText('not learnable')).toHaveLength(1);
    await userEvent.type(adder, 'scale');
    await userEvent.click(screen.getByRole('option', { name: 'Scale Shot' }));
    expect(screen.getAllByText('not learnable')).toHaveLength(1);
  });

  test('the ability select lists the species own abilities first, then the other abilities, and a chosen one carries a note', async () => {
    render(<Fields initial={revealedPokemon('Garchomp', { ability: { value: 'Sand Veil', source: 'guessed' } })} withPools={pools} />);
    const select = screen.getByRole('combobox', { name: 'Garchomp ability' });
    expect([...select.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Unknown', 'Sand Veil', 'Rough Skin', 'Intimidate']);
    expect(screen.queryByText(/not an ability of Garchomp/)).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'Intimidate');
    expect(draftOf().ability).toEqual({ value: 'Intimidate', source: 'manual' });
    expect(screen.getByText('Intimidate is not an ability of Garchomp.')).toBeInTheDocument();
    await userEvent.selectOptions(select, 'Rough Skin');
    expect(screen.queryByText(/not an ability of Garchomp/)).not.toBeInTheDocument();
  });
});
