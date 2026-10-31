import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSimState } from '@fulllifegames/eval-engine';
import { usePositionPicker } from '../../../src/hooks/usePositionPicker';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';

/** The recorded positions resolve when the test says so: each serialized string names its picker state and the battle it was read from. */
const pending = new Map<string, (state: BranchSimState, battle?: unknown) => void>();
vi.mock('../../../src/lib/picker-state', () => ({
  pickerFromSerialized: (serialized: string) => new Promise(resolve => pending.set(serialized, (state, battle = { turn: 0 }) => resolve({ state, battle }))),
}));

type Args = Parameters<typeof usePositionPicker>[0];

const NO_DRAFT = { p1: [], p2: [] };
const stateFor = (name: string) => ({ p1Active: { name }, log: [] }) as unknown as BranchSimState;
const LIVE = stateFor('Kyurem at the tip');

function args(overrides: Partial<Args>): Args {
  return {
    replayData: null, snapshots: [], sources: {} as TeamBuildSources, bringOnlyLists: null, replayGenNumber: 9,
    liveTip: false, viewingVariation: true, serializedAtView: null, viewTurn: 1, variationStartTurn: 0, startSerialized: null,
    getExact: () => null, exactPositionsVersion: 0, draftChoices: NO_DRAFT, liveSimState: LIVE, ...overrides,
  };
}

async function land(serialized: string, state: BranchSimState, battle?: unknown) {
  await waitFor(() => expect(pending.has(serialized)).toBe(true));
  act(() => pending.get(serialized)!(state, battle));
}

describe('usePositionPicker', () => {
  test('while the viewed position resolves, the panel keeps what it showed last, as stale', async () => {
    // Round 77 (user report 28.10.2026): one turn back from the tip of a turn-0 variation showed another position's picker
    // (Mienshao's moves) for about 40 ms until turn 3 (Kyurem) resolved, and a click there would choose a move of a Pokémon
    // that was not on the field. Without a stand-in the history below jumped by the panel's height (585 px) for two frames.
    const shown = (current: { pickerSimState: BranchSimState | null }) => current.pickerSimState?.p1Active?.name;
    const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), {
      initialProps: args({ viewingVariation: false, viewTurn: 1 }),
    });
    rerender(args({ viewTurn: 2, serializedAtView: 'turn-2' }));
    await land('turn-2', stateFor('Mienshao at turn 2'));
    await waitFor(() => expect(result.current.positionPicker?.simState.p1Active?.name).toBe('Mienshao at turn 2'));
    expect(result.current.pickerStale).toBe(false);

    // At the tip the panel shows the live sim; one turn back it keeps that state, stale, until turn 3 lands.
    rerender(args({ viewTurn: 4, liveTip: true }));
    expect(result.current.positionPicker).toBeNull();
    expect(result.current.pickerStale).toBe(false);
    rerender(args({ viewTurn: 3, serializedAtView: 'turn-3' }));
    expect(result.current.positionPicker).toBeNull();
    expect(shown(result.current)).toBe('Kyurem at the tip');
    expect(result.current.pickerStale).toBe(true);
    await land('turn-3', stateFor('Kyurem at turn 3'));
    await waitFor(() => expect(shown(result.current)).toBe('Kyurem at turn 3'));
    expect(result.current.pickerStale).toBe(false);

    // Between two recorded positions the last one stands in.
    rerender(args({ viewTurn: 2, serializedAtView: 'turn-2 again' }));
    expect(shown(result.current)).toBe('Kyurem at turn 3');
    expect(result.current.pickerStale).toBe(true);
    await land('turn-2 again', stateFor('Mienshao at turn 2'));
    await waitFor(() => expect(shown(result.current)).toBe('Mienshao at turn 2'));
    expect(result.current.pickerStale).toBe(false);
  });

  test('a stored position hands the panel the battle it was read from, for the dice offers (round 82, A7b)', async () => {
    // The chips ask the simulator which dice a move draws, so a viewed replay position needs its battle. Only a position that
    // resolved from a recorded capture has one; the live tip has the branch's own, and a stand-in has none that belongs here.
    const stored = { turn: 12 };
    const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ viewTurn: 4, liveTip: true }) });
    expect(result.current.getPickerBattle).toBeUndefined();
    rerender(args({ viewTurn: 3, viewingVariation: false, serializedAtView: 'viewed-3', getExact: () => 'viewed-3' }));
    expect(result.current.getPickerBattle).toBeUndefined();
    await land('viewed-3', stateFor('Kyurem at turn 3'), stored);
    await waitFor(() => expect(result.current.getPickerBattle).toBeDefined());
    expect(result.current.getPickerBattle!()).toBe(stored);
    // the hook hands out one function per battle, so the panel's effect does not ask again on every render
    const first = result.current.getPickerBattle;
    rerender(args({ viewTurn: 3, viewingVariation: false, serializedAtView: 'viewed-3', getExact: () => 'viewed-3' }));
    expect(result.current.getPickerBattle).toBe(first);
    // another viewed position that has not landed has no battle: the stand-in shows the last picker, stale
    rerender(args({ viewTurn: 2, viewingVariation: false, serializedAtView: 'viewed-2', getExact: () => 'viewed-2' }));
    expect(result.current.pickerStale).toBe(true);
    expect(result.current.getPickerBattle).toBeUndefined();
  });

  test('the replay\'s log goes with the battle of a main line position, and with no other (round 82, A7b)', async () => {
    // The turn a main line position stands at is the turn the replay shows, so the chips read the log's dice from its lines. A
    // position inside a variation is no turn of the replay, and an unresolved position has no battle to read them for.
    const replayData = { log: 'the replay log' } as unknown as Args['replayData'];
    const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ viewTurn: 4, liveTip: true, replayData }) });
    expect(result.current.pickerReplayLog).toBeUndefined();
    rerender(args({ viewTurn: 5, viewingVariation: false, serializedAtView: 'main-5', getExact: () => 'main-5', replayData }));
    expect(result.current.pickerReplayLog).toBeUndefined();
    await land('main-5', stateFor('Kyurem at turn 5'));
    await waitFor(() => expect(result.current.pickerReplayLog).toBe('the replay log'));
    rerender(args({ viewTurn: 6, viewingVariation: true, serializedAtView: 'variation-6', replayData }));
    await land('variation-6', stateFor('Kyurem at turn 6'));
    await waitFor(() => expect(result.current.getPickerBattle).toBeDefined());
    expect(result.current.pickerReplayLog).toBeUndefined();
  });

  test('a viewed position that cannot be shown ends the stand-in: the panel goes empty, not stale for good', async () => {
    // Review of round 77: a variation position without a capture resolves to no picker, and the stand-in stayed on screen,
    // inert, for as long as the pointer stood there.
    const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ viewTurn: 4, liveTip: true }) });
    rerender(args({ viewTurn: 3, serializedAtView: null }));
    await waitFor(() => expect(result.current.pickerStale).toBe(false));
    expect(result.current.pickerSimState).toBeNull();
    expect(result.current.positionPicker).toBeNull();
  });
});
