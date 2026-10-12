import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PokemonRow } from '../../../src/components/team-editor/PokemonRow';
import { useTeamDraft } from '../../../src/hooks/useTeamDraft';
import type { EditorPools } from '../../../src/lib/team-editor';
import { evs, revealedPokemon } from '../../fixtures/team-info';

/**
 * Round 69 (T162): the EV inputs show the format's cap and a line says how much
 * of the total is spent. Champions counts Stat Points (32 per stat, 66 in
 * total) and has no Tera type; Scarlet/Violet counts EVs (252 per stat, 510).
 */
const pools = (evLimit?: number | null): EditorPools => ({
  items: [], teraTypes: ['Fire', 'Steel'], natures: ['Jolly'], movesBySpecies: {}, abilitiesBySpecies: {},
  ...(evLimit === undefined ? {} : { evLimit }),
});

function Row({ format, evLimit }: { format: string; evLimit?: number | null }) {
  const pool = pools(evLimit);
  const draft = useTeamDraft([revealedPokemon('Garchomp', { evs: evs('manual', { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 }) })], pool, format);
  return <PokemonRow entry={draft.pokemon[0]} index={0} gen={9} pools={pool} draft={draft} />;
}

const spin = (label: string) => screen.getByRole('spinbutton', { name: `Garchomp ${label} EVs` });

describe('EV inputs by format', () => {
  for (const [kind, format] of [['singles', 'gen9championsou'], ['doubles (VGC)', 'gen9championsvgc2026regmbbo3']] as const) {
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
