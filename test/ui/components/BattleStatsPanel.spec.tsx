import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { INFERRED_SPREAD_DETAIL, MEASURED_HP_SPREAD_DETAIL, ORDER_SPREAD_DETAIL } from '@fulllifegames/replay-core';
import { BattleStatsPanel } from '../../../src/components/BattleStatsPanel';
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

  test('a damage-fitted spread reads fitted, unknown EVs read in words, Tera and level show when set', () => {
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
    expect(latias).toHaveTextContent('EVs not yet known');
    expect(latias).toHaveTextContent('Has item');
  });

  test('a random format explains the fixed EVs and shows the unrevealed slots', () => {
    const replayData = { ...singlesReplay(), formatid: 'gen9randombattle' };
    const mon = revealedPokemon('Garchomp', { evs: evs('unknown'), moves: [move('Earthquake', 'revealed')] });
    render(<BattleStatsPanel replayData={replayData} p1Info={{ pokemon: [mon] }} p2Info={null} />);
    expect(screen.getByText(/85 EVs each \(random set\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Not yet revealed')).toHaveLength(5);
  });

  // Round 69 (T69). Singles and doubles replays share the panel, so both run each case.
  describe.each(['singles', 'doubles'] as const)('provenance of a solved spread (%s)', kind => {
    const replayData = () => (kind === 'singles' ? singlesReplay() : { ...singlesReplay(), formatid: 'gen9doublesou' });
    const spread = { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 };

    test('a spread the move order checked says so, one the HP of the log set says so', () => {
      const byOrder = revealedPokemon('Noivern', { evs: { ...evs('guessed', spread), sourceDetail: ORDER_SPREAD_DETAIL } });
      const byHp = revealedPokemon('Latias', { evs: { ...evs('guessed', spread), sourceDetail: MEASURED_HP_SPREAD_DETAIL } });
      render(<BattleStatsPanel replayData={replayData()} p1Info={{ pokemon: [byOrder, byHp] }} p2Info={null} />);
      const noivern = screen.getByRole('img', { name: 'Noivern' }).parentElement!;
      expect(noivern).toHaveTextContent('from move order');
      expect(noivern).not.toHaveTextContent('fitted');
      expect(screen.getByRole('img', { name: 'Latias' }).parentElement!).toHaveTextContent('HP from log');
    });
  });

  // Round 87 (release 1.1.0), T317: an unknown spread says "EVs not yet known" and drops the doubled source word, singles and doubles alike.
  describe.each(['singles', 'doubles'] as const)('an unknown spread (%s)', kind => {
    const replayData = () => (kind === 'singles' ? singlesReplay() : { ...singlesReplay(), formatid: 'gen9doublesou' });

    test('reads "EVs not yet known" with no source word, and the hover title still says unknown', () => {
      const mon = revealedPokemon('Latias', { evs: evs('unknown'), moves: [] });
      render(<BattleStatsPanel replayData={replayData()} p1Info={{ pokemon: [mon] }} p2Info={null} />);
      const tag = screen.getByText('EVs not yet known');
      expect(tag).toHaveClass('ps-stats-tag');
      expect(tag.textContent).toBe('EVs not yet known');
      expect(tag.querySelector('span')).toBeNull();
      expect(tag).toHaveAttribute('title', 'unknown');
      expect(screen.queryByText('EVs ?')).not.toBeInTheDocument();
    });

    test('a known spread keeps its source word', () => {
      const mon = revealedPokemon('Noivern', { evs: evs('guessed', { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 }), moves: [] });
      render(<BattleStatsPanel replayData={replayData()} p1Info={{ pokemon: [mon] }} p2Info={null} />);
      const tag = screen.getByText(/252 HP \/ 4 Def \/ 252 SpA EVs/);
      expect(tag.querySelector('span')).not.toBeNull();
    });
  });

  test('without any team knowledge the panel stays away', () => {
    const { container } = render(<BattleStatsPanel replayData={singlesReplay()} p1Info={null} p2Info={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Round 84 (A7b, ruling 9a): the panel is the closed panel at the right column's foot, and its list carries the fade mark.
  test('is the closed stats panel, and its list is the one that scrolls and fades', () => {
    const replayData = { ...singlesReplay(), players: ['Alice', 'Bob'] };
    const { container } = render(<BattleStatsPanel replayData={replayData} p1Info={teamInfo('singles', 'p1')} p2Info={null} />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel).toHaveClass('ps-panel', 'ps-stats-panel');
    expect(panel.querySelector(':scope > .ps-stats-grid')).not.toBeNull();
  });

  // Round 88 (F, #101): a game without team preview where a side showed fewer bodies than its |teamsize|. Singles and doubles both.
  describe.each([['singles', 'gen4ou', '[Gen 4] OU'], ['doubles', 'gen4doublesou', '[Gen 4] Doubles OU']] as const)('the bodies a side never showed (%s)', (_kind, formatid, tier) => {
    const NL = String.fromCharCode(10);
    const log = (teamsize: number, preview = false) => [
      `|tier|${tier}`, '|gen|4', `|teamsize|p1|${teamsize}`, `|teamsize|p2|${teamsize}`,
      ...(preview ? ['|poke|p1|Azelf|', '|poke|p2|Azelf|'] : []),
      '|start', '|turn|1',
    ].join(NL);
    const replay = (teamsize: number, preview = false) => ({ ...singlesReplay(), formatid, log: log(teamsize, preview), players: ['Alice', 'Bob'] });
    const shown = revealedPokemon('Azelf', { moves: [move('Nasty Plot', 'revealed')] });
    const guessed = revealedPokemon('Tyranitar', { standIn: true, moves: [], item: field('', 'unknown'), ability: field('', 'unknown'), evs: evs('unknown') });

    test('a stand-in carries the not revealed marker and says where it comes from; a shown body does not', () => {
      render(<BattleStatsPanel replayData={replay(2)} p1Info={{ pokemon: [shown, guessed] }} p2Info={null} />);
      const standIn = screen.getByRole('img', { name: 'Tyranitar' }).parentElement!;
      expect(standIn).toHaveTextContent('Not revealed (guessed from teammate usage)');
      expect(screen.getByRole('img', { name: 'Azelf' }).parentElement!).not.toHaveTextContent('Not revealed');
      expect(screen.queryByText(/never showed/)).toBeNull();
    });

    test('a side the format has no stand-ins for says how many bodies the engine does not count', () => {
      render(<BattleStatsPanel replayData={replay(6)} p1Info={{ pokemon: [shown] }} p2Info={{ pokemon: Array.from({ length: 6 }, (_, i) => revealedPokemon(`Mon${i}`)) }} />);
      expect(screen.getByText('P1 never showed 5 of 6 Pokémon. The engine counts only the shown ones.')).toBeInTheDocument();
      expect(screen.getAllByText(/never showed/)).toHaveLength(1);
    });

    test('a side that is not short, and a game with a team preview, get no notice', () => {
      const { unmount } = render(<BattleStatsPanel replayData={replay(1)} p1Info={{ pokemon: [shown] }} p2Info={{ pokemon: [shown] }} />);
      expect(screen.queryByText(/never showed/)).toBeNull();
      unmount();
      render(<BattleStatsPanel replayData={replay(6, true)} p1Info={{ pokemon: [shown] }} p2Info={null} />);
      expect(screen.queryByText(/never showed/)).toBeNull();
    });
  });
});
