import { describe, expect, test } from 'vitest';
import { replayFixture } from './replay';
import { simState } from './sim-state';
import { evalGraph, evalResult, gameReport } from './eval-result';
import { teamInfo } from './team-info';
import { fakeReplayWorkerClient, installFakeWorker } from './worker';

// The factories behind the app suite: every call returns a fresh object, both
// formats are covered, and the two worker fakes answer through the real clients.
describe('fixture factories', () => {
  test('replays parse into snapshots for every format', () => {
    expect(replayFixture('singles').snapshots.length).toBeGreaterThan(1);
    expect(replayFixture('doubles').replayData.formatid).toBe('gen9doublesou');
    expect(replayFixture('vgc').replayData.formatid).toBe('gen9vgc2026regi');
    expect(replayFixture('singles').replayData).not.toBe(replayFixture('singles').replayData);
  });

  test('sim states carry one active slot in singles and two in doubles, with targets only in doubles', () => {
    const singles = simState('singles');
    const doubles = simState('doubles');
    expect(singles.p1ActiveSlots).toHaveLength(1);
    expect(singles.p1MovesBySlot[0].every(move => move.targetOptions.length === 0)).toBe(true);
    expect(doubles.p1ActiveSlots).toHaveLength(2);
    expect(doubles.p1MovesBySlot[1][0]).toMatchObject({ name: 'Spore', activeSlot: 1 });
    expect(doubles.p1MovesBySlot[0][1].targetOptions.map(target => target.species)).toEqual(['Rillaboom', 'Tornadus']);
    expect(simState('singles', { ended: true }).ended).toBe(true);
  });

  test('evaluation results rank both sides and the graph covers ten turns', () => {
    const result = evalResult('doubles');
    expect(result.perSide.p1.length).toBeGreaterThan(0);
    expect(result.matrix?.values).toHaveLength(result.perSide.p1.length);
    expect(evalResult('singles').perSide.p1[0].koOdds).toEqual({ accuracy: 1, killFraction: 0.43 });
    expect(evalGraph().scores).toHaveLength(10);
    expect(gameReport({ winner: 'p2' }).winner).toBe('p2');
  });

  test('team info offers six revealed species in singles and four in doubles', () => {
    expect(teamInfo('singles', 'p1').pokemon).toHaveLength(6);
    expect(teamInfo('doubles', 'p2').pokemon.map(mon => mon.species)).toEqual(['Rillaboom', 'Tornadus', 'Kingambit', 'Ogerpon']);
    expect(teamInfo().pokemon[0].moves.map(move => move.source)).toEqual(['revealed', 'guessed']);
  });

  test('the fake evaluation worker answers through the global Worker', async () => {
    const Fake = installFakeWorker(request => (request.type === 'search'
      ? [{ type: 'result', id: request.id, result: evalResult() }]
      : []));
    const worker = new Worker('eval-worker.ts');
    const answer = new Promise(resolve => { worker.onmessage = event => resolve(event.data); });
    worker.postMessage({ type: 'search', id: 7, serializedBattle: '{}', settings: { depth: 1, samples: 1 } });
    await expect(answer).resolves.toMatchObject({ type: 'result', id: 7 });
    expect(Fake.instances).toHaveLength(1);
    expect(Fake.requests).toHaveLength(1);
  });

  test('the fake replay worker client resolves a reconstruction with the scripted outcome', async () => {
    const outcome = {
      serialized: '{"turn":3}', log: [], invalid: null, reached: true, ended: false, turn: 3, timedOut: false,
      haxAlignment: [], choiceErrors: { count: 0, last: null },
    };
    const { client, requests, spawnCount } = fakeReplayWorkerClient(request => (request.type === 'reconstruct'
      ? [{ type: 'replayProgress', id: request.id, turn: 1, target: 3 }, { type: 'reconstructResult', id: request.id, outcome }]
      : []));
    const progress: number[] = [];
    const { snapshots, observations, replayData } = replayFixture('singles');
    const result = await client.reconstruct(
      { format: 'gen9ou', p1Team: [], p2Team: [], replayLog: replayData.log, targetTurn: 3, snapshots, observations, mode: 'replay' },
      { onProgress: turn => progress.push(turn) },
    );
    expect(result.turn).toBe(3);
    expect(progress).toEqual([1]);
    expect(requests).toHaveLength(1);
    expect(spawnCount()).toBe(1);
  });
});
