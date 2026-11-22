import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KNOCKOUT_BOOST_ITEM_DETAIL, NO_BOOST_ITEM_DETAIL } from '@fulllifegames/replay-core';
import { BattleStatsPanel } from '../../../src/components/BattleStatsPanel';
import { singlesReplay } from '../fixtures/replay';
import { revealedPokemon } from '../fixtures/team-info';

// Round 89 (#75 step 2). A usage-listed boost item that a knockout needs shows its reason on hover, the way the dropped boost item does.
// Singles and doubles replays share the panel, so both run each case.
describe.each(['singles', 'doubles'] as const)('the reason of a boost item a knockout needs (%s)', kind => {
  const replayData = () => (kind === 'singles' ? singlesReplay() : { ...singlesReplay(), formatid: 'gen9doublesou' });

  test('the item tag carries the reason as its hover text and stays a guess', () => {
    const mon = revealedPokemon('Gengar', { item: { value: 'Choice Specs', source: 'guessed', sourceDetail: KNOCKOUT_BOOST_ITEM_DETAIL } });
    render(<BattleStatsPanel replayData={replayData()} p1Info={{ pokemon: [mon] }} p2Info={null} />);
    const tag = screen.getByTitle(KNOCKOUT_BOOST_ITEM_DETAIL);
    expect(tag).toHaveTextContent('Choice Specs');
    expect(tag).toHaveTextContent('guessed');
  });

  test('the reason reads in plain words and differs from the dropped boost item\'s', () => {
    expect(KNOCKOUT_BOOST_ITEM_DETAIL).toBe('only a boost item reaches the knockout');
    expect(KNOCKOUT_BOOST_ITEM_DETAIL).not.toBe(NO_BOOST_ITEM_DETAIL);
    expect(KNOCKOUT_BOOST_ITEM_DETAIL).not.toMatch(/[—–]/);
  });
});
