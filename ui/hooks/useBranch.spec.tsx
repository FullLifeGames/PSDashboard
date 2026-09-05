import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { useBranch } from '../../src/hooks/useBranch';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

// The branch simulator itself, over the real @pkmn/sim: rebuilt at a replay
// turn on the main thread (no worker), then driven through choices and turns.

function fixture(kind: ReplayKind) {
  const { replayData, snapshots, observations } = replayFixture(kind);
  const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
  return { replayData, snapshots, p1Team, p2Team };
}

async function startAt(result: { current: ReturnType<typeof useBranch> }, data: ReturnType<typeof fixture>, turn: number) {
  const { replayData, snapshots, p1Team, p2Team } = data;
  await act(async () => {
    await result.current.startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, turn, snapshots[turn - 1] ?? null, {
      playerNames: [replayData.players[0], replayData.players[1]],
      snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
    });
  });
}

const firstMove = (state: NonNullable<ReturnType<typeof useBranch>['simState']>, side: 'p1' | 'p2', slot = 0) => {
  const move = (side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot)[slot].find(option => !option.disabled)!;
  return { kind: 'move' as const, moveId: move.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: move.name };
};

describe('useBranch', () => {
  test('starts idle and rebuilds the singles fixture at turn 2 with pickers for both sides', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    expect(result.current).toMatchObject({ branching: false, simState: null, history: [], variationStartTurn: null, executing: false });

    await startAt(result, data, 2);
    const state = result.current.simState!;
    expect(result.current.branching).toBe(true);
    expect(result.current.variationStartTurn).toBe(2);
    expect(result.current.executeError).toBeNull();
    expect(result.current.startSerialized).toMatch(/"turn":2/);
    expect(state.turnNumber).toBe(2);
    expect(state.p1ActiveSlots).toHaveLength(1);
    expect(state.p1MovesBySlot[0].length).toBeGreaterThan(0);
    expect(state.p2Switches.length).toBeGreaterThan(0);
    expect(result.current.getBattle()?.turn).toBe(2);
  }, 60_000);

  test('choices for both sides execute a turn, record it with its position, and advance the sim', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    const before = result.current.simState!;

    act(() => result.current.setChoice('p1', firstMove(before, 'p1')));
    expect(result.current.simState?.p1Choices[0]).toEqual(firstMove(before, 'p1'));
    expect(result.current.history).toHaveLength(0);

    act(() => result.current.setChoice('p2', firstMove(before, 'p2')));
    await act(async () => { await result.current.executeTurn(); });

    expect(result.current.executeError).toBeNull();
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toMatchObject({ turnNumber: 2, kind: 'turn', p1Choice: expect.stringMatching(/^move /) });
    // The recorded position is the one after the turn: either turn 3 or, after a
    // knock-out, the same turn waiting on a forced replacement.
    const after = result.current.simState!;
    expect(JSON.parse(result.current.history[0].serializedPosition!).turn).toBe(after.turnNumber);
    expect(after.turnNumber === 3 || after.p1ForceSwitch || after.p2ForceSwitch).toBe(true);
    expect(after.log.length).toBeGreaterThan(before.log.length);
    expect(after.p1Choices.every(choice => choice === null)).toBe(true);
    expect(result.current.executing).toBe(false);
  }, 60_000);

  test('a turn with a missing choice does not execute', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    act(() => result.current.setChoice('p1', firstMove(result.current.simState!, 'p1')));
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.history).toHaveLength(0);
    expect(result.current.simState?.turnNumber).toBe(2);
  }, 60_000);

  test('stopBranch returns to the idle state', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    act(() => result.current.stopBranch());
    expect(result.current).toMatchObject({ branching: false, simState: null, history: [], variationStartTurn: null, startSerialized: null });
    expect(result.current.getBattle()).toBeNull();
  }, 60_000);

  test('doubles: two active slots per side; a switch named twice in one turn never executes, distinct choices do', async () => {
    const data = fixture('doubles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 1);
    const state = result.current.simState!;
    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Pikachu', 'Eevee']);
    expect(state.p1MovesBySlot).toHaveLength(2);
    expect(state.p1SwitchesBySlot[1].map(option => option.species)).toEqual(['Raichu', 'Jolteon']);
    const toBench = { kind: 'switch' as const, speciesId: 'raichu', pokemonName: 'Raichu' };

    act(() => {
      result.current.setChoice('p1', toBench, 0);
      result.current.setChoice('p1', toBench, 1);
      result.current.setChoice('p2', firstMove(state, 'p2', 0), 0);
      result.current.setChoice('p2', firstMove(state, 'p2', 1), 1);
    });
    expect(result.current.simState?.p1Choices).toEqual([toBench, toBench]);
    await act(async () => { await result.current.executeTurn(); });
    // The duplicate is caught before the sim sees it: nothing executes, nothing errors.
    expect(result.current.history).toHaveLength(0);
    expect(result.current.executeError).toBeNull();
    expect(result.current.simState?.turnNumber).toBe(1);

    act(() => {
      result.current.setChoice('p1', firstMove(state, 'p1', 0), 0);
      result.current.setChoice('p1', { kind: 'switch', speciesId: 'jolteon', pokemonName: 'Jolteon' }, 1);
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.executeError).toBeNull();
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].p1SlotChoices).toHaveLength(2);
    expect(result.current.simState!.log.length).toBeGreaterThan(state.log.length);
  }, 60_000);
});
