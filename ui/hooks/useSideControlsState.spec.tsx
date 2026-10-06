import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotModifiers } from '@fulllifegames/eval-engine';
import { useGimmickToggles, useMovePool } from '../../src/hooks/useSideControlsState';
import { NO_MODIFIERS } from '../fixtures/sim-state';

const withTera: BranchSlotModifiers = { ...NO_MODIFIERS, teraType: 'Fire' };
const withMega: BranchSlotModifiers = { ...NO_MODIFIERS, canMegaEvo: true };
const withZ: BranchSlotModifiers = { ...NO_MODIFIERS, zMoves: [null, 'Inferno Overdrive', null, null] };

type Sides = { p1: BranchSlotModifiers[]; p2: BranchSlotModifiers[] };
/** The panel's toggles over one position; `p1A` reads P1's first slot. */
function renderToggles(initial: Sides) {
  const hook = renderHook((sides: Sides) => useGimmickToggles(sides.p1, sides.p2), { initialProps: initial });
  return { ...hook, p1A: () => hook.result.current.gimmickFor('p1', 0) };
}

describe('useGimmickToggles', () => {
  test('nothing to toggle without a gimmick on the active Pokémon', () => {
    const { p1A } = renderToggles({ p1: [NO_MODIFIERS], p2: [NO_MODIFIERS] });
    expect(p1A()).toMatchObject({ modifier: null, modifierAvailable: false, hasZMoves: false, hasAnyModifier: false });
  });

  test('tera toggles on and off; mega and Z-moves follow the same switch', () => {
    const { p1A } = renderToggles({ p1: [withTera], p2: [NO_MODIFIERS] });
    expect(p1A().hasAnyModifier).toBe(true);
    act(() => p1A().toggle('terastallize'));
    expect(p1A()).toMatchObject({ modifier: 'terastallize', modifierAvailable: true });
    act(() => p1A().toggle('terastallize'));
    expect(p1A().modifier).toBeNull();

    const mega = renderToggles({ p1: [withMega], p2: [] });
    act(() => mega.p1A().toggle('mega'));
    expect(mega.p1A()).toMatchObject({ modifier: 'mega', modifierAvailable: true });

    const z = renderToggles({ p1: [withZ], p2: [] });
    expect(z.p1A().hasZMoves).toBe(true);
    act(() => z.p1A().toggle('zmove'));
    expect(z.p1A().modifierAvailable).toBe(true);
  });

  test('a spent or foreign gimmick drops the toggle instead of sticking to the next move', () => {
    const { p1A, rerender } = renderToggles({ p1: [withTera], p2: [] });
    act(() => p1A().toggle('terastallize'));
    expect(p1A().modifier).toBe('terastallize');
    rerender({ p1: [NO_MODIFIERS], p2: [] });
    expect(p1A()).toMatchObject({ modifier: null, modifierAvailable: false });
    // A new Tera-capable Pokémon in the slot starts unarmed.
    rerender({ p1: [withTera], p2: [] });
    expect(p1A().modifier).toBeNull();

    // Picking a gimmick the active cannot use never arms it.
    act(() => p1A().toggle('mega'));
    expect(p1A().modifierAvailable).toBe(false);
  });

  test('every slot of both sides keeps its own toggle', () => {
    const { result } = renderToggles({ p1: [withTera, withTera], p2: [withMega, withTera] });
    act(() => result.current.gimmickFor('p1', 1).toggle('terastallize'));
    act(() => result.current.gimmickFor('p2', 0).toggle('mega'));
    expect(result.current.gimmickFor('p1', 0).modifier).toBeNull();
    expect(result.current.gimmickFor('p1', 1).modifier).toBe('terastallize');
    expect(result.current.gimmickFor('p2', 0).modifier).toBe('mega');
    expect(result.current.gimmickFor('p2', 1).modifier).toBeNull();
  });

  test('teraBySlot names the type of every armed Tera toggle and nothing else (decision 18)', () => {
    const steel = { ...withTera, teraType: 'Steel' };
    const { result } = renderToggles({ p1: [withTera, withMega], p2: [steel] });
    expect(result.current.teraBySlot).toEqual({ p1: [null, null], p2: [null] });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    act(() => result.current.gimmickFor('p1', 1).toggle('mega'));
    act(() => result.current.gimmickFor('p2', 0).toggle('terastallize'));
    expect(result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: ['Steel'] });
  });

  test('armed toggles belong to one position: a new position key starts every slot unarmed (T124 point 2)', () => {
    const sides = { p1: [withTera, withMega], p2: [withTera] };
    const hook = renderHook(({ key }: { key: string }) => useGimmickToggles(sides.p1, sides.p2, key), { initialProps: { key: 'r1:main:2' } });
    act(() => hook.result.current.gimmickFor('p1', 0).toggle('terastallize'));
    act(() => hook.result.current.gimmickFor('p1', 1).toggle('mega'));
    act(() => hook.result.current.gimmickFor('p2', 0).toggle('terastallize'));
    expect(hook.result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: ['Fire'] });
    hook.rerender({ key: 'r1:main:2' });
    expect(hook.result.current.gimmickFor('p1', 1).modifier).toBe('mega');
    hook.rerender({ key: 'r1:main:3' });
    expect([hook.result.current.gimmickFor('p1', 0).modifier, hook.result.current.gimmickFor('p1', 1).modifier,
      hook.result.current.gimmickFor('p2', 0).modifier]).toEqual([null, null, null]);
    expect(hook.result.current.teraBySlot).toEqual({ p1: [null, null], p2: [null] });
    // Back on the old position the toggles stay released: an arming belongs to the visit, not to the turn.
    hook.rerender({ key: 'r1:main:2' });
    expect(hook.result.current.gimmickFor('p1', 0).modifier).toBeNull();
  });

  test('a gimmick one slot holds, armed or in its pending choice, is out of reach for the side\'s other slots (T124 point 1)', () => {
    const { result } = renderToggles({ p1: [withTera, withTera], p2: [withTera] });
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(result.current.gimmickFor('p1', 1).heldBy).toEqual({ terastallize: 'P1A' });
    act(() => result.current.gimmickFor('p1', 1).toggle('terastallize'));
    expect(result.current.gimmickFor('p1', 1).modifier).toBeNull();
    expect(result.current.gimmickFor('p1', 0).heldBy).toEqual({});
    expect(result.current.gimmickFor('p2', 0).heldBy).toEqual({});
    expect(result.current.teraBySlot).toEqual({ p1: ['Fire', null], p2: [null] });

    const pick = { kind: 'move' as const, moveId: 'flareblitz', moveName: 'Flare Blitz', modifier: 'terastallize' as const };
    const pending = renderHook(() => useGimmickToggles([withTera, withTera], [], 'k', { p1: [null, pick], p2: [] }));
    expect(pending.result.current.gimmickFor('p1', 0).heldBy).toEqual({ terastallize: 'P1B' });
    act(() => pending.result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(pending.result.current.gimmickFor('p1', 0).modifier).toBeNull();
  });

  test('teraBySlot keeps its identity across renders until a toggle changes', () => {
    const sides = { p1: [withTera], p2: [NO_MODIFIERS] };
    const { result, rerender } = renderToggles(sides);
    const first = result.current.teraBySlot;
    rerender(sides);
    expect(result.current.teraBySlot).toBe(first);
    act(() => result.current.gimmickFor('p1', 0).toggle('terastallize'));
    expect(result.current.teraBySlot).not.toBe(first);
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
