import { test, expect, describe } from 'vitest';
import { readFileSync } from 'fs';
import { buildTeamsFromReplay, solveReplaySpreads, parseReplayLogWithObservations, getBranchSimulatorFormat, type ReplayData } from '@fulllifegames/replay-core';
import { serializeLiveBattle } from '@fulllifegames/eval-engine';
import { reconstructReplayRuntime } from '../src/lib/eval-acquire';
import { handleReplayJob } from '../src/lib/replay-jobs/handlers';
import type { ReplayJobResponse } from '../src/lib/replay-jobs/types';

/**
 * The replay jobs are the SAME computation the main thread ran, moved into
 * a worker (round 38): the worker handler must hand out the byte-identical
 * positions and the identical solved spreads — otherwise the exact-position
 * store, the eval cache, and the feedback corpus would silently drift.
 */
const TARGET = 20;

function loadDraftReplay(): ReplayData {
  return JSON.parse(readFileSync('e2e/fixtures/draft-replay.json', 'utf-8')) as ReplayData;
}

describe('replay jobs in the worker', () => {
  test('reconstruct hands out the same positions, log, and verdicts as the main-thread path', { timeout: 300000 }, async () => {
    const replay = loadDraftReplay();
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const format = getBranchSimulatorFormat(replay);

    const direct = new Map<number, string>();
    const { runtime, branchEngine } = await reconstructReplayRuntime({
      replayData: replay, p1Team, p2Team, targetTurn: TARGET, snapshots, observations,
      onProgress: () => {},
      onPosition: (turn, battle) => direct.set(turn, serializeLiveBattle(battle)),
    });
    const directBattle = runtime.battleStream.battle!;
    const directFinal = serializeLiveBattle(directBattle);

    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'reconstruct', id: 7,
      job: { format, p1Team, p2Team, replayLog: replay.log, targetTurn: TARGET, snapshots, observations, mode: 'replay',
        playerNames: [replay.players[0], replay.players[1]] },
    }, response => responses.push(response));

    const positions = responses.filter(response => response.type === 'replayPosition');
    expect(positions.map(position => position.turn)).toEqual([...direct.keys()]);
    for (const position of positions) expect(position.serialized).toBe(direct.get(position.turn));

    const result = responses.find(response => response.type === 'reconstructResult');
    expect(result?.type).toBe('reconstructResult');
    if (result?.type !== 'reconstructResult') return;
    expect(result.outcome.serialized).toBe(directFinal);
    expect(result.outcome.log).toEqual(runtime.log);
    expect(result.outcome.reached).toBe(branchEngine.reconstructionReached(runtime, TARGET));
    expect(result.outcome.invalid).toBe(branchEngine.validateBranchRuntime(runtime));
    expect(result.outcome.turn).toBe(directBattle.turn);
    expect(result.outcome.ended).toBe(directBattle.ended);
    expect(result.outcome.haxAlignment).toEqual(runtime.haxAlignment);
    expect(responses.some(response => response.type === 'replayProgress')).toBe(true);
    expect(responses.some(response => response.type === 'replayError')).toBe(false);
  });

  test('solveSpreads hands out the same map as solveReplaySpreads', { timeout: 120000 }, async () => {
    const replay = loadDraftReplay();
    const { observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const direct = solveReplaySpreads(replay.log, observations, { speedOrders });
    expect(direct.size).toBeGreaterThan(0);

    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'solveSpreads', id: 3,
      job: { log: replay.log, observations, speedOrders, p1Info: null, p2Info: null, usageStats: null, setAssumptions: null },
    }, response => responses.push(response));
    const result = responses[0];
    expect(result.type).toBe('solveSpreadsResult');
    if (result.type !== 'solveSpreadsResult') return;
    expect(result.entries).toEqual([...direct.entries()]);
  });

  test('a failing job answers with an error message instead of throwing', async () => {
    const responses: ReplayJobResponse[] = [];
    await handleReplayJob({
      type: 'reconstruct', id: 9,
      job: { format: 'gen9ou', p1Team: [], p2Team: [], replayLog: '', targetTurn: 1, snapshots: [], observations: [], mode: 'replay' },
    }, response => responses.push(response));
    const last = responses[responses.length - 1];
    expect(last.type === 'replayError' || last.type === 'reconstructResult').toBe(true);
  });
});
