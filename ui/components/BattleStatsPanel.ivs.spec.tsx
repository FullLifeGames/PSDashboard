import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BattleStatsPanel } from '../../src/components/BattleStatsPanel';
import { singlesReplay } from '../fixtures/replay';
import { revealedPokemon } from '../fixtures/team-info';

// Round 69 (T136). Singles and doubles replays share the panel, so both run each case.
describe.each(['singles', 'doubles'] as const)('IVs in the stats panel (%s)', kind => {
  const replayData = () => (kind === 'singles' ? singlesReplay() : { ...singlesReplay(), formatid: 'gen9doublesou' });

  test('a Trick Room body shows the IVs below 31 beside its EVs', () => {
    const ivs = { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 };
    const mon = revealedPokemon('Sinistcha', { ivs: { value: ivs, source: 'guessed', sourceDetail: 'Smogon sets gen9ou' } });
    render(<BattleStatsPanel replayData={replayData()} p1Info={{ pokemon: [mon] }} p2Info={null} />);
    const card = screen.getByRole('img', { name: 'Sinistcha' }).parentElement!;
    expect(card).toHaveTextContent('0 Atk / 0 Spe IVs');
  });

  test('a body with every IV at 31 shows no IV line', () => {
    const all31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    const mon = revealedPokemon('Garchomp', { ivs: { value: all31, source: 'guessed' } });
    render(<BattleStatsPanel replayData={replayData()} p1Info={{ pokemon: [mon] }} p2Info={null} />);
    expect(screen.getByRole('img', { name: 'Garchomp' }).parentElement!).not.toHaveTextContent('IVs');
  });
});
