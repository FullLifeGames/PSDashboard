import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '@fulllifegames/replay-core';
import { FightSection } from '../../../src/components/branch/FightSection';
import { useGimmickToggles } from '../../../src/hooks/useSideControlsState';
import { pickerStateFromSnapshot } from '../../../src/lib/picker-state';

/**
 * Round 67 (T136 point 2): the fast snapshot picker carries the Tera type,
 * so the Tera toggle shows before the exact position arrives, as the
 * stored picker will show it.
 */
const mon = (name: string, active: boolean): TurnSnapshot['p1']['pokemon'][number] => ({
  name, speciesForme: name, hp: 100, maxhp: 100, hpPercent: 100, status: '', fainted: false, isActive: active,
  boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 100, gender: '',
});

const set = (species: string, moves: string[], teraType?: string): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: '', gender: '', teraType,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

const snapshot: TurnSnapshot = {
  turn: 3,
  p1: { name: 'P1', id: 'p1', sideConditions: {}, pokemon: [mon('Garchomp', true), mon('Heatran', false)] },
  p2: { name: 'P2', id: 'p2', sideConditions: {}, pokemon: [mon('Zapdos', true)] },
  field: { weather: '', terrain: '', pseudoWeather: {} },
  log: [],
};

function SnapshotFight() {
  const state = pickerStateFromSnapshot(snapshot, [set('Garchomp', ['Earthquake'], 'Fairy'), set('Heatran', ['Magma Storm'])], [set('Zapdos', ['Roost'])], 9, null, { format: 'gen9ou' });
  const modifiers = state.p1ModifiersBySlot[0];
  const gimmick = useGimmickToggles([modifiers], []).gimmickFor('p1', 0);
  const [whatIfMove, setWhatIfMove] = useState('');
  const [whatIfReplace, setWhatIfReplace] = useState<string | null>(null);
  return (
    <FightSection
      label="P1" activeSpecies="Garchomp" moves={state.p1MovesBySlot[0]} switches={state.p1SwitchesBySlot[0]}
      pending={null} blockedSwitchKeys={new Set()} dmgResults={[]} spreadDamageResults={{}} targetDamageResults={{}}
      advanced={false} movePool={[]} onChoice={vi.fn()} onHypotheticalMove={vi.fn()}
      modifiers={modifiers} gimmick={gimmick} whatIf={{ whatIfMove, setWhatIfMove, whatIfReplace, setWhatIfReplace }}
    />
  );
}

describe('snapshot picker Tera toggle (T136 point 2)', () => {
  test('the fast picker shows the Tera toggle of the guessed set', () => {
    render(<SnapshotFight />);
    const group = screen.getByRole('group', { name: 'Battle gimmicks for P1' });
    expect(within(group).getByRole('button', { name: 'Tera (Fairy)' })).toBeInTheDocument();
  });
});
