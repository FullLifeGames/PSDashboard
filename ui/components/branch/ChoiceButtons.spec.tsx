import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DamageResult } from '@fulllifegames/eval-engine';
import { MoveBtn, SwitchBtn } from '../../../src/components/branch/ChoiceButtons';
import { moveOption, switchOption, targetOption } from '../../fixtures/sim-state';

const damage = (moveName: string, min: number, max: number, koChance = ''): DamageResult =>
  ({ moveName, minPercent: min, maxPercent: max, range: `${min}% - ${max}%`, koChance });

describe('MoveBtn', () => {
  test('the compact chip shows name and PP, keeps type and damage in its tooltip, and marks the played move', async () => {
    const onClick = vi.fn();
    const move = moveOption('Earthquake', { type: 'Ground', pp: 14, maxpp: 16 });
    render(<MoveBtn move={move} dmg={damage('Earthquake', 30, 35, 'guaranteed 3HKO')} targetDamage={{}} pendingChoice={null} wasPlayed compact onClick={onClick} />);
    const chip = screen.getByRole('button', { name: /Earthquake/ });
    expect(chip).toHaveTextContent('14/16');
    expect(chip).toHaveAttribute('title', 'Ground · 14/16 PP · 30% - 35% (guaranteed 3HKO)');
    expect(chip).toHaveTextContent('played');
    expect(chip).not.toHaveTextContent('Ground');
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledWith(undefined);
  });

  test('the full button spells out type and damage, marks the pending move, and names its Z-Move', () => {
    const move = moveOption('Earthquake', { type: 'Ground' });
    const { rerender } = render(<MoveBtn move={move} dmg={damage('Earthquake', 30, 35, '25% chance to 3HKO')} targetDamage={{}} pendingChoice={null} onClick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Earthquake/ });
    expect(button).toHaveTextContent('Ground');
    expect(button).toHaveTextContent('30% - 35% (25% chance to 3HKO)');
    expect(button).not.toHaveAttribute('title');
    expect(button).not.toHaveClass('ps-movebtn-selected');

    rerender(<MoveBtn move={move} targetDamage={{}} pendingChoice={{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }} zMoveName="Tectonic Rage" onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveClass('ps-movebtn-selected');
    expect(screen.getByText('→ Tectonic Rage')).toBeInTheDocument();
  });

  test('spread damage lists one range per target', () => {
    const spread = [{ label: 'P2A', result: damage('Earthquake', 20, 24) }, { label: 'P2B', result: damage('Earthquake', 40, 47) }];
    render(<MoveBtn move={moveOption('Earthquake', { type: 'Ground' })} spreadDamage={spread} targetDamage={{}} pendingChoice={null} onClick={vi.fn()} />);
    expect(screen.getByText('P2A 20% - 24%')).toBeInTheDocument();
    expect(screen.getByText('P2B 40% - 47%')).toBeInTheDocument();
  });

  test('a targeted move renders its target buttons; the main button picks the first target', async () => {
    const onClick = vi.fn();
    const targets = [targetOption('p2', 0, 'Rillaboom', 1), targetOption('p2', 1, 'Tornadus', 2)];
    const move = moveOption('Flare Blitz', { type: 'Fire', requiresTarget: true, targetOptions: targets });
    const { rerender } = render(<MoveBtn move={move} targetDamage={{ 2: damage('Flare Blitz', 55, 65) }} pendingChoice={null} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: /^Flare Blitz/ }));
    expect(onClick).toHaveBeenLastCalledWith(1);
    const tornadus = screen.getByTitle('Flare Blitz into Tornadus (100%)');
    expect(tornadus).toHaveTextContent('P2B Tornadus');
    expect(tornadus).toHaveTextContent('100% HP · 55% - 65%');
    expect(tornadus).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(tornadus);
    expect(onClick).toHaveBeenLastCalledWith(2);

    rerender(<MoveBtn move={move} targetDamage={{}} pendingChoice={{ kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 }} onClick={onClick} />);
    expect(screen.getByTitle('Flare Blitz into Tornadus (100%)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Flare Blitz into Rillaboom (100%)')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Targeting P2B Tornadus')).toBeInTheDocument();
  });

  test('disabled moves and targeted moves without a target cannot be clicked', () => {
    const { rerender } = render(<MoveBtn move={moveOption('Earthquake', { disabled: true })} targetDamage={{}} pendingChoice={null} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toBeDisabled();
    rerender(<MoveBtn move={moveOption('Flare Blitz', { requiresTarget: true, targetOptions: [] })} targetDamage={{}} pendingChoice={null} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Flare Blitz/ })).toBeDisabled();
  });
});

describe('SwitchBtn', () => {
  test('the compact chip shows sprite, name, HP percent, and the played badge', async () => {
    const onClick = vi.fn();
    render(<SwitchBtn sw={switchOption('Heatran', { hp: '210/300', hpPercent: 70 })} selected={false} disabled={false} wasPlayed compact onClick={onClick} />);
    const chip = screen.getByRole('button', { name: /Heatran/ });
    expect(screen.getByRole('img', { name: 'Heatran' })).toHaveAttribute('src', expect.stringContaining('heatran'));
    expect(chip).toHaveTextContent('played');
    expect(chip).toHaveTextContent('70%');
    expect(chip).toHaveAttribute('title', 'Heatran · 210/300');
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('the full button draws an HP bar colored by health and shows the HP fraction', () => {
    const { container, rerender } = render(<SwitchBtn sw={switchOption('Heatran', { hp: '210/300', hpPercent: 70 })} selected disabled={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveClass('ps-switchbtn-selected');
    expect(screen.getByText('210/300')).toBeInTheDocument();
    expect(container.querySelector('.ps-hpbar-fill')).toHaveClass('ps-hpbar-green');
    expect(container.querySelector('.ps-hpbar-fill')).toHaveStyle({ width: '70%' });
    rerender(<SwitchBtn sw={switchOption('Heatran', { hp: '45/300', hpPercent: 15 })} selected={false} disabled={false} onClick={vi.fn()} />);
    expect(container.querySelector('.ps-hpbar-fill')).toHaveClass('ps-hpbar-red');
  });

  test('a reserved switch-in explains why it is out; a fainted one is out too', () => {
    const reason = 'Heatran is already chosen as the switch-in for your other slot.';
    const { rerender } = render(<SwitchBtn sw={switchOption('Heatran')} selected={false} disabled disabledReason={reason} onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('title', reason);
    rerender(<SwitchBtn sw={switchOption('Heatran', { fainted: true, hp: '0 fnt', hpPercent: 0 })} selected={false} disabled={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
