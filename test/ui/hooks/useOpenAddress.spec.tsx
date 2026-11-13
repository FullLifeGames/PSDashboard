import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOpenAddress } from '../../../src/hooks/useOpenAddress';
import { savedRecord } from '../fixtures/saved-game';

/**
 * Round 89 (lane H, #105), stage H4c (user ruling 13.11.2026, H12a): the address names what is open. A game is `?game=<id>`, a
 * replay loaded by link or id is `?replay=<id>`, a file has none. It is written with `replaceState` (the Back button leaves the app
 * as today), read once at start (a saved game opens at its tip, an unknown one is reported for the start page's notice), and left
 * alone in embed mode and behind a shared branch (`#branch=`). `?replay=` links keep loading byte for byte.
 */

type Inputs = Parameters<typeof useOpenAddress>[0];
const inputs = (overrides: Partial<Inputs> = {}): Inputs => ({
  embed: false, requestedGame: null, replayId: null, viewpoint: 'p1', byLink: false, openRecord: vi.fn().mockResolvedValue(undefined), ...overrides,
});
const at = (url: string) => window.history.replaceState(null, '', url);

beforeEach(() => {
  localStorage.clear();
  at('/');
});

describe('what the address says while something is open', () => {
  test('a game writes ?game=<id> and the history does not grow', async () => {
    const record = await savedRecord();
    const before = window.history.length;
    const { rerender } = renderHook((props: Inputs) => useOpenAddress(props), { initialProps: inputs() });
    expect(window.location.search).toBe('');
    rerender(inputs({ replayId: record.id }));
    expect(window.location.search).toBe(`?game=${record.id}`);
    expect(window.history.length).toBe(before);
  }, 60_000);

  test('a replay loaded by link or id writes ?replay=<id>, a p2 view carries its flag, a file writes none and removes the old one', () => {
    const { rerender } = renderHook((props: Inputs) => useOpenAddress(props), { initialProps: inputs() });
    rerender(inputs({ replayId: 'gen9ou-123', byLink: true }));
    expect(new URLSearchParams(window.location.search).get('replay')).toBe('gen9ou-123');
    rerender(inputs({ replayId: 'gen9ou-456', byLink: true, viewpoint: 'p2' }));
    expect(new URLSearchParams(window.location.search).get('replay')).toBe('gen9ou-456?p2');
    rerender(inputs({ replayId: 'imported-replay', byLink: false }));
    expect(window.location.search).toBe('');
  });

  test('a replay after a game takes ?game= away, a game after a replay takes ?replay= away; other parameters and the hash stay', async () => {
    const record = await savedRecord();
    at('/app/?keep=1#top');
    const { rerender } = renderHook((props: Inputs) => useOpenAddress(props), { initialProps: inputs({ replayId: record.id }) });
    expect(window.location.search).toBe(`?keep=1&game=${record.id}`);
    rerender(inputs({ replayId: 'gen9ou-7', byLink: true }));
    expect(window.location.search).toBe('?keep=1&replay=gen9ou-7');
    rerender(inputs({ replayId: record.id }));
    expect(window.location.search).toBe(`?keep=1&game=${record.id}`);
    expect(window.location.pathname + window.location.hash).toBe('/app/#top');
  }, 60_000);

  test('a ?replay= link that already names the loaded replay stays as it was written, in any of its forms', () => {
    for (const written of ['gen9ou-123', 'https%3A%2F%2Freplay.pokemonshowdown.com%2Fgen9ou-123', 'https://replay.pokemonshowdown.com/gen9ou-123?p1', 'GEN9OU-123']) {
      at(`/?replay=${written}`);
      renderHook(() => useOpenAddress(inputs({ replayId: 'gen9ou-123', byLink: true })));
      expect(window.location.search).toBe(`?replay=${written}`);
    }
  });

  test('nothing open leaves the address alone, an unloaded ?replay= link included', () => {
    at('/?replay=gen9ou-1&x=2');
    renderHook(() => useOpenAddress(inputs()));
    expect(window.location.search).toBe('?replay=gen9ou-1&x=2');
  });

  test('the embedded view and a shared branch own the address: nothing is written', async () => {
    const record = await savedRecord();
    renderHook(() => useOpenAddress(inputs({ embed: true, replayId: record.id })));
    expect(window.location.search).toBe('');
    at('/#branch=abc');
    renderHook(() => useOpenAddress(inputs({ replayId: record.id })));
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#branch=abc');
  }, 60_000);
});

describe('what the address opens at start', () => {
  test('a saved game opens once, without a click; nothing is reported missing', async () => {
    const record = await savedRecord(['Ann', 'Ben'], 4);
    const openRecord = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook((props: Inputs) => useOpenAddress(props), { initialProps: inputs({ requestedGame: record.id, openRecord }) });
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord.mock.calls[0][0]).toMatchObject({ id: record.id, turns: 4 });
    expect(result.current.missingGame).toBeNull();
    rerender(inputs({ requestedGame: record.id, openRecord }));
    expect(openRecord).toHaveBeenCalledTimes(1);
  }, 60_000);

  test('a game this browser does not hold is named for the start page, opens nothing and leaves the address', () => {
    at('/?game=newgame-k3x9q0m2ab');
    const openRecord = vi.fn();
    const { result } = renderHook(() => useOpenAddress(inputs({ requestedGame: 'newgame-k3x9q0m2ab', openRecord })));
    expect(result.current.missingGame).toBe('newgame-k3x9q0m2ab');
    expect(openRecord).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?game=newgame-k3x9q0m2ab');
  });

  test('embed and a shared branch open nothing behind them', async () => {
    const record = await savedRecord();
    const openRecord = vi.fn();
    const embedded = renderHook(() => useOpenAddress(inputs({ embed: true, requestedGame: record.id, openRecord })));
    expect(embedded.result.current.missingGame).toBeNull();
    at('/#branch=abc');
    const shared = renderHook(() => useOpenAddress(inputs({ requestedGame: record.id, openRecord })));
    expect(shared.result.current.missingGame).toBeNull();
    expect(openRecord).not.toHaveBeenCalled();
  }, 60_000);
});
