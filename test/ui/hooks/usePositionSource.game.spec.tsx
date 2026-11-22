import { describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { usePositionSource } from '../../../src/hooks/usePositionSource';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import { gameReplayData, appendTurn, type NewGameRecord } from '../../../src/lib/new-game/record';
import { rebuildGame } from '../../../src/hooks/branch/game-rebuild';
import * as branchEngine from '../../../src/lib/lazy/branch-engine';
import type { BranchHistoryEntry } from '../../../src/lib/branch-history';
import { coverageNotice } from '../../../src/hooks/evaluation/sweep-positions';
import { fakeReplayWorkerClient } from '../fixtures/worker';
import { startedRecord } from '../fixtures/new-game';

/**
 * Round 89 (lane H, #105), stage H3: the position source of a new game. Its positions are the record's: a miss in the exact store
 * is rebuilt once from the record's entries, which stores every main-line position, and the replay worker never receives a job.
 */

const entry = (turnNumber: number, extra: Partial<BranchHistoryEntry>): BranchHistoryEntry => ({
  turnNumber, p1Choice: '', p2Choice: '', p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], ...extra,
});
const move = (name: string) => ({ kind: 'move' as const, moveId: name.toLowerCase(), moveName: name });

/** A game of two played turns, as a saved record holds it: entries without positions, lines from a rebuild. */
async function twoTurnGame(format = 'gen9ou'): Promise<NewGameRecord> {
  const start = await startedRecord(format);
  // a doubles format plays two slots a side; the VGC game brings four of its six and leads two of them
  const doubles = format !== 'gen9ou';
  const slots = (name: string) => (doubles ? [move(name), move(name)] : [move(name)]);
  const lead = doubles
    ? { p1: ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar'], p2: ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar'], bring: true }
    : { p1: ['Snorlax'], p2: ['Snorlax'] };
  const entries = [
    entry(0, { leadChoices: lead }),
    entry(1, { kind: 'turn', p1SlotChoices: slots('Protect'), p2SlotChoices: slots('Protect') }),
    entry(2, { kind: 'turn', p1SlotChoices: slots('Substitute'), p2SlotChoices: slots('Protect') }),
  ];
  const rebuilt = await rebuildGame(branchEngine, { ...start, entries });
  if (!rebuilt || rebuilt.failure) throw new Error('the fixture game does not play');
  const { bodyLines } = await import('../../../src/lib/new-game/game-log');
  return appendTurn({ ...start, entries: [] }, { entries: rebuilt.entries, lines: bodyLines(rebuilt.runtime.log) });
}

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

describe('usePositionSource for a new game', () => {
  test('a position the store lacks is rebuilt from the record, every turn lands in the store, and no replay job goes out', async () => {
    const record = await twoTurnGame();
    const data = gameReplayData(record);
    const snapshots = parseReplayLog(data.log);
    const { client, requests } = fakeReplayWorkerClient(() => []);
    const { result } = renderHook(() => usePositionSource({
      replayData: data, snapshots, observations: [], sources, setsFingerprint: 'fp1', bringOnlyLists: null, smogonPending: true,
      replayWorker: client, gameRecord: record,
    }));
    expect(result.current.getExact(2)).toBeNull();
    const position = await result.current.acquireExact(2, () => {});
    expect(position).toContain('"turn":2');
    for (const turn of [1, 2, 3]) expect(result.current.getExact(turn)).not.toBeNull();
    expect(requests).toEqual([]);
  });

  test('the sweep reads the stored positions and the branch start adopts the tip position as stored, with the game PRNG', async () => {
    const record = await twoTurnGame();
    const data = gameReplayData(record);
    const snapshots = parseReplayLog(data.log);
    const { client, requests } = fakeReplayWorkerClient(() => []);
    const { result } = renderHook(() => usePositionSource({
      replayData: data, snapshots, observations: [], sources, setsFingerprint: 'fp1', bringOnlyLists: null, smogonPending: false,
      replayWorker: client, gameRecord: record,
    }));
    const all = await result.current.acquireAll(2, () => {});
    expect(all.every(position => position !== null)).toBe(true);
    const tip = result.current.getExact(3)!;
    const runtime = await result.current.acquireRuntime({
      format: 'gen9ou', p1Team: record.teams.p1, p2Team: record.teams.p2, replayLog: data.log, targetTurn: 3, snapshot: snapshots[2],
    }, { isT0: false });
    const stored = JSON.parse(tip) as { prngSeed?: string };
    const adopted = JSON.parse(branchEngine.captureSerializedPosition(runtime.battleStream.battle)!) as { prngSeed?: string };
    expect(adopted.prngSeed).toBe(stored.prngSeed);
    expect(requests).toEqual([]);
  });

  /** The hook over one record with a mutable sets fingerprint, the way `useExactPositions` swaps its store on a new identity. */
  function sourceOf(record: NewGameRecord) {
    const data = gameReplayData(record);
    const snapshots = parseReplayLog(data.log);
    const { client, requests } = fakeReplayWorkerClient(() => []);
    const view = renderHook(({ fp }) => usePositionSource({
      replayData: data, snapshots, observations: [], sources, setsFingerprint: fp, bringOnlyLists: null, smogonPending: false,
      replayWorker: client, gameRecord: record,
    }), { initialProps: { fp: 'fp1' } });
    return { ...view, requests };
  }

  for (const format of ['gen9ou', 'gen9vgc2025regi']) {
    test(`${format}: the store swaps to an empty one (a new sets fingerprint) and Analyze game still gets every turn, with no notice (NG-1 B)`, async () => {
      const record = await twoTurnGame(format);
      const { result, rerender, requests } = sourceOf(record);
      await result.current.acquireExact(3, () => {});
      expect((await result.current.acquireAll(2, () => {})).every(Boolean)).toBe(true);
      rerender({ fp: 'fp2' });
      expect(result.current.getExact(1)).toBeNull();
      const after = await result.current.acquireAll(2, () => {});
      expect(after.map(Boolean)).toEqual([true, true]);
      expect(coverageNotice(after, { game: true })).toBeNull();
      for (const turn of [1, 2, 3]) expect(result.current.getExact(turn)).not.toBeNull();
      expect(requests).toEqual([]);
    }, 120_000);
  }

  test('a rebuild that failed is tried again, not remembered: the second Analyze game gets its positions', async () => {
    const record = await twoTurnGame();
    const { result } = sourceOf(record);
    const loader = vi.spyOn(branchEngine, 'loadSimMods').mockRejectedValueOnce(new Error('the simulator did not load'));
    try {
      expect(await result.current.acquireAll(2, () => {})).toEqual([null, null]);
      expect(loader).toHaveBeenCalledTimes(1);
      const second = await result.current.acquireAll(2, () => {});
      expect(second.map(Boolean)).toEqual([true, true]);
    } finally {
      loader.mockRestore();
    }
  }, 120_000);

  test('one Analyze game rebuilds at most once, even when every turn misses', async () => {
    const record = await twoTurnGame();
    const { result } = sourceOf(record);
    const loader = vi.spyOn(branchEngine, 'loadSimMods').mockRejectedValue(new Error('the simulator did not load'));
    try {
      expect(await result.current.acquireAll(2, () => {})).toEqual([null, null]);
      expect(loader).toHaveBeenCalledTimes(1);
    } finally {
      loader.mockRestore();
    }
  }, 120_000);
});
