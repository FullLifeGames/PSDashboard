import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor, render, screen } from '@testing-library/react';
import { useBranch } from '../../../src/hooks/useBranch';
import { freshLog, setOf } from '../fixtures/dice-battle';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { replayFixture, type ReplayKind } from '../fixtures/replay';
import type { DieReport, ForcedDie } from '@fulllifegames/eval-engine';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { decodeBranchShare, encodeBranchShare, makeBranchSharePayload } from '../../../src/lib/branch-share';
import { SharedBranchView } from '../../../src/components/SharedBranchView';
import { turnDiceMarks, sideMarkTexts } from '../../../src/lib/branch-dice-marks';

const mon = (species: string, moves: string[]) => setOf(species, moves, { level: 50 });

/**
 * Round 84 (turn dock), step A7a, ruling 2a: a forced replacement the engine filled waits for Execute. The branch records a pick
 * without its follow-ups (`recordChoice`: no command is sent although the replacing side is complete), and `executePending`
 * sends the forced replacement the dock holds, or the turn when no replacement is open. A bench click (`setChoice`) still sends
 * at once, as before. Singles and doubles, on the pivot scenes of the dice pause rows below (a Volt Switch pauses the turn
 * for the replacement of one side).
 */
const SCENES = [
  {
    kind: 'singles', format: 'gen9ou',
    p1: [mon('Zapdos', ['voltswitch', 'protect']), mon('Garchomp', ['earthquake'])],
    p2: [mon('Blissey', ['scald', 'protect']), mon('Snorlax', ['bodyslam'])],
    p1Moves: [{ moveId: 'voltswitch', moveName: 'Volt Switch' }], p2Moves: [{ moveId: 'scald', moveName: 'Scald' }], replacement: 'garchomp',
  },
  {
    kind: 'doubles', format: 'gen9doublesou',
    p1: [mon('Zapdos', ['voltswitch', 'protect']), mon('Garchomp', ['protect']), mon('Clefable', ['protect'])],
    p2: [mon('Blissey', ['scald', 'protect']), mon('Chansey', ['protect']), mon('Snorlax', ['protect'])],
    p1Moves: [{ moveId: 'voltswitch', moveName: 'Volt Switch', targetLoc: 1 }, { moveId: 'protect', moveName: 'Protect' }],
    p2Moves: [{ moveId: 'scald', moveName: 'Scald', targetLoc: 1 }, { moveId: 'protect', moveName: 'Protect' }], replacement: 'clefable',
  },
] as const;

describe.each(SCENES)('the branch at a forced replacement, $kind', scene => {
  const replacement = { kind: 'switch' as const, speciesId: scene.replacement, pokemonName: scene.replacement };

  async function atForcedPosition() {
    const hook = renderHook(() => useBranch());
    await act(async () => {
      await hook.result.current.startBranch(scene.format, [...scene.p1], [...scene.p2], freshLog({ format: scene.format, p1: [...scene.p1], p2: [...scene.p2] }), 1, null, {
        playerNames: ['A', 'B'],
      });
    });
    act(() => {
      scene.p1Moves.forEach((choice, slot) => hook.result.current.setChoice('p1', { kind: 'move', ...choice }, slot));
      scene.p2Moves.forEach((choice, slot) => hook.result.current.setChoice('p2', { kind: 'move', ...choice }, slot));
    });
    await act(async () => { await hook.result.current.executeTurn(); });
    expect(hook.result.current.simState!.p1ForceSwitch).toBe(true);
    expect(hook.result.current.history).toHaveLength(1);
    return hook.result;
  }

  test('recordChoice keeps the replacement as a pending pick and sends nothing', async () => {
    const result = await atForcedPosition();
    const forcedSlot = result.current.simState!.p1ForceSwitches.findIndex(Boolean);
    act(() => result.current.recordChoice('p1', replacement, forcedSlot));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.simState!.p1ForceSwitch).toBe(true);
    expect(result.current.simState!.p1Choices[forcedSlot]).toEqual(replacement);
    expect(result.current.getChoices().p1[forcedSlot]).toEqual(replacement);
  }, 180_000);

  test('executePending sends the recorded replacement as a forced entry, once', async () => {
    const result = await atForcedPosition();
    const forcedSlot = result.current.simState!.p1ForceSwitches.findIndex(Boolean);
    act(() => result.current.recordChoice('p1', replacement, forcedSlot));
    await act(async () => { await result.current.executePending(); });
    await waitFor(() => expect(result.current.history).toHaveLength(2));
    expect(result.current.history[1].kind).toBe('forced');
    expect(result.current.executeError).toBeNull();
    expect(result.current.simState!.p1ForceSwitch).toBe(false);
    await act(async () => { await result.current.executePending(); });
    expect(result.current.history).toHaveLength(2);
  }, 180_000);

  test('executePending with no replacement recorded sends nothing', async () => {
    const result = await atForcedPosition();
    await act(async () => { await result.current.executePending(); });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.simState!.p1ForceSwitch).toBe(true);
  }, 180_000);

  test('a click on the bench (setChoice) still sends the body in at once', async () => {
    const result = await atForcedPosition();
    const forcedSlot = result.current.simState!.p1ForceSwitches.findIndex(Boolean);
    await act(async () => { result.current.setChoice('p1', replacement, forcedSlot); });
    await waitFor(() => expect(result.current.history).toHaveLength(2));
    expect(result.current.history[1].kind).toBe('forced');
  }, 180_000);

  // Round 84 (A7j): the bench click publishes its pick before the send goes out, so the dock's chip shows the clicked body (and
  // Execute reads "Executing...") for the moments the send takes, not "choose a replacement" or the engine's earlier pick.
  test('a click on the bench publishes the clicked body while the send is under way', async () => {
    const result = await atForcedPosition();
    const forcedSlot = result.current.simState!.p1ForceSwitches.findIndex(Boolean);
    act(() => { result.current.setChoice('p1', replacement, forcedSlot); });
    expect(result.current.executing).toBe(true);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.simState!.p1Choices[forcedSlot]).toEqual(replacement);
    await waitFor(() => expect(result.current.history).toHaveLength(2));
    expect(result.current.simState!.p1ForceSwitch).toBe(false);
    expect(result.current.executing).toBe(false);
  }, 180_000);

  test('without a replacement open, executePending runs the turn like executeTurn', async () => {
    const hook = renderHook(() => useBranch());
    await act(async () => {
      await hook.result.current.startBranch(scene.format, [...scene.p1], [...scene.p2], freshLog({ format: scene.format, p1: [...scene.p1], p2: [...scene.p2] }), 1, null, {
        playerNames: ['A', 'B'],
      });
    });
    await act(async () => { await hook.result.current.executePending(); });
    expect(hook.result.current.history).toHaveLength(0);
    act(() => {
      scene.p1Moves.forEach((choice, slot) => hook.result.current.recordChoice('p1', { kind: 'move', ...choice, moveId: slot === 0 ? 'protect' : choice.moveId, moveName: slot === 0 ? 'Protect' : choice.moveName, targetLoc: undefined }, slot));
      scene.p2Moves.forEach((choice, slot) => hook.result.current.recordChoice('p2', { kind: 'move', ...choice, moveId: 'protect', moveName: 'Protect', targetLoc: undefined }, slot));
    });
    await act(async () => { await hook.result.current.executePending(); });
    expect(hook.result.current.history).toHaveLength(1);
  }, 180_000);
});

/**
 * Round 84 (A7c, ruling 16a), doubles with both slots of P1 forced: Garchomp's Explosion also faints the ally Magikarp, so P1 owes
 * two replacements. The branch holds both recorded picks without sending anything (the dock records the click while the other
 * slot holds only the engine's pick), and `executePending` then sends the side's command once. A single slot of one side is
 * covered above; singles have one slot per side, so the rule has nothing to hold back there.
 */
describe('the branch at a forced replacement of both slots of one side, doubles', () => {
  const p1 = [mon('Garchomp', ['explosion']), mon('Magikarp', ['splash']), mon('Clefable', ['protect']), mon('Snorlax', ['protect'])];
  const p2 = [mon('Blissey', ['protect']), mon('Chansey', ['protect']), mon('Skarmory', ['protect'])];
  const pick = (id: string) => ({ kind: 'switch' as const, speciesId: id, pokemonName: id });

  async function atBothForced() {
    const hook = renderHook(() => useBranch());
    await act(async () => {
      await hook.result.current.startBranch('gen9doublesou', [...p1], [...p2], freshLog({ format: 'gen9doublesou', p1: [...p1], p2: [...p2] }), 1, null, { playerNames: ['A', 'B'] });
    });
    act(() => {
      hook.result.current.setChoice('p1', { kind: 'move', moveId: 'explosion', moveName: 'Explosion' }, 0);
      hook.result.current.setChoice('p1', { kind: 'move', moveId: 'splash', moveName: 'Splash' }, 1);
      hook.result.current.setChoice('p2', { kind: 'move', moveId: 'protect', moveName: 'Protect' }, 0);
      hook.result.current.setChoice('p2', { kind: 'move', moveId: 'protect', moveName: 'Protect' }, 1);
    });
    await act(async () => { await hook.result.current.executeTurn(); });
    expect(hook.result.current.simState!.p1ForceSwitches).toEqual([true, true]);
    return hook.result;
  }

  test('two recorded picks send nothing; executePending sends both bodies in once', async () => {
    const result = await atBothForced();
    const before = result.current.history.length;
    act(() => result.current.recordChoice('p1', pick('clefable'), 0));
    expect(result.current.history).toHaveLength(before);
    act(() => result.current.recordChoice('p1', pick('snorlax'), 1));
    expect(result.current.history).toHaveLength(before);
    expect(result.current.simState!.p1ForceSwitch).toBe(true);
    await act(async () => { await result.current.executePending(); });
    await waitFor(() => expect(result.current.history).toHaveLength(before + 1));
    expect(result.current.history[before].kind).toBe('forced');
    expect(result.current.simState!.p1ForceSwitch).toBe(false);
  }, 180_000);

  test('a click through setChoice on the second slot still sends the side at once (the dock chooses between the two)', async () => {
    const result = await atBothForced();
    const before = result.current.history.length;
    act(() => result.current.recordChoice('p1', pick('clefable'), 0));
    await act(async () => { result.current.setChoice('p1', pick('snorlax'), 1); });
    await waitFor(() => expect(result.current.history).toHaveLength(before + 1));
  }, 180_000);
});


/**
 * Round 84 (A7d): the scene of the e2e case `turn-dock-forced` (the hand-written Doubles OU replay `gen9doubles-forced-test`). Two
 * Mementos faint both bodies of P1 whatever the dice roll, as long as neither foe protects: Memento's accuracy is 100 and the user
 * faints when it hits. The A7c case took a corpus turn whose two faints depend on the damage rolls, and the sim never asked for both
 * replacements there. The sim asks P1 for two replacements here, and P2 for none.
 */
describe('two Mementos force both slots of P1 and no slot of P2, doubles', () => {
  const p1 = [mon('Pikachu', ['memento', 'quickattack', 'protect']), mon('Eevee', ['memento', 'quickattack', 'protect']),
    mon('Raichu', ['thunderbolt']), mon('Jolteon', ['thunderbolt']), mon('Vaporeon', ['scald']), mon('Flareon', ['flamecharge'])];
  const p2 = [mon('Bulbasaur', ['vinewhip', 'protect']), mon('Charmander', ['ember', 'protect']), mon('Squirtle', ['watergun']), mon('Ivysaur', ['vinewhip'])];

  test('the sim asks P1 for two replacements', async () => {
    const hook = renderHook(() => useBranch());
    await act(async () => {
      await hook.result.current.startBranch('gen9doublesou', [...p1], [...p2], freshLog({ format: 'gen9doublesou', p1: [...p1], p2: [...p2] }), 1, null, { playerNames: ['A', 'B'] });
    });
    act(() => {
      hook.result.current.setChoice('p1', { kind: 'move', moveId: 'memento', moveName: 'Memento', targetLoc: 1 }, 0);
      hook.result.current.setChoice('p1', { kind: 'move', moveId: 'memento', moveName: 'Memento', targetLoc: 1 }, 1);
      hook.result.current.setChoice('p2', { kind: 'move', moveId: 'vinewhip', moveName: 'Vine Whip', targetLoc: 1 }, 0);
      hook.result.current.setChoice('p2', { kind: 'move', moveId: 'ember', moveName: 'Ember', targetLoc: 1 }, 1);
    });
    await act(async () => { await hook.result.current.executeTurn(); });
    expect(hook.result.current.simState!.p1ForceSwitches).toEqual([true, true]);
    expect(hook.result.current.simState!.p2ForceSwitch).toBe(false);
  }, 180_000);
});

function fixture(kind: ReplayKind) {
  const { replayData, snapshots, observations } = replayFixture(kind);
  const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
  return { replayData, snapshots, p1Team, p2Team };
}

/** A recorded entry whose move the rebuilt team no longer knows (a set edit removed it). */
const brokenEntry = (turnNumber: number, slots = 1) => ({
  turnNumber, kind: 'turn' as const, p1Choice: 'move 1', p2Choice: 'move 1', p1Active: null, p1ActiveSlots: [], p2Active: null,
  p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
  p1SlotChoices: Array.from({ length: slots }, () => ({ kind: 'move' as const, moveId: 'nosuchmove', moveName: 'Nosuch Move' })),
  p2SlotChoices: Array.from({ length: slots }, () => ({ kind: 'move' as const, moveId: 'nosuchmove', moveName: 'Nosuch Move' })),
});

async function startWith(result: { current: ReturnType<typeof useBranch> }, data: ReturnType<typeof fixture>, turn: number, replayHistory: ReturnType<typeof brokenEntry>[]) {
  const { replayData, snapshots, p1Team, p2Team } = data;
  let outcome: Awaited<ReturnType<ReturnType<typeof useBranch>['startBranch']>>;
  await act(async () => {
    outcome = await result.current.startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, turn, snapshots[turn - 1] ?? null, {
      playerNames: [replayData.players[0], replayData.players[1]],
      snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
      replayHistory,
    });
  });
  return outcome!;
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

  // Round 84 (turn dock): the engine fill reads the picks at the moment its result lands; a render closure would be stale.
  test('getChoices reads the pending picks of the moment, and nothing after the turn ran', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    const state = result.current.simState!;
    expect(result.current.getChoices()).toEqual({ p1: [], p2: [] });

    const read = result.current.getChoices;
    act(() => result.current.setChoice('p1', firstMove(state, 'p1')));
    // The same function sees the pick although this render's closure was made before it.
    expect(read().p1[0]).toEqual(firstMove(state, 'p1'));
    expect(read().p2).toEqual([]);
    act(() => result.current.setChoice('p2', firstMove(state, 'p2')));
    await act(async () => { await result.current.executeTurn(); });
    expect(read()).toEqual({ p1: [], p2: [] });
  }, 60_000);

  test('stopBranch returns to the idle state', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    act(() => result.current.stopBranch());
    expect(result.current).toMatchObject({ branching: false, simState: null, history: [], variationStartTurn: null, startSerialized: null });
    expect(result.current.getBattle()).toBeNull();
  }, 60_000);

  // Round 77 (swarm D1): an edit that makes the first variation move illegal used to leave an empty variation behind.
  test('a rebuild that keeps no turn ends the branch and names what was lost', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    const outcome = await startWith(result, data, 2, [brokenEntry(2), brokenEntry(3), brokenEntry(4)]);
    expect(outcome).toEqual({ endedNotice: expect.stringMatching(/^The variation from turn 2 \(3 turns\) ended: .*Nosuch Move/) });
    expect(result.current).toMatchObject({ branching: false, simState: null, history: [], variationStartTurn: null, startSerialized: null, executeError: null });
    expect(result.current.getBattle()).toBeNull();
  }, 60_000);

  test('a rebuild that keeps a turn stays a shorter variation with the stop message', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    const state = result.current.simState!;
    act(() => {
      result.current.setChoice('p1', firstMove(state, 'p1'));
      result.current.setChoice('p2', firstMove(state, 'p2'));
    });
    await act(async () => { await result.current.executeTurn(); });
    const kept = result.current.history;
    expect(kept).toHaveLength(1);
    act(() => result.current.stopBranch());

    const outcome = await startWith(result, data, 2, [kept[0] as never, brokenEntry(3)]);
    expect(outcome?.endedNotice ?? null).toBeNull();
    expect(result.current.branching).toBe(true);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.executeError).toMatch(/^Rebuild stopped before branch turn 3: /);
  }, 60_000);

  test('doubles: a rebuild that keeps no turn ends the branch too', async () => {
    const data = fixture('doubles');
    const { result } = renderHook(() => useBranch());
    const outcome = await startWith(result, data, 1, [brokenEntry(1, 2)]);
    expect(outcome).toEqual({ endedNotice: expect.stringMatching(/^The variation from turn 1 \(1 turn\) ended: /) });
    expect(result.current).toMatchObject({ branching: false, history: [], variationStartTurn: null });
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

describe('useBranch-dice-lines', () => {
  function fixture(kind: ReplayKind) {
    const { replayData, snapshots, observations } = replayFixture(kind);
    const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
    return { replayData, snapshots, p1Team, p2Team };
  }

  async function startAt(result: { current: ReturnType<typeof useBranch> }, data: ReturnType<typeof fixture>, turn: number, replayHistory?: unknown[]) {
    const { replayData, snapshots, p1Team, p2Team } = data;
    await act(async () => {
      await result.current.startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, turn, snapshots[turn - 1] ?? null, {
        playerNames: [replayData.players[0], replayData.players[1]],
        snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
        ...(replayHistory ? { replayHistory: replayHistory as never } : {}),
      });
    });
  }

  const click = (state: NonNullable<ReturnType<typeof useBranch>['simState']>, side: 'p1' | 'p2', slot: number) => {
    const move = (side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot)[slot].find(option => !option.disabled)!;
    return { kind: 'move' as const, moveId: move.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: move.name };
  };

  const MESSAGE = '|-message|Forced';
  const CASES: { kind: ReplayKind; turn: number }[] = [{ kind: 'singles', turn: 2 }, { kind: 'doubles', turn: 1 }, { kind: 'vgc', turn: 1 }];

  describe.each(CASES)('the display lines of a forced die, $kind', ({ kind, turn }) => {
    /** One turn with a die on the first slot's move: `make` builds the die from the move's id. */
    async function playWith(make: (moveId: string) => ForcedDie) {
      const data = fixture(kind);
      const { result } = renderHook(() => useBranch());
      await startAt(result, data, turn);
      const before = result.current.simState!;
      const slots = before.p1MovesBySlot.length;
      const p1 = Array.from({ length: slots }, (_, slot) => click(before, 'p1', slot));
      const die = make(p1[0].moveId);
      act(() => {
        p1.forEach((choice, slot) => result.current.setChoice('p1', slot === 0 ? { ...choice, dice: [die] } : choice, slot));
        Array.from({ length: slots }, (_, slot) => result.current.setChoice('p2', click(before, 'p2', slot), slot));
      });
      await act(async () => { await result.current.executeTurn(); });
      expect(result.current.executeError).toBeNull();
      return { data, result, die };
    }

    const frameOf = (current: ReturnType<typeof useBranch>) => branchFrameLog(current.simState!.log, current.history.flatMap(entry => entry.dieLines ?? [])).split('\n');
    const accuracy = (moveId: string): ForcedDie => ({ name: { slot: 'p1a', moveId, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: false } });
    const never = (moveId: string): ForcedDie => ({ name: { slot: 'p1a', moveId, targetSlot: 'p2a', kind: 'secondary', effectId: 'zzz' }, result: { happens: true } });
    const tookOf = (current: ReturnType<typeof useBranch>): DieReport => current.history[0].diceReport!.forced[0];

    test('a die that took effect gets a line before the lines of its event, in the frame log only', async () => {
      const { result } = await playWith(accuracy);
      const entry = result.current.history[0];
      const log = result.current.simState!.log;
      expect(log.some(line => line.startsWith(MESSAGE))).toBe(false);
      if (tookOf(result.current).took !== 'applied') {
        // the move draws no miss here (a sure hit): the line says the die had no effect
        expect(entry.dieLines!.map(line => line.text)).toEqual([expect.stringMatching(/^Forced miss had no effect/)]);
        return;
      }
      expect(entry.dieLines).toHaveLength(1);
      const { at, text } = entry.dieLines![0];
      expect(text).toMatch(/^Forced: .+ misses, \d+(\.\d)? %$/);
      // the chance printed is the miss's own: the report holds the simulator's chance of the hit, the line names its complement
      expect(text.endsWith(`, ${Math.round((1 - tookOf(result.current).chance!) * 1000) / 10} %`)).toBe(true);
      // the line stands where the die decided: the next line of the shown log is the miss it caused
      expect(log[at].startsWith('|-miss|')).toBe(true);
      const frame = frameOf(result.current);
      expect(frame[frame.indexOf(`|-message|${text}`) + 1].startsWith('|-miss|')).toBe(true);
    }, 120_000);

    test('a die the simulator never draws says so at the end of the turn', async () => {
      const { result } = await playWith(never);
      expect(tookOf(result.current).took).toBe('no-draw');
      const lines = result.current.history[0].dieLines!;
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toMatch(/^Forced zzz had no effect: /);
      // Round 82, step A7c: the history row and the share link read the marks of the same report
      expect(result.current.history[0].diceMarks).toEqual({ p1: [{ label: expect.stringContaining('zzz'), noEffect: expect.any(String) }], p2: [] });
      const log = result.current.simState!.log;
      // before the end of the turn: the next shown line closes it
      expect(['upkeep', 'turn', 'win', 'tie']).toContain(log[lines[0].at]?.split('|')[1]);
      const frame = frameOf(result.current);
      expect(frame.filter(line => line.startsWith(MESSAGE))).toHaveLength(1);
    }, 120_000);

    test('a rebuild writes the same lines again', async () => {
      const { data, result } = await playWith(never);
      const recorded = result.current.history;
      const frame = frameOf(result.current).filter(line => !line.startsWith('|t:|'));
      act(() => result.current.stopBranch());
      await startAt(result, data, turn, recorded);
      expect(result.current.executeError).toBeNull();
      expect(result.current.history[0].dieLines!.map(line => line.text)).toEqual(recorded[0].dieLines!.map(line => line.text));
      expect(frameOf(result.current).filter(line => !line.startsWith('|t:|'))).toEqual(frame);
    }, 120_000);
  });

  describe('a turn without a forced die', () => {
    test('writes no line: the entry has no lines and the frame log is the shown log', async () => {
      const data = fixture('singles');
      const { result } = renderHook(() => useBranch());
      await startAt(result, data, 2);
      const before = result.current.simState!;
      act(() => {
        result.current.setChoice('p1', click(before, 'p1', 0));
        result.current.setChoice('p2', click(before, 'p2', 0));
      });
      await act(async () => { await result.current.executeTurn(); });
      expect('dieLines' in result.current.history[0]).toBe(false);
      expect(branchFrameLog(result.current.simState!.log, [])).toBe(branchFrameLog(result.current.simState!.log));
    }, 60_000);
  });
});

describe.each(SCENES)('a turn that pauses for a switch, $kind', scene => {
  const accuracy: ForcedDie = { name: { slot: 'p1a', moveId: 'voltswitch', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
  const burn: ForcedDie = { name: { slot: 'p2a', moveId: 'scald', targetSlot: 'p1a', kind: 'secondary', effectId: 'brn' }, result: { happens: true } };

  const start = (result: { current: ReturnType<typeof useBranch> }, replayHistory?: unknown[]) => act(async () => {
    await result.current.startBranch(scene.format, [...scene.p1], [...scene.p2], freshLog({ format: scene.format, p1: [...scene.p1], p2: [...scene.p2] }), 1, null, {
      playerNames: ['A', 'B'], ...(replayHistory ? { replayHistory: replayHistory as never } : {}),
    });
  });

  async function play() {
    const { result } = renderHook(() => useBranch());
    await start(result);
    expect(result.current.simState).not.toBeNull();
    act(() => {
      scene.p1Moves.forEach((choice, slot) => result.current.setChoice('p1', { kind: 'move', ...choice, ...(slot === 0 ? { dice: [accuracy] } : {}) }, slot));
      scene.p2Moves.forEach((choice, slot) => result.current.setChoice('p2', { kind: 'move', ...choice, ...(slot === 0 ? { dice: [burn] } : {}) }, slot));
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.executeError).toBeNull();
    expect(result.current.simState!.p1ForceSwitch).toBe(true);
    // the lone side that must replace executes as soon as its choice is in (a forced interlude entry)
    await act(async () => { result.current.setChoice('p1', { kind: 'switch', speciesId: scene.replacement, pokemonName: scene.replacement }, 0); });
    await waitFor(() => expect(result.current.history).toHaveLength(2));
    expect(result.current.executeError).toBeNull();
    return Object.assign(result.current, { restart: async (history: unknown[]) => { act(() => result.current.stopBranch()); await start(result, history); return result.current; } });
  }

  const forcedLines = (current: Awaited<ReturnType<typeof play>>) =>
    branchFrameLog(current.simState!.log, current.history.flatMap(entry => entry.dieLines ?? [])).split('\n').filter(line => line.startsWith('|-message|'));

  test('the two entries write each line once, and the turn entry writes no line for the die it never reached', async () => {
    const current = await play();
    expect(current.history.map(entry => entry.kind ?? 'turn')).toEqual(['turn', 'forced']);
    const [turn, forced] = current.history;
    expect(forced.diceReport!.forced.map(report => [report.die.name.kind, report.took])).toEqual([['accuracy', 'applied'], ['secondary', 'applied']]);
    expect(turn.diceReport!.forced.find(report => report.die.name.kind === 'secondary')!.took).toBe('no-draw');
    const lines = forcedLines(current);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\|-message\|Forced: Volt Switch hits/);
    expect(lines[1]).toMatch(/^\|-message\|Forced: Scald burn, \d+(\.\d)? %$/);
    expect(lines.some(line => line.includes('had no effect'))).toBe(false);
  }, 180_000);

  test('the row of the turn reads the joined report once: both dice, none marked as without effect', async () => {
    const current = await play();
    const marks = turnDiceMarks(current.history, 0)!;
    expect(marks).toBe(current.history[1].diceMarks);
    expect(sideMarkTexts(marks, 'p1')).toEqual(['Volt Switch: hits']);
    expect(sideMarkTexts(marks, 'p2')).toEqual(['Scald: burn']);
    expect(turnDiceMarks(current.history, 1)).toBeUndefined();
  }, 180_000);

  test('a rebuild writes the same marks and the same lines again', async () => {
    const first = await play();
    const recorded = first.history;
    const lines = forcedLines(first);
    const again = await first.restart(recorded);
    expect(again.executeError).toBeNull();
    expect(again.history.map(entry => entry.diceMarks)).toEqual(recorded.map(entry => entry.diceMarks));
    expect(forcedLines(again)).toEqual(lines);
  }, 180_000);

  // Round 82, step A7c, criterion 4: a link written from this branch shows the marks. The viewer plays `finalLog` without a
  // simulator, so the display lines must be in it, and the turn's choice carries the labels of both dice once.
  test('a share link carries the display lines in its log and the labels of both dice on the turn, and the viewer shows them', async () => {
    const current = await play();
    const finalLog = branchFrameLog(current.simState!.log, current.history.flatMap(entry => entry.dieLines ?? []));
    const replay = { id: 'gen9test-1', format: scene.format, formatid: scene.format, players: ['A', 'B'], log: '', uploadtime: 0, views: 0 };
    const payload = decodeBranchShare(encodeBranchShare(makeBranchSharePayload({ replay, branchTurn: 1, history: current.history, finalLog })));
    expect(payload.version).toBe(1);
    expect(payload.finalLog.split('\n').filter(line => line.startsWith('|-message|Forced'))).toHaveLength(2);
    expect(payload.choices.map(choice => [choice.p1DiceLabels, choice.p2DiceLabels])).toEqual([[['Volt Switch: hits'], ['Scald: burn']], [undefined, undefined]]);

    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test/dice'; }), revokeObjectURL: vi.fn() }));
    try {
      render(<SharedBranchView branch={payload} onLoadOriginal={vi.fn()} onClear={vi.fn()} />);
      const html = await blobs[0].text();
      expect(html).toContain('|-message|Forced: Volt Switch hits');
      expect(html).toContain('|-message|Forced: Scald burn');
      expect(screen.getByRole('group', { name: 'Forced dice, turn 1' })).toHaveTextContent('P1 Volt Switch: hitsP2 Scald: burn');
    } finally {
      vi.unstubAllGlobals();
    }
  }, 180_000);
});
