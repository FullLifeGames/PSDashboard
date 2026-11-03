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
