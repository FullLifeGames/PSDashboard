import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { switchOptionKey } from '@fulllifegames/eval-engine';
import { SwitchRow } from '../../../../src/components/dock/SwitchRow';
import { simState, switchOption } from '../../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A3b: the cases of the old SwitchBtn and switch-labels specs that the bench tile keeps: the sprite,
 * the label of a nicknamed body, the HP bar by health, the played flag, and the reasons a body is out. The compact chip is gone.
 */
type Props = Parameters<typeof SwitchRow>[0];

function row(overrides: Partial<Props> = {}) {
  const onPick = vi.fn();
  const props: Props = {
    side: 'p1', activeName: 'Garchomp', switches: [switchOption('Heatran', { hp: '210/300', hpPercent: 70 })], pending: null,
    blockedSwitchKeys: new Set(), played: null, onPick, ...overrides,
  };
  return { onPick, ui: <SwitchRow {...props} /> };
}

describe('SwitchRow', () => {
  test('a tile shows sprite, name and HP fraction, flags the played body, and reports the switch', async () => {
    const { ui, onPick } = row({ played: { kind: 'switch', name: 'Heatran', species: 'Heatran' } });
    render(ui);
    const tile = screen.getByRole('button', { name: /Heatran/ });
    expect(screen.getByRole('img', { name: 'Heatran' })).toHaveAttribute('src', expect.stringContaining('heatran'));
    expect(tile).toHaveTextContent('played');
    expect(tile).toHaveTextContent('210/300');
    await userEvent.click(tile);
    expect(onPick).toHaveBeenCalledWith({ kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' });
  });

  test('the HP bar is colored by health, and the picked body is pressed', () => {
    const { container, rerender } = render(row({ pending: { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' } }).ui);
    expect(screen.getByRole('button')).toHaveClass('ps-switchbtn-selected');
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.ps-hpbar-fill')).toHaveClass('ps-hpbar-green');
    expect(container.querySelector('.ps-hpbar-fill')).toHaveStyle({ width: '70%' });
    rerender(row({ switches: [switchOption('Heatran', { hp: '45/300', hpPercent: 15 })] }).ui);
    expect(container.querySelector('.ps-hpbar-fill')).toHaveClass('ps-hpbar-red');
    expect(container.querySelector('.ps-hpbar-fill')).toHaveStyle({ width: '15%' });
    rerender(row({ switches: [switchOption('Heatran', { hp: '300/300', hpPercent: 100 })] }).ui);
    expect(container.querySelector('.ps-hpbar-fill')).toHaveStyle({ width: '100%' });
    expect(screen.getByRole('button')).not.toHaveClass('ps-switchbtn-selected');
  });

  test('a body the other slot holds is out with the reason; the picked one stays clickable', () => {
    const reason = 'Heatran is already chosen as the switch-in for your other slot.';
    const [heatran, latias] = simState('singles').p1SwitchesBySlot[0];
    const pending = { kind: 'switch' as const, speciesId: 'latias', pokemonName: 'Latias' };
    render(row({ switches: [heatran, latias], blockedSwitchKeys: new Set([switchOptionKey(heatran), switchOptionKey(latias)]), pending }).ui);
    const out = screen.getByRole('button', { name: /Heatran/ });
    expect(out).toBeDisabled();
    expect(out).toHaveAttribute('aria-disabled', 'true');
    expect(out).toHaveAttribute('title', reason);
    expect(screen.getByRole('button', { name: /Latias/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Latias/ })).toHaveClass('ps-switchbtn-selected');
  });

  test('a trapped body and a fainted one are out', () => {
    const { rerender } = render(row({ switches: [{ ...switchOption('Heatran'), trapped: true }] }).ui);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Garchomp is trapped and cannot switch out this turn.');
    rerender(row({ switches: [switchOption('Heatran', { fainted: true, hp: '0 fnt', hpPercent: 0 })] }).ui);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('the switch tile label', () => {
  test('singles: a nicknamed body shows "Nickname (Species)"', () => {
    render(row({ switches: [switchOption('Meowstic', { name: 'Power Police' })] }).ui);
    expect(screen.getByRole('button')).toHaveTextContent('Power Police (Meowstic)');
  });

  test('singles: a body without a nickname shows its species alone', () => {
    render(row({ switches: [switchOption('Meowstic')] }).ui);
    expect(screen.getByRole('button')).toHaveTextContent(/^Meowstic/);
    expect(screen.getByRole('button')).not.toHaveTextContent('(');
  });

  test('doubles: the bench of the second slot shows both kinds of body, nicknamed and plain', () => {
    const bench = simState('doubles').p1SwitchesBySlot[1];
    const nicknamed = { ...bench[0], name: 'Power Police', species: 'Meowstic' };
    render(row({ switches: [nicknamed, bench[1]] }).ui);
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveTextContent('Power Police (Meowstic)');
    expect(second).toHaveTextContent(bench[1].species);
    expect(second).not.toHaveTextContent('(');
  });
});

describe('the badges of a tile (A7b)', () => {
  // The badge must not change the tile's box: it stands in the flag row on the tile's top edge, never in the name line.
  test('played and engine stand in the flag row, outside the name line', () => {
    const { container } = render(row({
      played: { kind: 'switch', name: 'Heatran', species: 'Heatran' },
      deferred: { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' },
    }).ui);
    const flags = container.querySelector('.ps-switchbtn > .ps-tile-flags');
    expect(flags).not.toBeNull();
    expect([...flags!.children].map(badge => badge.textContent)).toEqual(['played', 'engine']);
    expect(container.querySelector('.ps-switchbtn-name')).toHaveTextContent(/^Heatran$/);
    expect(container.querySelector('.ps-switchbtn-name .ps-played-badge, .ps-switchbtn-name .ps-engine-badge')).toBeNull();
  });

  test('a tile without a badge has no flag row, and the name line reads the same with or without', () => {
    const plain = render(row().ui).container;
    expect(plain.querySelector('.ps-tile-flags')).toBeNull();
    const flagged = render(row({ played: { kind: 'switch', name: 'Heatran', species: 'Heatran' } }).ui).container;
    expect(flagged.querySelector('.ps-switchbtn-name')?.textContent).toBe(plain.querySelector('.ps-switchbtn-name')?.textContent);
  });
});

