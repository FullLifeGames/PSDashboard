import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { MoveBtn } from '../../../src/components/branch/ChoiceButtons';
import { pickerStateFromSnapshot } from '../../../src/lib/picker-state';

/**
 * Round 67 (T85): the move button shows the type the move lands with. The
 * fast snapshot picker labels Ivy Cudgel of Ogerpon-Wellspring Water, and the
 * button colours and names it Water, before the exact position arrives.
 */
const mon = (name: string, active: boolean): TurnSnapshot['p1']['pokemon'][number] => ({
  name, speciesForme: name, hp: 100, maxhp: 100, hpPercent: 100, status: '', fainted: false, isActive: active,
  boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const set = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: '', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

describe('move button type at use (T85)', () => {
  test('the snapshot picker\'s Ivy Cudgel renders as a Water button', () => {
    const snapshot: TurnSnapshot = {
      turn: 4,
      p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: [mon('Ogerpon-Wellspring', true)] },
      p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: [mon('Heatran', true)] },
      field: { weather: '', terrain: '', pseudoWeather: {} },
      log: [],
    };
    const state = pickerStateFromSnapshot(snapshot, [set('Ogerpon-Wellspring', ['Ivy Cudgel'])], [set('Heatran', ['Magma Storm'])]);
    const [cudgel] = state.p1MovesBySlot[0];
    render(<MoveBtn move={cudgel} targetDamage={{}} pendingChoice={null} onClick={vi.fn()} />);
    expect(screen.getByText('Water')).toHaveClass('ps-movebtn-type');
    expect(screen.getByRole('button', { name: /Ivy Cudgel/ })).toHaveStyle({ background: '#6890F0' });
  });
});
