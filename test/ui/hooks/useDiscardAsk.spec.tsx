import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDiscardAsk } from '../../../src/hooks/useDiscardAsk';

/**
 * Round 89 (user ruling 40, FB4a): Discard variation asks first once the variation has a played turn, through the same banner as
 * the leave question. A variation with no played turn discards at once. The count is the variation's turns, singles and doubles
 * alike (`turnEntryCount`), so one row per count covers both game types.
 */
describe('useDiscardAsk', () => {
  test('no played turn: the variation goes at once and nothing is asked', () => {
    const discard = vi.fn();
    const { result } = renderHook(() => useDiscardAsk(0, discard));
    act(() => result.current.request());
    expect(discard).toHaveBeenCalledTimes(1);
    expect(result.current.question).toBeNull();
  });

  test.each([
    [1, 'The variation has 1 played turn. Discarding drops it.'],
    [3, 'The variation has 3 played turns. Discarding drops them.'],
  ])('%i played turn(s): the question comes first; Discard variation runs it once, Cancel drops it', (turns, message) => {
    const discard = vi.fn();
    const { result } = renderHook(() => useDiscardAsk(turns, discard));
    act(() => result.current.request());
    expect(discard).not.toHaveBeenCalled();
    expect(result.current.question!.message).toBe(message);
    act(() => result.current.question!.cancel());
    expect(result.current.question).toBeNull();
    expect(discard).not.toHaveBeenCalled();
    act(() => result.current.request());
    act(() => result.current.question!.proceed());
    expect(discard).toHaveBeenCalledTimes(1);
    expect(result.current.question).toBeNull();
  });

  test('a question that stands while the variation goes away (another route) closes with it', () => {
    const { result, rerender } = renderHook(({ turns }) => useDiscardAsk(turns, vi.fn()), { initialProps: { turns: 2 } });
    act(() => result.current.request());
    expect(result.current.question).not.toBeNull();
    rerender({ turns: 0 });
    expect(result.current.question).toBeNull();
  });
});
