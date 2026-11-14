import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  serializeLiveBattle, type EvalWorkerRequest, type EvalWorkerResponse, type WinPaths, type WinPathsRequest, type WinStep,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient } from '../../../src/lib/eval/worker-client';

/**
 * Round 89 (#130, G8a): the on-demand job and its client. The job runs on a worker of its own: it never queues behind a sweep's search,
 * a cancel of the sweep leaves it, and its cancel leaves the sweep. Steps arrive one by one, the answer of a finished job is kept for the
 * next open, and the job's message is generic (`job`, `jobStep`, `jobResult`), so a later "search this row on request" shares it.
 */

const workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: EvalWorkerRequest[] = [];
  terminated = false;
  constructor() { workers.push(this); }
  postMessage(request: EvalWorkerRequest) { this.posted.push(request); }
  terminate() { this.terminated = true; }
  say(response: EvalWorkerResponse) { this.onmessage?.({ data: response } as MessageEvent<EvalWorkerResponse>); }
}

const jobWorkers = () => workers.filter(worker => worker.posted.some(request => request.type === 'job'));
const poolWorkers = () => workers.filter(worker => !worker.posted.some(request => request.type === 'job'));

const step = (kind: WinStep['kind'], status: WinStep['status'] = 'found'): WinStep => ({ kind, status, spent: { cells: 3, turns: 5 } });
const paths = (steps: WinStep[]): WinPaths => ({ side: 'p2', turn: 23, steps });
const REQUEST: WinPathsRequest = { side: 'p2', turn: 23, first: { p1: 'move scald' }, played: 'move highjumpkick', tera: true };

afterEach(() => {
  workers.length = 0;
  vi.unstubAllGlobals();
});

describe('the win-paths job in the client', () => {
  test('the message names the job, the position and the rule set; steps arrive one by one; the result closes it', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const seen: WinStep[] = [];
    const run = client.winPaths('{"position":1}', REQUEST, 'champions', { onStep: item => seen.push(item) });
    const worker = jobWorkers()[0];
    const message = worker.posted.find(request => request.type === 'job')!;
    expect(message).toMatchObject({ type: 'job', serializedBattle: '{"position":1}', ruleset: 'champions', job: { kind: 'winPaths', request: REQUEST } });
    const id = message.id;
    worker.say({ type: 'jobStep', id, step: { kind: 'winPaths', step: step('stronger') } });
    expect(seen.map(item => item.kind)).toEqual(['stronger']);
    worker.say({ type: 'jobStep', id, step: { kind: 'winPaths', step: step('luck', 'none') } });
    expect(seen.map(item => item.kind)).toEqual(['stronger', 'luck']);
    const all = paths([step('stronger'), step('luck', 'none'), step('mistake', 'none')]);
    worker.say({ type: 'jobResult', id, result: { kind: 'winPaths', paths: all } });
    await expect(run).resolves.toEqual(all);
    client.dispose();
  });

  test('it runs on a worker of its own: the sweep keeps its pending search, a cancel of the sweep leaves the job', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const pair = client.evalPair('{"position":1}', 'move a', 'move b', { depth: 1, samples: 1, tera: false, ruleset: 'standard' });
    pair.catch(() => undefined);
    const pool = poolWorkers();
    expect(pool.some(worker => worker.posted.some(request => request.type === 'cells'))).toBe(true);
    const run = client.winPaths('{"position":1}', REQUEST, 'standard');
    run.catch(() => undefined);
    const job = jobWorkers();
    expect(job).toHaveLength(1);
    expect(pool).not.toContain(job[0]);
    // the sweep's cancel ends its busy workers and not the job's
    client.cancel();
    expect(pool.filter(worker => worker.posted.length > 0).every(worker => worker.terminated)).toBe(true);
    expect(job[0].terminated).toBe(false);
    await expect(pair).rejects.toThrow('cancelled');
    const id = job[0].posted[0].id;
    job[0].say({ type: 'jobResult', id, result: { kind: 'winPaths', paths: paths([step('stronger')]) } });
    await expect(run).resolves.toMatchObject({ turn: 23 });
    client.dispose();
  });

  test('a cancel ends the job alone: its promise rejects, the sweep keeps its pending search, a late step is dropped', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const pair = client.evalPair('{"position":1}', 'move a', 'move b', { depth: 1, samples: 1, tera: false, ruleset: 'standard' });
    const settled = vi.fn();
    pair.then(settled, settled);
    const seen: WinStep[] = [];
    const controller = new AbortController();
    const run = client.winPaths('{"position":1}', REQUEST, 'standard', { onStep: item => seen.push(item), signal: controller.signal });
    const failed = expect(run).rejects.toThrow('cancelled');
    const job = jobWorkers()[0];
    job.say({ type: 'jobStep', id: job.posted[0].id, step: { kind: 'winPaths', step: step('stronger') } });
    controller.abort();
    await failed;
    expect(job.terminated).toBe(true);
    expect(seen.map(item => item.kind)).toEqual(['stronger']);
    job.say({ type: 'jobStep', id: job.posted[0].id, step: { kind: 'winPaths', step: step('luck') } });
    expect(seen).toHaveLength(1);
    // the sweep: not terminated, not rejected
    await Promise.resolve();
    expect(poolWorkers().some(worker => worker.terminated)).toBe(false);
    expect(settled).not.toHaveBeenCalled();
    client.dispose();
  });

  test('a signal that is aborted already starts no worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const controller = new AbortController();
    controller.abort();
    await expect(client.winPaths('{"position":1}', REQUEST, 'standard', { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(workers).toHaveLength(0);
  });

  test('a worker that answers an error rejects the job and the next job starts a fresh worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const run = client.winPaths('{"position":1}', REQUEST, 'standard');
    const failed = expect(run).rejects.toThrow('the position cannot be revived');
    const job = jobWorkers()[0];
    job.say({ type: 'error', id: job.posted[0].id, message: 'the position cannot be revived' });
    await failed;
    expect(job.terminated).toBe(true);
    client.winPaths('{"position":1}', REQUEST, 'standard').catch(() => undefined);
    expect(jobWorkers()).toHaveLength(2);
    client.dispose();
  });

  test('the sweep\'s own calls post no job message: only winPaths starts one', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    client.evalPair('{"position":1}', 'move a', 'move b', { depth: 1, samples: 1, tera: false, ruleset: 'standard' }).catch(() => undefined);
    client.cancel();
    const everything = workers.flatMap(worker => worker.posted.map(request => request.type));
    expect(everything.length).toBeGreaterThan(0);
    expect(everything).not.toContain('job');
    client.dispose();
  });

  test('a finished job is kept: the second open answers from the memo, step by step, with no message', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const run = client.winPaths('{"position":1}', REQUEST, 'standard');
    const job = jobWorkers()[0];
    const all = paths([step('stronger'), step('luck'), step('mistake', 'none')]);
    job.say({ type: 'jobResult', id: job.posted[0].id, result: { kind: 'winPaths', paths: all } });
    await run;
    const seen: WinStep[] = [];
    await expect(client.winPaths('{"position":1}', { ...REQUEST }, 'standard', { onStep: item => seen.push(item) })).resolves.toEqual(all);
    expect(seen).toEqual(all.steps);
    expect(jobWorkers()).toHaveLength(1);
    // another position, another rule set or another request asks again
    client.winPaths('{"position":2}', REQUEST, 'standard').catch(() => undefined);
    client.winPaths('{"position":1}', REQUEST, 'vgc').catch(() => undefined);
    client.winPaths('{"position":1}', { ...REQUEST, side: 'p1' }, 'standard').catch(() => undefined);
    expect(jobWorkers()).toHaveLength(4);
    client.dispose();
  });

  test('a cancelled or failed job is not kept', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    const controller = new AbortController();
    const first = client.winPaths('{"position":1}', REQUEST, 'standard', { signal: controller.signal });
    first.catch(() => undefined);
    controller.abort();
    client.winPaths('{"position":1}', REQUEST, 'standard').catch(() => undefined);
    expect(jobWorkers()).toHaveLength(2);
    client.dispose();
  });

  test('dispose ends the job worker too', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    client.winPaths('{"position":1}', REQUEST, 'standard').catch(() => undefined);
    client.dispose();
    expect(jobWorkers()[0].terminated).toBe(true);
  });
});

/** The real worker module on this thread: the job's steps come back in the ruled order, one message each, then the result. */
const answered: EvalWorkerResponse[] = [];
const askers = new Map<number, RealWorker>();
const scope = {
  onmessage: null as ((event: MessageEvent<EvalWorkerRequest>) => Promise<void>) | null,
  postMessage: (message: EvalWorkerResponse) => {
    answered.push(message);
    askers.get(message.id)?.deliver(message);
  },
};
class RealWorker {
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  protected drop = false;
  postMessage(request: EvalWorkerRequest) {
    askers.set(request.id, this);
    const sent = this.drop && request.type === 'job' ? { ...request, ruleset: undefined } : request;
    queueMicrotask(() => { void scope.onmessage?.({ data: sent } as MessageEvent<EvalWorkerRequest>); });
  }
  deliver(message: EvalWorkerResponse) { queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<EvalWorkerResponse>)); }
  terminate() {}
}

const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

describe('the win-paths job through the worker module', () => {
  let serialized = '';
  beforeAll(async () => {
    vi.stubGlobal('self', scope);
    await import('../../../src/workers/eval-worker');
    vi.unstubAllGlobals();
    const battle = new Battle({
      formatid: 'gen9customgame' as never, seed: '1,2,3,4',
      p1: { name: 'Alpha', team: Teams.pack([mon('Garchomp', ['earthquake', 'dragonclaw'])]) },
      p2: { name: 'Beta', team: Teams.pack([mon('Heatran', ['magmastorm', 'earthpower'])]) },
    });
    if (battle.sides[0].requestState === 'teampreview') { battle.choose('p1', 'team 1'); battle.choose('p2', 'team 1'); }
    battle.sides[0].pokemon[0].hp = 1;
    battle.sides[1].pokemon[0].hp = 1;
    serialized = serializeLiveBattle(battle);
  });

  test('the steps come in the ruled order, each as its own message, and the result holds them all', async () => {
    answered.length = 0;
    vi.stubGlobal('Worker', RealWorker);
    const client = new EvalWorkerClient();
    const seen: string[] = [];
    try {
      const result = await client.winPaths(serialized, { side: 'p1', budget: { cells: 40, turns: 60 } }, 'standard', { onStep: item => seen.push(`${item.kind} ${item.status}`) });
      expect(result.steps.map(item => item.kind)).toEqual(['stronger', 'luck', 'mistake']);
      expect(result.steps[2]).toMatchObject({ kind: 'mistake' });
      expect(['found', 'none', 'stopped']).toContain(result.steps[2].status);
      expect(seen).toHaveLength(3);
      expect(answered.map(message => message.type)).toEqual(['jobStep', 'jobStep', 'jobStep', 'jobResult']);
    } finally {
      client.dispose();
    }
  });

  test('a job message without a rule set is refused by the worker', async () => {
    answered.length = 0;
    vi.stubGlobal('Worker', class extends RealWorker { drop = true; });
    const client = new EvalWorkerClient();
    try {
      await expect(client.winPaths(serialized, { side: 'p1' }, 'standard')).rejects.toThrow(/rule set/);
    } finally {
      client.dispose();
    }
  });
});
