import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PokemonRow } from '../../../src/components/team-editor/PokemonRow';
import { useTeamDraft } from '../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../src/lib/team-editor';
import { revealedPokemon } from '../../fixtures/team-info';

const pools: EditorPools = {
  items: ['Leftovers'], teraTypes: ['Fire'], natures: ['Jolly'],
  movesBySpecies: { Heatran: ['Magma Storm', 'Earth Power'] }, abilitiesBySpecies: { Heatran: ['Flash Fire'] },
};

function Row({ gen, withPools }: { gen: number; withPools: EditorPools | null }) {
  const draft = useTeamDraft([revealedPokemon('Heatran', { level: 50 })], withPools);
  return <PokemonRow entry={draft.pokemon[0]} index={0} gen={gen} pools={withPools} draft={draft} />;
}

describe('PokemonRow', () => {
  test('names the Pokémon with its level and shows every field a gen 9 set has', () => {
    render(<Row gen={9} withPools={pools} />);
    expect(screen.getByText('Heatran', { exact: false })).toHaveTextContent('Lv.50');
    expect(screen.getByRole('combobox', { name: 'Heatran ability' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Heatran item' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Heatran tera type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Heatran nature' })).toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(6);
    expect(screen.getByText('Moves (2/4)')).toBeInTheDocument();
  });

  test('older generations drop the fields they do not have', () => {
    render(<Row gen={2} withPools={pools} />);
    expect(screen.queryByLabelText('Heatran ability')).toBeNull();
    expect(screen.queryByLabelText('Heatran tera type')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Heatran item' })).toBeInTheDocument();
  });

  test('an unknown item raises the row\'s warning after leaving the field', async () => {
    render(<Row gen={9} withPools={pools} />);
    const item = screen.getByRole('combobox', { name: 'Heatran item' });
    await userEvent.clear(item);
    await userEvent.type(item, 'Mystery Orb');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('"Mystery Orb" is not a known item.');
  });
});
