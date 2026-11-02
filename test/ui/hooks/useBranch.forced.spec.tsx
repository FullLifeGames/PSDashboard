import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBranch } from '../../../src/hooks/useBranch';
import { freshLog, setOf } from '../fixtures/dice-battle';

const mon = (species: string, moves: string[]) => setOf(species, moves, { level: 50 });

/**
 * Round 84 (turn dock), step A7a, ruling 2a: a forced replacement the engine filled waits for Execute. The branch records a pick
 * without its follow-ups (`recordChoice`: no command is sent although the replacing side is complete), and `executePending`
 * sends the forced replacement the dock holds, or the turn when no replacement is open. A bench click (`setChoice`) still sends
 * at once, as before. Singles and doubles, on the pivot scenes of `useBranch-dice-pause.spec.tsx` (a Volt Switch pauses the turn
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
