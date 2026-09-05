import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamEditor } from '../../src/components/TeamEditor';
import { teamInfo } from '../fixtures/team-info';

describe('TeamEditor', () => {
  test('lists every Pokémon with its fields, loads the legal pools, and saves the edited team', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TeamEditor title="Edit Player" teamInfo={teamInfo('singles', 'p1')} gen={9} onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Edit Player' })).toBeInTheDocument();
    expect(screen.getByText('Garchomp', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/Moves \(2\/4\)/)).toHaveLength(6);

    // The pools arrive after the lazy load: the ability field becomes a select with the species' abilities.
    const ability = await screen.findByRole('combobox', { name: 'Garchomp ability' }, { timeout: 30_000 });
    await waitFor(() => expect(ability.tagName).toBe('SELECT'), { timeout: 30_000 });
    expect(screen.getByRole('option', { name: 'Rough Skin' })).toBeInTheDocument();
    await userEvent.selectOptions(ability, 'Rough Skin');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0].pokemon;
    expect(saved[0].ability).toEqual({ value: 'Rough Skin', source: 'manual' });
    expect(saved).toHaveLength(6);
  }, 60_000);

  test('gen 3 hides the tera field; cancel closes without saving', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<TeamEditor title="Edit Opp" teamInfo={teamInfo('singles', 'p2')} gen={3} onSave={onSave} onClose={onClose} />);
    expect(screen.queryByLabelText(/tera type/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
