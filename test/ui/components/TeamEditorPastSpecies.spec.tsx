import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamEditor } from '../../../src/components/TeamEditor';
import { revealedPokemon } from '../fixtures/team-info';

/**
 * Round 89 (#150, claim 3): in a National Dex draft (a format id the simulator does not list) Dracovish and Zygarde are Past
 * species. The editor gave them the standard move pool (no Fishious Rend, no Thousand Arrows) and no abilities, and refused the
 * typed names. The battle plays both species and both moves; a standard format (gen9ou) keeps refusing them. Singles and doubles
 * read the same pools: a doubles draft id is the second row.
 */
const team = { pokemon: [revealedPokemon('Dracovish', { moves: [{ name: 'Protect', source: 'revealed' }] }), revealedPokemon('Zygarde', { moves: [] })] };

async function openEditor(format: string) {
  render(<TeamEditor title="Edit Opp" teamInfo={team} gen={9} format={format} onSave={vi.fn()} onClose={vi.fn()} />);
  const ability = await screen.findByRole('combobox', { name: 'Dracovish ability' }, { timeout: 30_000 });
  await waitFor(() => expect(ability.tagName).toBe('SELECT'), { timeout: 30_000 });
  return ability;
}

describe.each([
  ['a singles draft league', 'gen9natdexdraft'],
  ['a doubles draft league', 'gen9doublesdraftleague'],
])('%s (an id the simulator does not list)', (_kind, format) => {
  test('the ability list of Dracovish is its Dex entry\'s, and Fishious Rend joins from the dropdown without a note', async () => {
    const ability = await openEditor(format);
    for (const name of ['Strong Jaw', 'Sand Rush', 'Water Absorb']) expect(within(ability).getByRole('option', { name })).toBeInTheDocument();

    const adder = screen.getAllByPlaceholderText('Add move...')[0];
    await userEvent.type(adder, 'fishious');
    await userEvent.click(screen.getByRole('option', { name: 'Fishious Rend' }));
    expect(screen.getByText('Fishious Rend', { selector: 'span, div' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('not learnable')).not.toBeInTheDocument();
  }, 90_000);

  test('typing Thousand Arrows adds it to Zygarde; a move outside the pool of Dracovish joins with the note', async () => {
    await openEditor(format);
    const adders = screen.getAllByPlaceholderText('Add move...');
    await userEvent.type(adders[1], 'thousand arrows{Enter}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove Thousand Arrows from Zygarde')).toBeInTheDocument();
    expect(screen.queryByText('not learnable')).not.toBeInTheDocument();

    // A move of the battle that lies outside Dracovish's pool joins the set with the note.
    await userEvent.type(adders[0], 'Flying Press{Enter}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove Flying Press from Dracovish')).toBeInTheDocument();
    expect(screen.getAllByText('not learnable')).toHaveLength(1);
  }, 90_000);
});

describe('a standard format keeps refusing both moves (singles and doubles)', () => {
  test.each([['singles', 'gen9ou'], ['doubles', 'gen9doublesou']])('%s: %s', async (_kind, format) => {
    // Garchomp stands in the team to show when the pools have loaded (Dracovish has no abilities in a standard format).
    const withGarchomp = { pokemon: [...team.pokemon, revealedPokemon('Garchomp')] };
    render(<TeamEditor title="Edit Opp" teamInfo={withGarchomp} gen={9} format={format} onSave={vi.fn()} onClose={vi.fn()} />);
    const ability = await screen.findByRole('combobox', { name: 'Garchomp ability' }, { timeout: 30_000 });
    await waitFor(() => expect(ability.tagName).toBe('SELECT'), { timeout: 30_000 });
    expect(screen.queryByRole('combobox', { name: 'Dracovish ability' })?.tagName).not.toBe('SELECT');
    const adders = screen.getAllByPlaceholderText('Add move...');
    await userEvent.type(adders[0], 'Fishious Rend{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('"Fishious Rend" is not a known move.');
    await userEvent.type(adders[1], 'Thousand Arrows{Enter}');
    expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual(['"Fishious Rend" is not a known move.', '"Thousand Arrows" is not a known move.']);
  }, 90_000);
});
