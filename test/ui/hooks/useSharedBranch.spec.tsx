import { afterEach, describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSharedBranch } from '../../../src/hooks/useSharedBranch';
import { encodeBranchShare, encodeShareJson, type BranchSharePayload } from '../../../src/lib/branch-share';
import type { GameSharePayload } from '../../../src/lib/new-game/share';

const payload: BranchSharePayload = {
  version: 1, replayId: 'gen9ou-1', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['Alice', 'Bob'],
  branchTurn: 3, createdAt: '2026-09-05T20:00:00.000Z', choices: [], finalLog: '|turn|3\n|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn',
};

const game: GameSharePayload = {
  version: 2, kind: 'game', gameId: 'newgame-abc', format: 'gen9ou', formatName: '[Gen 9] OU', players: ['Alice', 'Bob'],
  teams: { p1: 'Garchomp||||earthquake||||||', p2: 'Gengar||||shadowball||||||' }, seed: '1,2,3,4', entries: [], branchTurn: 1, createdAt: '2026-11-13T10:00:00.000Z',
};

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useSharedBranch', () => {
  test('decodes a #branch= link on load and keeps the hash', () => {
    window.location.hash = `#branch=${encodeBranchShare(payload)}`;
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedBranch).toEqual(payload);
    expect(result.current.sharedBranchError).toBeNull();
    expect(window.location.hash.startsWith('#branch=')).toBe(true);
  });

  test('a damaged link reads as a message and leaves the URL', () => {
    window.location.hash = '#branch=not-a-payload';
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedBranch).toBeNull();
    expect(result.current.sharedBranchError).toBe('This share link is invalid or damaged. Ask for a fresh link.');
    expect(window.location.hash).toBe('');
  });

  test('a payload of another version or without its log is rejected like a damaged link', () => {
    window.location.hash = `#branch=${encodeBranchShare({ ...payload, finalLog: '' })}`;
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedBranch).toBeNull();
    expect(result.current.sharedBranchError).toMatch(/invalid or damaged/);
  });

  test('a share link pasted into an open tab applies on hashchange, and clearing strips it', () => {
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedBranch).toBeNull();

    act(() => {
      window.location.hash = `#branch=${encodeBranchShare(payload)}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.sharedBranch?.replayId).toBe('gen9ou-1');

    act(() => result.current.clearSharedBranch());
    expect(result.current.sharedBranch).toBeNull();
    expect(result.current.sharedBranchError).toBeNull();
    expect(window.location.hash).toBe('');
  });

  // Round 89 (#105, H5): a game's link (version 2) is no read-only view; the app opens the game and clears the hash then.
  test('a version 2 link reads as a game and leaves the replay branch empty; the hash stays until the game opens', () => {
    window.location.hash = `#branch=${encodeBranchShare(game)}`;
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedGame).toEqual(game);
    expect(result.current.sharedBranch).toBeNull();
    expect(result.current.sharedBranchError).toBeNull();
    expect(window.location.hash.startsWith('#branch=')).toBe(true);
    act(() => result.current.clearSharedBranch());
    expect(result.current.sharedGame).toBeNull();
    expect(window.location.hash).toBe('');
  });

  test('a link of a version this app does not know says so and keeps the hash for a reload on the newer app', () => {
    const hash = `#branch=${encodeShareJson({ version: 3, anything: true })}`;
    window.location.hash = hash;
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedGame).toBeNull();
    expect(result.current.sharedBranch).toBeNull();
    expect(result.current.sharedBranchError).toBe('This share link comes from a newer PS Dashboard (link version 3). Reload the page for the latest version, then open it again.');
    expect(window.location.hash).toBe(hash);
  });

  test('a version 2 link that is damaged reads like any damaged link', () => {
    window.location.hash = `#branch=${encodeShareJson({ ...game, teams: undefined })}`;
    const { result } = renderHook(() => useSharedBranch());
    expect(result.current.sharedGame).toBeNull();
    expect(result.current.sharedBranchError).toMatch(/invalid or damaged/);
    expect(window.location.hash).toBe('');
  });
});
