import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import type { DieReport, ForcedDie } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

/**
 * Round 82 (forced dice), step A7b, decision 6a: the display lines of a turn's forced dice. The history entry of the turn keeps
 * them (placed in the shown log), the frame log carries them as message lines, the battle's own log never does, and a rebuild
 * writes the same lines again. Singles, doubles and VGC.
 */

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
