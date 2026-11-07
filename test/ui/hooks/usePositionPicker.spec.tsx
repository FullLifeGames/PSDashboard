import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { usePositionPicker } from '../../../src/hooks/usePositionPicker';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import type { PlayedAtPosition } from '../../../src/lib/played-pick';
import { simState } from '../fixtures/sim-state';

/** The recorded positions resolve when the test says so: each serialized string names its picker state and the battle it was read from. */
const pending = new Map<string, (state: BranchSimState, battle?: unknown) => void>();
const benches: unknown[] = [];
vi.mock('../../../src/lib/picker-state', () => ({
  pickerFromSerialized: (serialized: string, bench: unknown) => {
    benches.push(bench);
    return new Promise(resolve => pending.set(serialized, (state, battle = { turn: 0 }) => resolve({ state, battle })));
  },
}));

type Args = Parameters<typeof usePositionPicker>[0];

const NO_DRAFT = { p1: [], p2: [] };
const stateFor = (name: string) => ({ p1Active: { name }, log: [] }) as unknown as BranchSimState;
const LIVE = stateFor('Kyurem at the tip');

function args(overrides: Partial<Args>): Args {
  return {
    replayData: null, snapshots: [], sources: {} as TeamBuildSources, bench: null, replayGenNumber: 9,
    liveTip: false, viewingVariation: true, serializedAtView: null, viewTurn: 1, variationStartTurn: 0, startSerialized: null,
    getExact: () => null, exactPositionsVersion: 0, draftChoices: NO_DRAFT, liveSimState: LIVE, ...overrides,
  };
}

async function land(serialized: string, state: BranchSimState, battle?: unknown) {
  await waitFor(() => expect(pending.has(serialized)).toBe(true));
  act(() => pending.get(serialized)!(state, battle));
}

describe('usePositionPicker', () => {
  // Round 88 (T314, #55): a stored position is read through the bench of the bring-limited game.
  test('a stored position is read through the game\'s bench', async () => {
    const bench = { lists: { p1: [], p2: ['Kyurem'] }, rules: { gen: 9 } };
    benches.length = 0;
    renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ viewTurn: 2, serializedAtView: 'bench-turn-2', bench }) });
    await waitFor(() => expect(pending.has('bench-turn-2')).toBe(true));
    expect(benches).toEqual([bench]);
  });

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

  describe('the seed of the dock (round 84, lane A)', () => {
    const played: PlayedAtPosition = {
      p1: { kind: 'move', name: 'Flare Blitz', targetLoc: 2 }, p2: { kind: 'move', name: 'Wood Hammer', targetLoc: 1 },
      p1Slots: [{ kind: 'move', name: 'Flare Blitz', targetLoc: 2 }, { kind: 'move', name: 'Moonblast' }],
      p2Slots: [{ kind: 'move', name: 'Wood Hammer', targetLoc: 1 }, null],
    };
    const mine: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };
    const names = (choices: (BranchSlotChoice | null)[] | undefined) => (choices ?? []).map(choice => (choice && choice.kind === 'move' ? choice.moveName : choice));

    test('an untouched slot shows the seed, a touched one the draft, and the draft clearing brings the seed back', async () => {
      const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ played }) });
      rerender(args({ serializedAtView: 'seeded', played }));
      await land('seeded', simState('doubles'));
      await waitFor(() => expect(result.current.pickerSimState?.p1Choices).toHaveLength(2));
      const shown = result.current.pickerSimState!;
      expect(names(shown.p1Choices)).toEqual(['Flare Blitz', null]);
      expect(names(shown.p2Choices)).toEqual(['Wood Hammer', null]);
      expect(shown.p1Choice).toBe(shown.p1Choices[0]);
      expect(result.current.pickerSeed?.p1[1]).toEqual({ choice: null, played: played.p1Slots![1] });

      rerender(args({ serializedAtView: 'seeded', played, draftChoices: { p1: [mine], p2: [] } }));
      expect(names(result.current.pickerSimState?.p1Choices)).toEqual(['Protect', null]);
      expect(names(result.current.pickerSimState?.p2Choices)).toEqual(['Wood Hammer', null]);
      // Navigation clears the draft: the seed stands again.
      rerender(args({ serializedAtView: 'seeded', played }));
      expect(names(result.current.pickerSimState?.p1Choices)).toEqual(['Flare Blitz', null]);
    });

    test('the swap from the snapshot picker to the exact position gives an untouched slot its target', async () => {
      // The snapshot picker lists no targets, so its seed carries none; the exact position lists them and the same slot re-seeds.
      const approximate = simState('doubles');
      approximate.p1MovesBySlot[0] = approximate.p1MovesBySlot[0].map(option => ({ ...option, targetOptions: [] }));
      const targetOf = (current: ReturnType<typeof usePositionPicker>) => {
        const choice = current.pickerSimState?.p1Choices[0];
        return choice && choice.kind === 'move' ? choice.targetLoc : 'no choice';
      };
      const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ played }) });
      rerender(args({ serializedAtView: 'approximate', played }));
      await land('approximate', approximate);
      await waitFor(() => expect(result.current.positionPicker).not.toBeNull());
      expect(targetOf(result.current)).toBeUndefined();
      rerender(args({ serializedAtView: 'exact', played }));
      await land('exact', simState('doubles'));
      await waitFor(() => expect(targetOf(result.current)).toBe(2));
    });

    test('no seed on a stand-in: the played record belongs to the viewed position, not to the one on screen', async () => {
      const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ viewTurn: 3, serializedAtView: 'three', played }) });
      await land('three', simState('doubles'));
      await waitFor(() => expect(result.current.pickerSeed).not.toBeNull());
      rerender(args({ viewTurn: 2, serializedAtView: 'two', played }));
      expect(result.current.pickerStale).toBe(true);
      expect(result.current.pickerSeed).toBeNull();
      expect(names(result.current.pickerSimState?.p1Choices)).toEqual([]);
    });

    test('without a played record the draft stands as it was', async () => {
      const draftChoices = { p1: [mine], p2: [] };
      const { result, rerender } = renderHook((props: Args) => usePositionPicker(props), { initialProps: args({ draftChoices }) });
      rerender(args({ serializedAtView: 'plain', draftChoices }));
      await land('plain', simState('doubles'));
      await waitFor(() => expect(result.current.pickerSimState?.p1Choices).toBe(draftChoices.p1));
    });
  });
});
