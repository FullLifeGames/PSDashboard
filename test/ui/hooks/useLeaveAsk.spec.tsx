import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLeaveAsk } from '../../../src/hooks/useLeaveAsk';

/**
 * Round 89 (lane H, #105), H16a (user ruling 13.11.2026): Start and loading a replay ask first when an unsaved variation is open. The
 * hook runs the action at once when there is nothing to lose; else it holds the action behind the question, which names what the
 * action is and what goes. Discard variation runs it, Cancel drops it.
 */
describe('useLeaveAsk', () => {
  test('with no unsaved variation the action runs at once and nothing is asked', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useLeaveAsk(() => false));
    let asked = true;
    act(() => { asked = result.current.ask('Loading a replay', run); });
    expect(asked).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.question).toBeNull();
  });

  test('with no check given (a replay-less page, embed) the action runs at once', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useLeaveAsk(undefined));
    act(() => { result.current.ask('Starting a game', run); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('an unsaved variation holds the action behind the question; Discard variation runs it once', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useLeaveAsk(() => true));
    let asked = false;
    act(() => { asked = result.current.ask('Starting a game', run); });
    expect(asked).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(result.current.question!.message).toBe('The open variation is not saved. Starting a game closes it.');
    act(() => result.current.question!.proceed());
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.question).toBeNull();
  });

  test('Cancel drops the action and keeps everything as it was', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useLeaveAsk(() => true));
    act(() => { result.current.ask('Loading a replay', run); });
    act(() => result.current.question!.cancel());
    expect(run).not.toHaveBeenCalled();
    expect(result.current.question).toBeNull();
  });

  test('an inactive hook (a closed dialog) drops a question that is still open', () => {
    let active = true;
    const { result, rerender } = renderHook(() => useLeaveAsk(() => true, active));
    act(() => { result.current.ask('Starting a game', vi.fn()); });
    expect(result.current.question).not.toBeNull();
    active = false;
    rerender();
    expect(result.current.question).toBeNull();
  });
});
