import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat, replayRules } from '@fulllifegames/replay-core';
import { useBranch } from '../../../src/hooks/useBranch';
import type { Bench } from '../../../src/lib/bench';
import { replayFixture, type ReplayKind } from '../fixtures/replay';

/**
 * Round 88 (T314, #55): the live What-if offers only the bench the bring allows. The battle keeps the whole team (the engine's
 * ranked choices and the play-out still reach every body, option (c) of round 89); the state the pickers read is filtered.
 */

async function started(kind: ReplayKind, bench: (open: { p2: string[] }) => Bench | null) {
  const { replayData, snapshots, observations } = replayFixture(kind);
  const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
  const turn = 2;
  const start = (hook: { current: ReturnType<typeof useBranch> }) => act(async () => {
    await hook.current.startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, turn, snapshots[turn - 1] ?? null, {
      playerNames: [replayData.players[0], replayData.players[1]],
      snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
    });
  });
  // The whole team first, to name what the battle offers.
  const whole = renderHook(() => useBranch());
  await start(whole.result);
  const offered = [...new Set(whole.result.current.simState!.p2SwitchesBySlot.flat().map(option => option.species))];
  const limited = bench({ p2: offered });
  const filtered = renderHook(() => useBranch(limited));
  await start(filtered.result);
  return { whole: whole.result, filtered: filtered.result, offered, limited, rules: replayRules(replayData) };
}

describe.each([['singles' as const], ['doubles' as const]])('useBranch with a bench, %s', (kind) => {
  test('the state offers only the brought bodies of a limited side and leaves the other side whole', async () => {
    const run = await started(kind, open => ({ lists: { p1: [], p2: open.p2.slice(0, 1) }, rules: replayRules(replayFixture(kind).replayData) }));
    expect(run.offered.length).toBeGreaterThan(1);
    const state = run.filtered.current.simState!;
    expect([...new Set(state.p2SwitchesBySlot.flat().map(option => option.species))]).toEqual(run.offered.slice(0, 1));
    expect(state.p2Switches.map(option => option.species)).toEqual(run.offered.slice(0, 1));
    expect(state.p1SwitchesBySlot).toEqual(run.whole.current.simState!.p1SwitchesBySlot);
    // The battle itself still holds every body.
    expect(run.filtered.current.getBattle()?.sides[1].pokemon.length).toBe(run.whole.current.getBattle()?.sides[1].pokemon.length);
  }, 60_000);

  test('no bench leaves the state as the simulator gave it', async () => {
    const run = await started(kind, () => null);
    expect(run.filtered.current.simState!.p2SwitchesBySlot).toEqual(run.whole.current.simState!.p2SwitchesBySlot);
  }, 60_000);

  test('the filter holds after a turn ran', async () => {
    const run = await started(kind, open => ({ lists: { p1: [], p2: open.p2.slice(0, 1) }, rules: replayRules(replayFixture(kind).replayData) }));
    const result = run.filtered;
    const slots = kind === 'doubles' ? 2 : 1;
    const move = (side: 'p1' | 'p2', slot: number) => {
      const option = (side === 'p1' ? result.current.simState!.p1MovesBySlot : result.current.simState!.p2MovesBySlot)[slot].find(entry => !entry.disabled)!;
      return { kind: 'move' as const, moveId: option.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: option.name };
    };
    for (let slot = 0; slot < slots; slot += 1) {
      act(() => result.current.setChoice('p1', move('p1', slot), slot));
      act(() => result.current.setChoice('p2', move('p2', slot), slot));
    }
    await act(async () => { await result.current.executeTurn(); });
    const after = result.current.simState!;
    const alive = new Set(after.p2SwitchesBySlot.flat().map(option => option.species));
    for (const species of alive) expect(run.offered.slice(0, 1)).toContain(species);
  }, 60_000);
});
