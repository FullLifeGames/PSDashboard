import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getBranchSimulatorFormat, parseReplayLogWithObservations, type ReplayData } from '@fulllifegames/replay-core';
import { usePositionSource } from '../../../src/hooks/usePositionSource';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import type { ReconstructOutcome } from '../../../src/lib/replay-jobs/types';
import { fakeReplayWorkerClient } from '../fixtures/worker';

/**
 * Round 67 (T145): the branch view adopts a worker's position on the main thread (usePositionSource), which loads
 * the Champions mod first for a Champions replay. In a module graph of its own (vitest isolates files) and with a
 * stored position, so no reconstruction in this realm loads the mod for it. The turn-0 preview has its own file.
 */
const fixture = <T,>(name: string) =>
  JSON.parse(readFileSync(join('packages', 'eval-engine', 'test', 'fixtures', 'champions', name), 'utf-8')) as T;
const replay = fixture<{ id: string; format: string; formatid: string; players: string[]; log: string }>('gen9championsou-2693832490.json');
const replayData: ReplayData = { ...replay, uploadtime: 0, views: 0 };
const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
const stored = fixture<{ serialized: string }>('gen9championsou-2693832490-t3.position.json').serialized;

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

const outcome = (serialized: string): ReconstructOutcome => ({
  serialized, log: [], invalid: null, reached: true, ended: false, turn: 3, timedOut: false, haxAlignment: [], choiceErrors: { count: 0, last: null },
});

describe('the main thread loads the Champions mod before a Champions battle (T145)', () => {
  test('the branch view adopts a worker\'s Champions position on the Champions mod', async () => {
    const { client } = fakeReplayWorkerClient(request => (request.type === 'reconstruct'
      ? [{ type: 'reconstructResult', id: request.id, outcome: outcome(stored) }]
      : []));
    const { result } = renderHook(() => usePositionSource({
      replayData, snapshots, observations, sources, setsFingerprint: 'fp1', bringOnlyLists: null, smogonPending: false, replayWorker: client,
    }));
    const params = { format: getBranchSimulatorFormat(replayData), p1Team: [], p2Team: [], replayLog: replay.log, targetTurn: 3, snapshot: snapshots[2] ?? null };
    const runtime = await result.current.acquireRuntime(params, { isT0: false });
    expect(runtime.battleStream.battle?.dex.currentMod).toBe('champions');
  }, 60_000);
});
