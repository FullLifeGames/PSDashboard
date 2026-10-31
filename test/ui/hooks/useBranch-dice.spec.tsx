import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import type { ForcedDie } from '@fulllifegames/eval-engine';
import { useBranch } from '../../../src/hooks/useBranch';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

/**
 * Round 82 (forced dice), step A6, item 5 (ADR 0001): a forced die rides on the slot choice. The turn plays through the dice
 * module, the history entry keeps the choice with its dice and the report of the user's dice, and a rebuild (a team edit, a
 * support state) replays the forced dice and reaches the same turn. Singles, doubles and VGC.
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

const withoutClock = (lines: string[]) => lines.filter(line => !line.startsWith('|t:|'));
const CASES: { kind: ReplayKind; turn: number }[] = [{ kind: 'singles', turn: 2 }, { kind: 'doubles', turn: 1 }, { kind: 'vgc', turn: 1 }];

describe.each(CASES)('a forced die through the branch hook, $kind', ({ kind, turn }) => {
  async function playWithDie() {
    const data = fixture(kind);
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, turn);
    const before = result.current.simState!;
    const slots = before.p1MovesBySlot.length;
    const p1 = Array.from({ length: slots }, (_, slot) => click(before, 'p1', slot));
    const die: ForcedDie = { name: { slot: 'p1a', moveId: p1[0].moveId, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: false } };
    act(() => {
      p1.forEach((choice, slot) => result.current.setChoice('p1', slot === 0 ? { ...choice, dice: [die] } : choice, slot));
      Array.from({ length: slots }, (_, slot) => result.current.setChoice('p2', click(before, 'p2', slot), slot));
    });
    await act(async () => { await result.current.executeTurn(); });
    return { data, result, die, before };
  }

  test('the history entry keeps the dice on its choice and the report of the user\'s dice', async () => {
    const { result, die } = await playWithDie();
    expect(result.current.executeError).toBeNull();
    expect(result.current.history).toHaveLength(1);
    const entry = result.current.history[0];
    expect(entry.p1SlotChoices![0]).toMatchObject({ dice: [die] });
    expect(entry.p1SlotChoices!.slice(1).every(choice => choice === null || !('dice' in choice))).toBe(true);
    expect(entry.diceReport?.forced.map(report => report.die)).toEqual([die]);
    expect(['applied', 'no-draw', 'no-chance', 'blocked']).toContain(entry.diceReport!.forced[0].took);
  }, 120_000);

  test('a rebuild replays the forced dice: the same choices, the same report, the same lines', async () => {
    const { data, result } = await playWithDie();
    const recorded = result.current.history;
    expect(recorded[0].diceReport).toBeDefined();
    const log = withoutClock(result.current.simState!.log);
    act(() => result.current.stopBranch());
    await startAt(result, data, turn, recorded);
    expect(result.current.executeError).toBeNull();
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].p1SlotChoices).toEqual(recorded[0].p1SlotChoices);
    expect(result.current.history[0].diceReport).toEqual(recorded[0].diceReport);
    expect(withoutClock(result.current.simState!.log)).toEqual(log);
  }, 120_000);
});

describe('a turn without a forced die', () => {
  test('keeps today\'s history entry: no report, the choices as clicked', async () => {
    const data = fixture('singles');
    const { result } = renderHook(() => useBranch());
    await startAt(result, data, 2);
    const before = result.current.simState!;
    act(() => {
      result.current.setChoice('p1', click(before, 'p1', 0));
      result.current.setChoice('p2', click(before, 'p2', 0));
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.history[0].p1SlotChoices).toEqual([click(before, 'p1', 0)]);
    expect('diceReport' in result.current.history[0]).toBe(false);
  }, 60_000);
});
