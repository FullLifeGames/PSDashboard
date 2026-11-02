import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { MoveTile, type MoveTileProps } from '../../../../src/components/dock/MoveTile';
import type { TileBar } from '../../../../src/lib/dock-tile';
import { fullMoveTitle, koShort, shownType } from '../../../../src/lib/move-damage-text';
import { pickerStateFromSnapshot } from '../../../../src/lib/picker-state';
import { moveOption } from '../../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A3b: the cases of the old MoveBtn spec that the tile keeps (name, PP, type, played and forced
 * flags, the Z-Move name, the KO verdict and its tooltip, disabled moves) and the type-at-use case of round 67 (T85). The compact
 * chips of Basic are gone. Which bars a tile shows is `dock-tile.spec.ts`; which move a click picks is `TurnDock.choices.spec.tsx`.
 */
const bar = (over: Partial<TileBar> = {}): TileBar => ({ label: '', hp: 100, min: 30, max: 35, range: '30-35%', ko: '', title: '30% - 35%', ...over });

function tile(over: Partial<MoveTileProps> = {}) {
  const onPick = vi.fn();
  const props: MoveTileProps = {
    move: moveOption('Earthquake', { type: 'Ground', pp: 14, maxpp: 16 }), type: 'Ground', bars: [bar()],
    selected: false, wasPlayed: false, forced: false, onPick, ...over,
  };
  return { onPick, ui: <MoveTile {...props} /> };
}

describe('MoveTile', () => {
  test('shows name, type tag and PP, flags the played move, and reports a click', async () => {
    const { ui, onPick } = tile({ wasPlayed: true });
    render(ui);
    const button = screen.getByRole('button', { name: /Earthquake/ });
    expect(button).toHaveTextContent('14/16');
    expect(within(button).getByText('Ground')).toHaveClass('ps-type-tag');
    expect(within(button).getByText('played')).toBeInTheDocument();
    await userEvent.click(button);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  test('a move that carries forced dice says "forced"; a move without them does not', () => {
    const { rerender } = render(tile({ forced: true }).ui);
    expect(screen.getByText('forced')).toHaveAttribute('title', 'This move carries forced dice. Open "Dice · What if" to see them.');
    rerender(tile({ forced: false }).ui);
    expect(screen.queryByText('forced')).toBeNull();
  });

  test('the pending move is pressed, and a Z-Move names what it turns into', () => {
    const { rerender } = render(tile().ui);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Earthquake/ })).not.toHaveClass('ps-movebtn-selected');
    rerender(tile({ selected: true, zMoveName: 'Tectonic Rage' }).ui);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveClass('ps-movebtn-selected');
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('→ Tectonic Rage')).toBeInTheDocument();
  });

  // Round 83 (the user, 01.11.2026: "we still have run-over text"): the calc's sentence wrapped onto a second line, so tiles in a
  // row stood at different heights. The tile shows the short verdict; the tooltip keeps the range and the whole sentence.
  test('a bar shows the short KO verdict in place of the range, and keeps the whole sentence in its tooltip', () => {
    const sentence = 'guaranteed 2HKO after Leftovers recovery';
    const damage = { moveName: 'Earth Power', minPercent: 66.8, maxPercent: 78.8, range: '66.8% - 78.8%', koChance: sentence };
    const { rerender } = render(tile({ bars: [bar({ min: 66.8, max: 78.8, range: '67-79%', ko: koShort(sentence), title: `66.8% - 78.8% (${sentence})` })] }).ui);
    const shown = document.querySelector('.ps-tile-bar-value') as HTMLElement;
    expect(shown).toHaveTextContent(/^2HKO$/);
    expect(shown).not.toHaveTextContent('Leftovers');
    expect(shown).toHaveClass('ps-tile-bar-ko');
    expect(document.querySelector('.ps-tile-bar')).toHaveAttribute('title', `66.8% - 78.8% (${sentence})`);
    expect(fullMoveTitle(damage)).toBe(`66.8% - 78.8% (${sentence})`);

    rerender(tile({ bars: [bar({ ko: koShort('62.5% chance to OHKO') })] }).ui);
    expect(document.querySelector('.ps-tile-bar-value')).toHaveTextContent('62.5% OHKO');
    rerender(tile({ bars: [bar()] }).ui);
    expect(document.querySelector('.ps-tile-bar-value')).toHaveTextContent('30-35%');
    expect(document.querySelector('.ps-tile-bar-value')).not.toHaveClass('ps-tile-bar-ko');
  });

  test('a spread move lists one bar per body, each with its label; a move without damage says so', () => {
    const { rerender } = render(tile({ bars: [bar({ label: 'P2A', min: 20, max: 24, range: '20-24%' }), bar({ label: 'P2B', min: 40, max: 47, range: '40-47%' })] }).ui);
    expect(screen.getByText('P2A')).toBeInTheDocument();
    expect(screen.getByText('20-24%')).toBeInTheDocument();
    expect(screen.getByText('P2B')).toBeInTheDocument();
    expect(screen.getByText('40-47%')).toBeInTheDocument();
    rerender(tile({ bars: [] }).ui);
    expect(screen.getByText('No damage')).toBeInTheDocument();
  });

  test('disabled moves and targeted moves without a target cannot be clicked', () => {
    const { rerender } = render(tile({ move: moveOption('Earthquake', { disabled: true }) }).ui);
    expect(screen.getByRole('button', { name: /Earthquake/ })).toBeDisabled();
    rerender(tile({ move: moveOption('Flare Blitz', { requiresTarget: true, targetOptions: [] }) }).ui);
    expect(screen.getByRole('button', { name: /Flare Blitz/ })).toBeDisabled();
  });
});

/**
 * Round 67 (T85): the tile shows the type the move lands with. The fast snapshot picker labels Ivy Cudgel of Ogerpon-Wellspring
 * Water, and the tile colors and names it Water, before the exact position arrives.
 */
const mon = (name: string, active: boolean): TurnSnapshot['p1']['pokemon'][number] => ({
  name, speciesForme: name, hp: 100, maxhp: 100, hpPercent: 100, status: '', fainted: false, isActive: active,
  boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: '', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

describe('move tile type at use (T85)', () => {
  test('the snapshot picker\'s Ivy Cudgel renders as a Water tile', () => {
    const snapshot: TurnSnapshot = {
      turn: 4,
      p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: [mon('Ogerpon-Wellspring', true)] },
      p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: [mon('Heatran', true)] },
      field: { weather: '', terrain: '', pseudoWeather: {} },
      log: [],
    };
    const state = pickerStateFromSnapshot(snapshot, [set('Ogerpon-Wellspring', ['Ivy Cudgel'])], [set('Heatran', ['Magma Storm'])]);
    const [cudgel] = state.p1MovesBySlot[0];
    render(tile({ move: cudgel, type: shownType(cudgel, false), bars: [] }).ui);
    expect(screen.getByText('Water')).toHaveClass('ps-type-tag');
    // the tinted tile carries its full type color as --type (typeTileVars)
    expect(screen.getByRole('button', { name: /Ivy Cudgel/ }).style.getPropertyValue('--type')).toBe('#6890F0');
  });
});
