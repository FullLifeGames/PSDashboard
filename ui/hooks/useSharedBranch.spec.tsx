import { afterEach, describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSharedBranch } from '../../src/hooks/useSharedBranch';
import { encodeBranchShare, type BranchSharePayload } from '../../src/lib/branch-share';

const payload: BranchSharePayload = {
  version: 1, replayId: 'gen9ou-1', format: '[Gen 9] OU', formatid: 'gen9ou', players: ['Alice', 'Bob'],
  branchTurn: 3, createdAt: '2026-09-05T20:00:00.000Z', choices: [], finalLog: '|turn|3\n|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn',
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
});
