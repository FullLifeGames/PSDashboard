import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { usePositionSource } from '../../../src/hooks/usePositionSource';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import { gameReplayData, appendTurn, type NewGameRecord } from '../../../src/lib/new-game/record';
import { rebuildGame } from '../../../src/hooks/branch/game-rebuild';
import * as branchEngine from '../../../src/lib/lazy/branch-engine';
import type { BranchHistoryEntry } from '../../../src/lib/branch-history';
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
async function twoTurnGame(): Promise<NewGameRecord> {
  const start = await startedRecord('gen9ou');
  const entries = [
    entry(0, { leadChoices: { p1: ['Snorlax'], p2: ['Snorlax'] } }),
    entry(1, { kind: 'turn', p1SlotChoices: [move('Protect')], p2SlotChoices: [move('Protect')] }),
    entry(2, { kind: 'turn', p1SlotChoices: [move('Substitute')], p2SlotChoices: [move('Protect')] }),
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
});
