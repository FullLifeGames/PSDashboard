import { test, expect } from '@playwright/test';
import { ReplayWorkerClient, type WorkerLike } from '../src/lib/replay-jobs/client';
import type { ReconstructJob, ReconstructOutcome, ReplayJobRequest, ReplayJobResponse, SolveSpreadsJob } from '../src/lib/replay-jobs/types';

/** A worker stand-in: records what the client posts, lets the test answer. */
class FakeWorker implements WorkerLike {
  posted: ReplayJobRequest[] = [];
  terminated = false;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  postMessage(message: ReplayJobRequest) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(response: ReplayJobResponse) {
    this.onmessage?.({ data: response });
  }
  crash(message: string) {
    this.onerror?.({ message });
  }
}

function makeClient() {
  const workers: FakeWorker[] = [];
  const client = new ReplayWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}

const reconstructJob = (targetTurn = 5): ReconstructJob => ({
  format: 'gen9ou', p1Team: [], p2Team: [], replayLog: '', targetTurn, snapshots: [], observations: [], mode: 'replay',
});
const solveJob: SolveSpreadsJob = {
  log: '', observations: [], speedOrders: [], p1Info: null, p2Info: null, usageStats: null, setAssumptions: null,
};
const outcome = (turn: number): ReconstructOutcome => ({
  serialized: `position-${turn}`, log: ['|turn|1'], invalid: null, reached: true, ended: false, turn,
  timedOut: false, haxAlignment: [], choiceErrors: { count: 0, last: null },
});
const idOf = (request: ReplayJobRequest) => request.id;

test.describe('ReplayWorkerClient', () => {
  test('routes a reconstruct job, streams progress and positions, resolves the outcome', async () => {
    const { client, workers } = makeClient();
    const progress: [number, number][] = [];
    const positions: [number, string][] = [];
    const promise = client.reconstruct(reconstructJob(5), {
      onProgress: (turn, target) => progress.push([turn, target]),
      onPosition: (turn, serialized) => positions.push([turn, serialized]),
    });
    expect(workers).toHaveLength(1);
    const [worker] = workers;
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0].type).toBe('reconstruct');
    const id = idOf(worker.posted[0]);
    worker.emit({ type: 'replayProgress', id, turn: 1, target: 5 });
    worker.emit({ type: 'replayPosition', id, turn: 1, serialized: 'p1' });
    worker.emit({ type: 'replayPosition', id, turn: 2, serialized: 'p2' });
    worker.emit({ type: 'reconstructResult', id, outcome: outcome(5) });
    const result = await promise;
    expect(result.serialized).toBe('position-5');
    expect(progress).toEqual([[1, 5]]);
    expect(positions).toEqual([[1, 'p1'], [2, 'p2']]);
    expect(worker.terminated).toBe(false);
  });

  test('solveSpreads resolves the entries as a Map', async () => {
    const { client, workers } = makeClient();
    const promise = client.solveSpreads(solveJob);
    const [worker] = workers;
    expect(worker.posted[0].type).toBe('solveSpreads');
    worker.emit({
      type: 'solveSpreadsResult', id: idOf(worker.posted[0]),
      entries: [['p1:garchomp', { nature: 'Jolly', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 } }]],
    });
    const solved = await promise;
    expect(solved.get('p1:garchomp')?.nature).toBe('Jolly');
  });

  test('jobs run one after another on one worker', async () => {
    const { client, workers } = makeClient();
    const first = client.reconstruct(reconstructJob(3));
    const second = client.reconstruct(reconstructJob(4));
    const [worker] = workers;
    expect(worker.posted).toHaveLength(1);
    worker.emit({ type: 'reconstructResult', id: idOf(worker.posted[0]), outcome: outcome(3) });
    expect((await first).turn).toBe(3);
    expect(worker.posted).toHaveLength(2);
    expect(workers).toHaveLength(1);
    worker.emit({ type: 'reconstructResult', id: idOf(worker.posted[1]), outcome: outcome(4) });
    expect((await second).turn).toBe(4);
  });

  test('a response for another job id is ignored', async () => {
    const { client, workers } = makeClient();
    const promise = client.reconstruct(reconstructJob(2));
    const [worker] = workers;
    const id = idOf(worker.posted[0]);
    worker.emit({ type: 'reconstructResult', id: id + 100, outcome: outcome(99) });
    worker.emit({ type: 'reconstructResult', id, outcome: outcome(2) });
    expect((await promise).turn).toBe(2);
  });

  test('aborting the running job terminates the worker; the next job gets a fresh one', async () => {
    const { client, workers } = makeClient();
    const controller = new AbortController();
    const promise = client.reconstruct(reconstructJob(9), {}, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
    expect(workers[0].terminated).toBe(true);
    const next = client.reconstruct(reconstructJob(1));
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);
    workers[1].emit({ type: 'reconstructResult', id: idOf(workers[1].posted[0]), outcome: outcome(1) });
    expect((await next).turn).toBe(1);
  });

  test('aborting a queued job drops it without touching the worker', async () => {
    const { client, workers } = makeClient();
    const controller = new AbortController();
    const first = client.reconstruct(reconstructJob(1));
    const queued = client.reconstruct(reconstructJob(2), {}, controller.signal);
    controller.abort();
    await expect(queued).rejects.toThrow('cancelled');
    const [worker] = workers;
    expect(worker.terminated).toBe(false);
    worker.emit({ type: 'reconstructResult', id: idOf(worker.posted[0]), outcome: outcome(1) });
    expect((await first).turn).toBe(1);
    expect(worker.posted).toHaveLength(1);
  });

  test('an already-aborted signal rejects before anything is posted', async () => {
    const { client, workers } = makeClient();
    const controller = new AbortController();
    controller.abort();
    await expect(client.reconstruct(reconstructJob(1), {}, controller.signal)).rejects.toThrow('cancelled');
    expect(workers).toHaveLength(0);
  });

  test('an error response rejects its job and the queue continues', async () => {
    const { client, workers } = makeClient();
    const failing = client.reconstruct(reconstructJob(1));
    const following = client.solveSpreads(solveJob);
    const [worker] = workers;
    worker.emit({ type: 'replayError', id: idOf(worker.posted[0]), message: 'sim exploded' });
    await expect(failing).rejects.toThrow('sim exploded');
    expect(worker.posted).toHaveLength(2);
    worker.emit({ type: 'solveSpreadsResult', id: idOf(worker.posted[1]), entries: [] });
    expect((await following).size).toBe(0);
  });

  test('a worker crash rejects the running job and the next job spawns a new worker', async () => {
    const { client, workers } = makeClient();
    const crashing = client.reconstruct(reconstructJob(1));
    const following = client.reconstruct(reconstructJob(2));
    workers[0].crash('out of memory');
    await expect(crashing).rejects.toThrow('out of memory');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    workers[1].emit({ type: 'reconstructResult', id: idOf(workers[1].posted[0]), outcome: outcome(2) });
    expect((await following).turn).toBe(2);
  });

  test('dispose rejects the running and the queued jobs', async () => {
    const { client, workers } = makeClient();
    const running = client.reconstruct(reconstructJob(1));
    const queued = client.reconstruct(reconstructJob(2));
    client.dispose();
    await expect(running).rejects.toThrow('cancelled');
    await expect(queued).rejects.toThrow('cancelled');
    expect(workers[0].terminated).toBe(true);
  });
});
