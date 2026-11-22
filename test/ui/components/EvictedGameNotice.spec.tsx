import { beforeEach, describe, expect, test } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvictedGameNotice } from '../../../src/components/EvictedGameNotice';
import { MAX_SAVED_GAMES, saveGame } from '../../../src/lib/new-game/store';
import type { NewGameRecord } from '../../../src/lib/new-game/record';

/**
 * Round 89 (lane H, #105), H15a: the notice that names the saved game a 21st save pushed out. Singles and doubles rows read the same:
 * the notice carries the format's name and the players as the row did.
 */
const stand = (n: number, turns: number, formatName: string): NewGameRecord => ({
  recordVersion: 1, id: `newgame-${n}`, format: 'x', formatName, players: [`P${n}`, `Q${n}`], turns, seed: '1,2,3,4',
  updatedAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
} as unknown as NewGameRecord);

beforeEach(() => localStorage.clear());

describe('the notice of a game the store pushed out', () => {
  test.each([['[Gen 9] OU'], ['[Gen 9] Doubles OU']])('names the game and the limit after the 21st save (%s)', async formatName => {
    render(<EvictedGameNotice />);
    expect(screen.queryByRole('status')).toBeNull();
    for (let n = 1; n <= MAX_SAVED_GAMES; n += 1) act(() => { saveGame(stand(n, n === 1 ? 0 : 3, formatName)); });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { saveGame(stand(21, 2, formatName)); });
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('The browser keeps 20 saved games.');
    expect(notice).toHaveTextContent(`P1 vs Q1 (${formatName}, no turn played)`);
    expect(notice).toHaveTextContent('was removed');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('a second push keeps both names until Dismiss', () => {
    render(<EvictedGameNotice />);
    for (let n = 1; n <= MAX_SAVED_GAMES + 2; n += 1) act(() => { saveGame(stand(n, 4, '[Gen 9] OU')); });
    expect(screen.getByRole('status')).toHaveTextContent('P1 vs Q1 ([Gen 9] OU, 4 turns played)');
    expect(screen.getByRole('status')).toHaveTextContent('P2 vs Q2');
  });
});
