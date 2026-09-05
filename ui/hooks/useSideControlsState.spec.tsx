import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotModifiers } from '@fulllifegames/eval-engine';
import { useGimmick, useMovePool } from '../../src/hooks/useSideControlsState';
import { NO_MODIFIERS } from '../fixtures/sim-state';

const withTera: BranchSlotModifiers = { ...NO_MODIFIERS, teraType: 'Fire' };
const withMega: BranchSlotModifiers = { ...NO_MODIFIERS, canMegaEvo: true };
const withZ: BranchSlotModifiers = { ...NO_MODIFIERS, zMoves: [null, 'Inferno Overdrive', null, null] };

describe('useGimmick', () => {
  test('nothing to toggle without a gimmick on the active Pokémon', () => {
    const { result } = renderHook(() => useGimmick(NO_MODIFIERS));
    expect(result.current).toMatchObject({ modifier: null, modifierAvailable: false, hasZMoves: false, hasAnyModifier: false });
  });

  test('tera toggles on and off; mega and Z-moves follow the same switch', () => {
    const { result } = renderHook(() => useGimmick(withTera));
    expect(result.current.hasAnyModifier).toBe(true);
    act(() => result.current.toggle('terastallize'));
    expect(result.current).toMatchObject({ modifier: 'terastallize', modifierAvailable: true });
    act(() => result.current.toggle('terastallize'));
    expect(result.current.modifier).toBeNull();

    const mega = renderHook(() => useGimmick(withMega));
    act(() => mega.result.current.toggle('mega'));
    expect(mega.result.current).toMatchObject({ modifier: 'mega', modifierAvailable: true });

    const z = renderHook(() => useGimmick(withZ));
    expect(z.result.current.hasZMoves).toBe(true);
    act(() => z.result.current.toggle('zmove'));
    expect(z.result.current.modifierAvailable).toBe(true);
  });

  test('a spent or foreign gimmick drops the toggle instead of sticking to the next move', () => {
    const { result, rerender } = renderHook((modifiers: BranchSlotModifiers) => useGimmick(modifiers), { initialProps: withTera });
    act(() => result.current.toggle('terastallize'));
    expect(result.current.modifier).toBe('terastallize');
    rerender(NO_MODIFIERS);
    expect(result.current).toMatchObject({ modifier: null, modifierAvailable: false });

    // Picking a gimmick the active cannot use never arms it.
    act(() => result.current.toggle('mega'));
    expect(result.current.modifierAvailable).toBe(false);
  });
});

describe('useMovePool', () => {
  test('loads the legal gen 9 pool of the active species', async () => {
    const { result } = renderHook(() => useMovePool('Garchomp', 9));
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current.length).toBeGreaterThan(20), { timeout: 20_000 });
    expect(result.current).toContain('Earthquake');
    expect(result.current).toContain('Dragon Claw');
    expect(result.current).not.toContain('Spore');
  }, 30_000);

  test('a species change empties the pool at once and loads the new one', async () => {
    const { result, rerender } = renderHook((species: string) => useMovePool(species, 9), { initialProps: 'Garchomp' });
    await waitFor(() => expect(result.current).toContain('Earthquake'), { timeout: 20_000 });
    rerender('Amoonguss');
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toContain('Spore'), { timeout: 20_000 });
    expect(result.current).not.toContain('Earthquake');
  }, 30_000);

  test('an empty species loads nothing', () => {
    const { result } = renderHook(() => useMovePool('', 9));
    expect(result.current).toEqual([]);
  });
});
