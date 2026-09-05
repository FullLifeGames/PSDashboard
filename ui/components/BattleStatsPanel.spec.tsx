import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { INFERRED_SPREAD_DETAIL } from '@fulllifegames/replay-core';
import { BattleStatsPanel } from '../../src/components/BattleStatsPanel';
import { singlesReplay } from '../fixtures/replay';
import { evs, field, move, revealedPokemon, teamInfo } from '../fixtures/team-info';

describe('BattleStatsPanel', () => {
  test('renders one card per Pokémon and side with the provenance of every field', () => {
    const replayData = { ...singlesReplay(), players: ['Alice', 'Bob'] };
    render(<BattleStatsPanel replayData={replayData} p1Info={teamInfo('singles', 'p1')} p2Info={teamInfo('singles', 'p2')} />);
    expect(screen.getByText('Battle Statistics')).toBeInTheDocument();
    expect(screen.getByText('Alice', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(12);
    expect(screen.getByRole('img', { name: 'Garchomp' })).toHaveAttribute('src', expect.stringContaining('garchomp'));

    const garchomp = screen.getByRole('img', { name: 'Garchomp' }).parentElement!;
    expect(garchomp).toHaveTextContent('Protect');
    expect(garchomp).toHaveTextContent('revealed');
    expect(garchomp).toHaveTextContent('Earthquake');
    expect(garchomp).toHaveTextContent('guessed 72%');
    expect(garchomp).toHaveTextContent('Leftovers');
    expect(garchomp).toHaveTextContent('manual');
    expect(garchomp).toHaveTextContent('252 HP / 4 Def / 252 SpD EVs');
  });

  test('a damage-fitted spread reads fitted, unknown EVs read as a question, Tera and level show when set', () => {
    const replayData = singlesReplay();
    const fitted = revealedPokemon('Heatran', {
      evs: { ...evs('guessed', { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }), sourceDetail: INFERRED_SPREAD_DETAIL },
      teraType: field('Grass', 'revealed'), level: 50, gender: 'F',
    });
    const unknown = revealedPokemon('Latias', { evs: evs('unknown'), moves: [], item: { value: '(has item)', source: 'revealed' } });
    render(<BattleStatsPanel replayData={replayData} p1Info={{ pokemon: [fitted, unknown] }} p2Info={null} />);

    const heatran = screen.getByRole('img', { name: 'Heatran' }).parentElement!;
    expect(heatran).toHaveTextContent('fitted');
    expect(heatran).toHaveTextContent('Tera Grass');
    expect(heatran).toHaveTextContent('L50');
    expect(heatran).toHaveTextContent('♀');

    const latias = screen.getByRole('img', { name: 'Latias' }).parentElement!;
    expect(latias).toHaveTextContent('EVs ?');
    expect(latias).toHaveTextContent('Has item');
  });

  test('a random format explains the fixed EVs and shows the unrevealed slots', () => {
    const replayData = { ...singlesReplay(), formatid: 'gen9randombattle' };
    const mon = revealedPokemon('Garchomp', { evs: evs('unknown'), moves: [move('Earthquake', 'revealed')] });
    render(<BattleStatsPanel replayData={replayData} p1Info={{ pokemon: [mon] }} p2Info={null} />);
    expect(screen.getByText(/85 EVs each \(random set\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Not yet revealed')).toHaveLength(5);
  });

  test('without any team knowledge the panel stays away', () => {
    const { container } = render(<BattleStatsPanel replayData={singlesReplay()} p1Info={null} p2Info={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
