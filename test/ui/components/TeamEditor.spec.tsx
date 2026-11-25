import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamEditor } from '../../../src/components/TeamEditor';
import { teamInfo, revealedPokemon } from '../fixtures/team-info';

describe('TeamEditor', () => {
  test('lists every Pokémon with its fields, loads the legal pools, and saves the edited team', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TeamEditor title="Edit Player" teamInfo={teamInfo('singles', 'p1')} gen={9} format="gen9ou" onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Edit Player' })).toBeInTheDocument();
    expect(screen.getByText('Garchomp', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/Moves \(2\/4\)/)).toHaveLength(6);

    const ability = await screen.findByRole('combobox', { name: 'Garchomp ability' }, { timeout: 30_000 });
    await waitFor(() => expect(ability.tagName).toBe('SELECT'), { timeout: 30_000 });
    expect(within(ability).getByRole('option', { name: 'Rough Skin' })).toBeInTheDocument();
    expect(within(ability).getByRole('option', { name: 'Intimidate' })).toBeInTheDocument();
    await userEvent.selectOptions(ability, 'Rough Skin');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0].pokemon;
    expect(saved[0].ability).toEqual({ value: 'Rough Skin', source: 'manual' });
    expect(saved).toHaveLength(6);
  }, 60_000);

  test('a Champions game reads the mod: its abilities and Stat Point caps, and no Tera field (singles and VGC)', async () => {
    for (const format of ['gen9championsou', 'gen9championsvgc2026regmcbo3']) {
      const { unmount } = render(<TeamEditor title="Edit Player" teamInfo={teamInfo('singles', 'p1')} gen={9} format={format} onSave={vi.fn()} onClose={vi.fn()} />);
      const ability = await screen.findByRole('combobox', { name: 'Garchomp ability' }, { timeout: 30_000 });
      await waitFor(() => expect(ability.tagName).toBe('SELECT'), { timeout: 30_000 });
      expect(within(ability).getByRole('option', { name: 'Rough Skin' })).toBeInTheDocument();
      expect(within(ability).getByRole('option', { name: 'Intimidate' })).toBeInTheDocument();
      expect(screen.queryByLabelText(/tera type/)).toBeNull();
      expect(screen.getAllByRole('spinbutton', { name: /Garchomp HP EVs/ })[0]).toHaveAttribute('max', '32');
      unmount();
    }
  }, 60_000);

  test('gen 3 hides the tera field; cancel closes without saving', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TeamEditor title="Edit Opp" teamInfo={teamInfo('singles', 'p2')} gen={3} format="gen3ou" onSave={onSave} onClose={onClose} />);
    expect(screen.queryByLabelText(/tera type/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  describe.each([
    { label: 'singles', kind: 'singles' as const, format: 'gen9ou', first: 'Ferrothorn' },
    { label: 'doubles', kind: 'doubles' as const, format: 'gen9doublesou', first: 'Rillaboom' },
  ])('keys in the move field ($label)', ({ kind, format, first }) => {
    const open = async (onClose = vi.fn()) => {
      render(<TeamEditor title="Edit Opp" teamInfo={teamInfo(kind, 'p2')} gen={9} format={format} onSave={vi.fn()} onClose={onClose} />);
      const nature = await screen.findByRole('combobox', { name: `${first} nature` }, { timeout: 30_000 });
      await waitFor(() => expect(nature.tagName).toBe('SELECT'), { timeout: 30_000 });
      return { nature, onClose };
    };

    test('Escape in an open move list closes the list, keeps the dialog and its edits; a second Escape closes the dialog', async () => {
      const { nature, onClose } = await open();
      await userEvent.selectOptions(nature, 'Bold');
      const add = screen.getAllByPlaceholderText('Add move...')[0];
      await userEvent.type(add, 'surf');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Edit Opp' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: `${first} nature` })).toHaveValue('Bold');

      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    }, 60_000);

    test('Enter in the empty Add move adds nothing', async () => {
      await open();
      const before = screen.getAllByText(/Moves \(2\/4\)/).length;
      await userEvent.click(screen.getAllByPlaceholderText('Add move...')[0]);
      await userEvent.keyboard('{Enter}');
      expect(screen.getAllByText(/Moves \(2\/4\)/)).toHaveLength(before);
      expect(screen.queryByRole('alert')).toBeNull();
    }, 60_000);

    test('a typed move the set already holds gets an alert and stays in the field', async () => {
      await open();
      const add = screen.getAllByPlaceholderText('Add move...')[0];
      await userEvent.type(add, 'Earthquake');
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('alert')).toHaveTextContent('"Earthquake" is already in the set.');
      expect(screen.getAllByText(/Moves \(2\/4\)/)).toHaveLength(teamInfo(kind, 'p2').pokemon.length);
      expect(add).toHaveValue('Earthquake');
    }, 60_000);
  });
});

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

    await userEvent.type(adders[0], 'Flying Press{Enter}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove Flying Press from Dracovish')).toBeInTheDocument();
    expect(screen.getAllByText('not learnable')).toHaveLength(1);
  }, 90_000);
});

describe('a standard format keeps refusing both moves (singles and doubles)', () => {
  test.each([['singles', 'gen9ou'], ['doubles', 'gen9doublesou']])('%s: %s', async (_kind, format) => {
    // Garchomp's ability select shows when the pools have loaded; Dracovish has no abilities in a standard format.
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
