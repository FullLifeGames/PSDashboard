import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { NewGameRecord } from '../../../src/lib/new-game/record';
import { MAX_SAVED_GAMES, gameKey, listGames, loadGame, onGameEvicted, saveGame, type SavedGameRow } from '../../../src/lib/new-game/store';

/**
 * Round 89 (lane H, #105), H15a (user ruling 13.11.2026): the 21st saved game first pushes out the games without a played turn, then
 * the oldest one, and says which game went. The store does not read the record's contents beyond the index row, so a stand-in record
 * with the row's fields is enough; a singles and a doubles format both play through the same store.
 */
const stand = (n: number, turns: number, format = '[Gen 9] OU'): NewGameRecord => ({
  recordVersion: 1, id: `newgame-${n}`, format: format === '[Gen 9] OU' ? 'gen9ou' : 'gen9doublesou', formatName: format,
  players: [`P${n}`, `Q${n}`], turns, seed: '1,2,3,4', updatedAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
} as unknown as NewGameRecord);

const ids = () => listGames().map(row => row.id);

beforeEach(() => localStorage.clear());

describe('the 20-game store (H15a)', () => {
  test('without a played turn goes first: the oldest game with no turn leaves, not the oldest game', () => {
    // game 1 is the oldest and has turns; game 2 has none
    for (let n = 1; n <= MAX_SAVED_GAMES; n += 1) expect(saveGame(stand(n, n === 2 ? 0 : 5))).toBe(true);
    const gone: SavedGameRow[][] = [];
    const off = onGameEvicted(rows => gone.push(rows));
    expect(saveGame(stand(21, 3))).toBe(true);
    off();
    expect(listGames()).toHaveLength(MAX_SAVED_GAMES);
    expect(ids()).toContain('newgame-1');
    expect(ids()).not.toContain('newgame-2');
    expect(localStorage.getItem(gameKey('newgame-2'))).toBeNull();
    expect(gone).toHaveLength(1);
    expect(gone[0].map(row => row.id)).toEqual(['newgame-2']);
  });

  test('with every game played, the oldest leaves (doubles format rows included) and the notice carries its names and turns', () => {
    for (let n = 1; n <= MAX_SAVED_GAMES; n += 1) saveGame(stand(n, n, n === 1 ? '[Gen 9] Doubles OU' : '[Gen 9] OU'));
    const listener = vi.fn();
    const off = onGameEvicted(listener);
    saveGame(stand(21, 1));
    off();
    expect(ids()).not.toContain('newgame-1');
    expect(loadGame('newgame-1')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0][0]).toMatchObject({ id: 'newgame-1', formatName: '[Gen 9] Doubles OU', players: ['P1', 'Q1'], turns: 1 });
  });

  test('the game just saved never leaves, even when it has no turn and is the only one without', () => {
    for (let n = 1; n <= MAX_SAVED_GAMES; n += 1) saveGame(stand(n, 4));
    saveGame(stand(21, 0));
    expect(ids()[0]).toBe('newgame-21');
    expect(ids()).not.toContain('newgame-1');
  });

  test('a save below the limit evicts nothing and a re-save of a listed game keeps the count', () => {
    const listener = vi.fn();
    const off = onGameEvicted(listener);
    for (let n = 1; n <= MAX_SAVED_GAMES; n += 1) saveGame(stand(n, 2));
    saveGame(stand(7, 3));
    off();
    expect(listener).not.toHaveBeenCalled();
    expect(listGames()).toHaveLength(MAX_SAVED_GAMES);
  });
});
