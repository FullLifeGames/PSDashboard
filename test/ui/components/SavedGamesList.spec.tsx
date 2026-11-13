import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavedGamesList } from '../../../src/components/SavedGamesList';
import { GAMES_INDEX_KEY, gameKey, listGames } from '../../../src/lib/new-game/store';
import { savedRecord } from '../fixtures/saved-game';

/**
 * Round 89 (lane H, #105, stage H4b; user ruling 13.11.2026, H11a): the saved games are listed in the Game menu and on the start
 * page, the three newest rows and "Show all N saved games"; the New game dialog holds none. One component serves both places.
 */

type Props = Parameters<typeof SavedGamesList>[0];
const props = (overrides: Partial<Props> = {}): Props => ({ onOpen: vi.fn(), currentId: null, ...overrides });
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.ps-newgame-saved-row'));

beforeEach(() => localStorage.clear());

describe('the saved games list', () => {
  test('an empty store shows nothing at all, no heading', () => {
    const { container } = render(<SavedGamesList {...props()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('lists the newest first with format, names, turns, date and the seed; three rows, then "Show all N saved games" unfolds the rest', async () => {
    await savedRecord(['Ann', 'Ben'], 1, '1,1,1,1');
    await savedRecord(['Cleo', 'Dan'], 2, '2,2,2,2');
    await savedRecord(['Eve', 'Fay'], 3, '3,3,3,3');
    await savedRecord(['Gus', 'Hal'], 4, '4,4,4,4');
    await savedRecord(['Ivy', 'Jon'], 5, '5,5,5,5');
    render(<SavedGamesList {...props()} />);
    expect(screen.getByText('Saved games')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toHaveTextContent('Ivy');
    expect(rows()[0]).toHaveTextContent('[Gen 9] OU');
    expect(rows()[0]).toHaveTextContent('5 turns played');
    expect(rows()[0]).toHaveTextContent('Seed 5,5,5,5');
    expect(rows()[2]).toHaveTextContent('Eve');
    await userEvent.click(screen.getByRole('button', { name: 'Show all 5 saved games' }));
    expect(rows()).toHaveLength(5);
    expect(rows()[4]).toHaveTextContent('Ann');
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  }, 60_000);

  test('up to three games show no "Show all"', async () => {
    await savedRecord(['Ann', 'Ben'], 1);
    await savedRecord(['Cleo', 'Dan'], 2);
    await savedRecord(['Eve', 'Fay'], 3);
    render(<SavedGamesList {...props()} />);
    expect(rows()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  }, 60_000);

  test('Open hands the loaded record over; a failing open says so in the list', async () => {
    const record = await savedRecord(['Ann', 'Ben'], 14, '3,4,5,6');
    await savedRecord(['Cleo', 'Dan'], 1, '7,8,9,10');
    const onOpen = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<SavedGamesList {...props({ onOpen })} />);
    await userEvent.click(within(rows()[1]).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen.mock.calls[0][0].id).toBe(record.id);
    rerender(<SavedGamesList {...props({ onOpen: vi.fn().mockRejectedValue(new Error('boom')) })} />);
    await userEvent.click(within(rows()[1]).getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The game could not open: boom');
  }, 60_000);

  test('Delete asks once in the row; Keep leaves the game, Delete removes it and what it owns', async () => {
    const record = await savedRecord(['Ann', 'Ben'], 3, '3,4,5,6');
    localStorage.setItem(`ps-replay-interceptor:branches:${record.id}`, '[]');
    const { container } = render(<SavedGamesList {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved game' }));
    expect(screen.getByText('Delete this game?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(listGames()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(listGames()).toEqual([]);
    expect(localStorage.getItem(gameKey(record.id))).toBeNull();
    expect(localStorage.getItem(`ps-replay-interceptor:branches:${record.id}`)).toBeNull();
    expect(localStorage.getItem(GAMES_INDEX_KEY)).toBe('[]');
    expect(container).toBeEmptyDOMElement();
  }, 60_000);

  test('the game that is open now cannot be deleted from under itself, and an unreadable save says so', async () => {
    const record = await savedRecord(['Ann', 'Ben'], 3, '3,4,5,6');
    const { rerender } = render(<SavedGamesList {...props({ currentId: record.id })} />);
    expect(screen.queryByRole('button', { name: 'Delete saved game' })).toBeNull();
    expect(screen.getByText('open now')).toBeInTheDocument();
    localStorage.setItem(gameKey(record.id), '{broken');
    rerender(<SavedGamesList {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That saved game could not be read.');
  }, 60_000);
});
