import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ForcedDie } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { turnDiceMarks, sideMarkTexts } from '../../../src/lib/branch-dice-marks';
import { freshLog, setOf } from '../fixtures/dice-battle';

const mon = (species: string, moves: string[]) => setOf(species, moves, { level: 50 });

/**
 * Round 82 (forced dice), step A7c: a turn that pauses for a switch (a pivot move) is two history entries, the turn and the
 * forced replacement that finishes it. The frame log holds each display line of the turn's dice once, the history row reads
 * the joined report once, and the turn entry's partial report (the die of the body that acts after the pivot, not reached
 * yet) writes no "had no effect" line. Singles and doubles (VGC plays the same hooks: the pause is a rule of the format's
 * simulator, and the VGC scenes of `useBranch-dice-lines.spec.tsx` hold the lines of a turn that does not pause).
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
    expect(sideMarkTexts(marks, 'p2')).toEqual(['Scald: Burn']);
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
});
