import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSimState } from '@fulllifegames/eval-engine';
import { usePositionPicker } from '../../src/hooks/usePositionPicker';
import type { TeamBuildSources } from '../../src/lib/eval-acquire';

/** The recorded positions resolve when the test says so: each serialized string names its picker state. */
const pending = new Map<string, (state: BranchSimState) => void>();
vi.mock('../../src/lib/picker-state', () => ({
  pickerStateFromSerialized: (serialized: string) => new Promise<BranchSimState>(resolve => pending.set(serialized, resolve)),
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

async function land(serialized: string, state: BranchSimState) {
  await waitFor(() => expect(pending.has(serialized)).toBe(true));
  act(() => pending.get(serialized)!(state));
}

describe('usePositionPicker', () => {
  test('while the viewed position resolves, the panel keeps what it showed last, as stale', async () => {
    // Round 77 (user report 28.10.2026): one turn back from the tip of a turn-0 variation showed the picker of the main line's
    // turn 1 (Mienshao's moves) for the 40 to 80 ms until turn 3 (Kyurem) resolved, and a click there chose a move of a
    // Pokémon that was not on the field. Without a stand-in the history below jumped about 380 px for two frames.
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
});
