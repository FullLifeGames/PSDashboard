import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { NewGameRecord } from '../../../src/lib/new-game/record';
import type { GameSharePayload } from '../../../src/lib/new-game/share';
import { useOpenSharedGame, type SharedGameApp } from '../../../src/hooks/useOpenSharedGame';
import { loadGame } from '../../../src/lib/new-game/store';
import { savedRecord } from '../fixtures/saved-game';

/**
 * Round 89 (lane H, #105), stage H5 (ruling 31, H6a): a game's share link opens the main line and the open branch at the sharer's
 * turn. The reader (`recordOfShare`, spec `game-share.spec.ts`) is stubbed here: the rows hold the hook's own steps. It saves the
 * game as a copy, clears the hash, opens the record, waits for the game's data on screen, restores the branch and moves the pointer;
 * a link of the game that is open (same id, same main line) opens its branch in that game and makes no copy.
 */

const opened = vi.hoisted(() => ({ result: null as unknown }));
vi.mock('../../../src/hooks/branch/share-open', () => ({ recordOfShare: vi.fn(async () => opened.result) }));
vi.mock('../../../src/lib/lazy/branch-engine', () => ({}));

const payload = (over: Partial<GameSharePayload> = {}): GameSharePayload => ({
  version: 2, kind: 'game', gameId: 'newgame-sharer0001', format: 'gen9ou', formatName: '[Gen 9] OU', players: ['Alice', 'Bob'],
  teams: { p1: 'Garchomp||||earthquake||||||', p2: 'Gengar||||shadowball||||||' }, seed: '1,2,3,4',
  entries: [['L', ['Garchomp'], ['Gengar']], [['Earthquake'], ['Shadow Ball']]],
  variation: { startTurn: 1, entries: [[['Earthquake'], ['Protect']]] }, view: { turn: 2, line: 'variation' },
  branchTurn: 1, createdAt: '2026-11-13T10:00:00.000Z', ...over,
});

interface Stub { app: SharedGameApp; calls: string[]; setData: (id: string | null) => void }
function stubApp(link: GameSharePayload | null, record: NewGameRecord | null = null): Stub {
  const calls: string[] = [];
  let data: { id: string } | null = null;
  const app: SharedGameApp = {
    ctx: {
      shared: { sharedGame: link, clearSharedBranch: vi.fn(() => calls.push('clear')) },
      newGame: { record, openRecord: vi.fn(async (next: NewGameRecord) => { calls.push(`open ${next.id}`); data = { id: next.id }; }) },
      replay: { get replayData() { return data ?? (record ? { id: record.id } : null); } },
    },
    board: {
      deviation: { branchPreparing: false, restoreVariation: vi.fn(async saved => { calls.push(`restore ${saved.startTurn}:${saved.history.length}`); }) },
      timeline: {
        navigateTo: vi.fn(position => { calls.push(`navigate ${position.turn} ${position.line}`); }),
        handleGraphSelectLine: vi.fn(turn => { calls.push(`select ${turn}`); }),
      },
    },
  };
  return { app, calls, setData: id => { data = id ? { id } : null; } };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('a game link opens in the app', () => {
  test('a link of another game: a copy is saved, the hash goes, the game opens, then the branch and the sharer\'s turn follow', async () => {
    const copy = await savedRecord(['Alice', 'Bob'], 1);
    localStorage.clear();
    opened.result = copy;
    const { app, calls } = stubApp(payload());
    const { result } = renderHook(() => useOpenSharedGame(app));
    await waitFor(() => expect(calls).toEqual([`clear`, `open ${copy.id}`, 'restore 1:1', 'navigate 2 variation']));
    expect(loadGame(copy.id)).toEqual(copy);
    expect(result.current).toEqual({ opening: false, error: null });
    const saved = vi.mocked(app.board.deviation.restoreVariation).mock.calls[0][0];
    expect(saved.history[0]).toMatchObject({ kind: 'turn', p1SlotChoices: [{ kind: 'move', moveName: 'Earthquake' }], p2SlotChoices: [{ kind: 'move', moveName: 'Protect' }] });
    expect(saved.prefill).toEqual({ p1Choices: [], p2Choices: [] });
  }, 60_000);

  test('no branch and the team preview as the view: the game opens and the pointer goes to turn 0', async () => {
    const copy = await savedRecord(['Cara', 'Dev'], 0);
    opened.result = copy;
    const { app, calls } = stubApp(payload({ variation: undefined, view: { turn: 0, line: 'main', t0: true } }));
    renderHook(() => useOpenSharedGame(app));
    await waitFor(() => expect(calls).toEqual(['clear', `open ${copy.id}`, 'select 0']));
  }, 60_000);

  test('no view: the game opens at its tip and nothing moves the pointer', async () => {
    const copy = await savedRecord(['Eve', 'Finn'], 2);
    opened.result = copy;
    const { app, calls } = stubApp(payload({ variation: undefined, view: undefined }));
    renderHook(() => useOpenSharedGame(app));
    await waitFor(() => expect(calls).toEqual(['clear', `open ${copy.id}`]));
  }, 60_000);

  test('the link of the game that is open, its main line the open game\'s start: no copy, the branch opens in the open game', async () => {
    const record = await savedRecord(['Gus', 'Hal'], 1);
    localStorage.clear();
    const entries = [['L', ['Garchomp'], ['Gengar']]] as GameSharePayload['entries'];
    const open: NewGameRecord = { ...record, entries: [{ turnNumber: 0, p1Choice: '', p2Choice: '', p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], leadChoices: { p1: ['Garchomp'], p2: ['Gengar'] } }] };
    const { app, calls } = stubApp(payload({ gameId: record.id, entries }), open);
    renderHook(() => useOpenSharedGame(app));
    await waitFor(() => expect(calls).toEqual(['clear', 'restore 1:1', 'navigate 2 variation']));
    expect(localStorage.getItem('ps-replay-interceptor:games')).toBeNull();
  }, 60_000);

  test('the same game id with a main line the open game does not hold: a copy', async () => {
    const record = await savedRecord(['Ida', 'Jon'], 1);
    const copy = { ...record, id: 'newgame-copyofgame' };
    opened.result = copy;
    const { app, calls } = stubApp(payload({ gameId: record.id }), { ...record, entries: [] });
    renderHook(() => useOpenSharedGame(app));
    await waitFor(() => expect(calls[1]).toBe('open newgame-copyofgame'));
  }, 60_000);

  test('a link the reader cannot start names the problem, clears the hash and opens nothing', async () => {
    opened.result = { error: 'This game link cannot start: no such format.' };
    const { app, calls } = stubApp(payload());
    const { result } = renderHook(() => useOpenSharedGame(app));
    await waitFor(() => expect(result.current.error).toBe('This game link cannot start: no such format.'));
    expect(calls).toEqual(['clear']);
    expect(result.current.opening).toBe(false);
  });

  test('without a game link the hook does nothing', () => {
    const { app, calls } = stubApp(null);
    const { result } = renderHook(() => useOpenSharedGame(app));
    expect(calls).toEqual([]);
    expect(result.current).toEqual({ opening: false, error: null });
  });
});
