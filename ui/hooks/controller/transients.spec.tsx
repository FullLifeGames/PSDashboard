import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTransients } from '../../../src/hooks/controller/transients';

const choice = { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' };

describe('useTransients', () => {
  test('starts empty and holds drafts, the confirm, and the play-out state', () => {
    const { result } = renderHook(() => useTransients('gen9ou-1'));
    expect(result.current).toMatchObject({ playOut: null, playOutNotice: null, draftChoices: { p1: [], p2: [] }, pendingConfirm: null });
    expect(result.current.playOutRef.current).toBeNull();

    act(() => {
      result.current.setDraftChoices({ p1: [choice], p2: [] });
      result.current.setPendingConfirm({ message: 'Replace?', proceed: () => {} });
      result.current.setPlayOut({ active: true, executed: 0, turns: 0, startTurn: 2, prevAuto: false });
      result.current.setPlayOutNotice({ text: 'done', watchTurn: 2 });
    });
    expect(result.current.draftChoices.p1).toEqual([choice]);
    expect(result.current.pendingConfirm?.message).toBe('Replace?');
    expect(result.current.playOut?.active).toBe(true);
    expect(result.current.playOutNotice?.text).toBe('done');

    act(() => result.current.clearDraftChoices());
    expect(result.current.draftChoices).toEqual({ p1: [], p2: [] });
  });

  test('interrupting a play-out stops it through the ref only while it runs', () => {
    const { result } = renderHook(() => useTransients('gen9ou-1'));
    const stop = vi.fn();
    result.current.stopPlayOutRef.current = stop;
    act(() => result.current.interruptPlayOut());
    expect(stop).not.toHaveBeenCalled();

    result.current.playOutRef.current = { active: true };
    act(() => result.current.interruptPlayOut());
    expect(stop).toHaveBeenCalledWith({ returnToStart: false });
  });

  test('a new replay clears every transient', () => {
    const { result, rerender } = renderHook((replayId: string | undefined) => useTransients(replayId), { initialProps: 'gen9ou-1' as string | undefined });
    act(() => {
      result.current.setDraftChoices({ p1: [choice], p2: [choice] });
      result.current.setPendingConfirm({ message: 'Replace?', proceed: () => {} });
      result.current.setPlayOut({ active: true, executed: 1, turns: 1, startTurn: 2, prevAuto: true });
      result.current.setPlayOutNotice({ text: 'done', watchTurn: 2 });
    });
    rerender('gen9ou-2');
    expect(result.current).toMatchObject({ playOut: null, playOutNotice: null, draftChoices: { p1: [], p2: [] }, pendingConfirm: null });
  });
});
