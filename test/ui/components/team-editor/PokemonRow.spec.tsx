import { describe, expect, test, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PokemonRow } from '../../../../src/components/team-editor/PokemonRow';
import { useTeamDraft } from '../../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../../src/lib/team-editor';
import { revealedPokemon, evs } from '../../fixtures/team-info';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { getEvLimit } from '../../../../src/lib/pokemon-options';

const pools: EditorPools = {
  items: ['Leftovers'], teraTypes: ['Fire'], natures: ['Jolly'],
  movesBySpecies: { Heatran: ['Magma Storm', 'Earth Power'] }, abilitiesBySpecies: { Heatran: ['Flash Fire'] },
  allMoves: ['Earth Power', 'Magma Storm', 'Spore'], allAbilities: ['Flash Fire', 'Intimidate'],
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

describe('ev-limits', () => {
  const pools = (evLimit?: number | null): EditorPools => ({
    items: [], teraTypes: ['Fire', 'Steel'], natures: ['Jolly'], movesBySpecies: {}, abilitiesBySpecies: {}, allMoves: [], allAbilities: [],
    ...(evLimit === undefined ? {} : { evLimit }),
  });

  function Row({ format, evLimit }: { format: string; evLimit?: number | null }) {
    const pool = pools(evLimit);
    const draft = useTeamDraft([revealedPokemon('Garchomp', { evs: evs('manual', { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 }) })], pool, format);
    return <PokemonRow entry={draft.pokemon[0]} index={0} gen={9} pools={pool} draft={draft} />;
  }

  const spin = (label: string) => screen.getByRole('spinbutton', { name: `Garchomp ${label} EVs` });

  describe('EV inputs by format', () => {
    for (const [kind, format] of [['singles', 'gen9championsou'], ['doubles (VGC)', 'gen9championsvgc2026regmcbo3']] as const) {
      test(`Champions ${kind}: max 32, step 1, the Stat Points line, no Tera field`, () => {
        render(<Row format={format} />);
        expect(spin('HP')).toHaveAttribute('max', '32');
        expect(spin('HP')).toHaveAttribute('step', '1');
        expect(screen.getByText('Stat Points: 66 of 66 used, 32 per stat')).toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: 'Garchomp tera type' })).not.toBeInTheDocument();
      });

      test(`Champions ${kind}: typing past the cap lands on what the total leaves`, async () => {
        render(<Row format={format} />);
        await userEvent.clear(spin('Spe'));
        await userEvent.type(spin('Spe'), '40');
        expect(spin('Spe')).toHaveValue(0);
      });
    }

    for (const [kind, format] of [['singles', 'gen9ou'], ['doubles', 'gen9doublesou']] as const) {
      test(`Scarlet/Violet ${kind}: max 252, step 4, the EV line follows the simulator's total, Tera field stays`, () => {
        render(<Row format={format} evLimit={510} />);
        expect(spin('HP')).toHaveAttribute('max', '252');
        expect(spin('HP')).toHaveAttribute('step', '4');
        expect(screen.getByText('EVs: 66 of 510 used, 252 per stat')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Garchomp tera type' })).toBeInTheDocument();
      });

      test(`Scarlet/Violet ${kind}: no line before a total is known`, () => {
        render(<Row format={format} />);
        expect(screen.queryByText(/used, 252 per stat/)).not.toBeInTheDocument();
      });
    }
  });

  /**
   * A Champions format the mod does not list (an earlier regulation, another
   * tier) still gets the Champions caps and the budget line: the pools hand the
   * row the total they read for the id.
   */
  describe('EV inputs on a Champions format the mod does not list', () => {
    beforeAll(async () => {
      await loadSimMods('gen9championsou');
    });

    for (const [kind, format] of [['singles', 'gen9championsubers'], ['doubles (VGC)', 'gen9championsvgc2026regmabo3']] as const) {
      test(`${kind}: max 32, the Stat Points line, 32 in every stat stops at 66`, async () => {
        render(<Row format={format} evLimit={getEvLimit(format)} />);
        expect(spin('HP')).toHaveAttribute('max', '32');
        expect(screen.getByText('Stat Points: 66 of 66 used, 32 per stat')).toBeInTheDocument();
        await userEvent.clear(spin('Spe'));
        await userEvent.type(spin('Spe'), '40');
        expect(spin('Spe')).toHaveValue(0);
      });
    }
  });
});
