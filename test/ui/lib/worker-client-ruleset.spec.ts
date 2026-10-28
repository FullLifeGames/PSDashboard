import { afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { serializeLiveBattle, type EvalSettings, type EvalWorkerRequest, type EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { EvalWorkerClient } from '../../../src/lib/eval/worker-client';

/**
 * Round 65: the pool's messages name the rule set of the position (Pokémon
 * Champions or standard), so the worker's executor reads the replay's
 * weight table in cells, sub-searches and proofs. Round 67 (T139): every
 * path names it, standard included. A caller without one fails before any
 * message, and the worker refuses a message without one, so a path that
 * drops its rule set fails its test instead of pricing with the standard
 * weights.
 */

const posted: EvalWorkerRequest[] = [];
const answered: EvalWorkerResponse[] = [];

/** A scripted pool worker: a cell and a sub-search answer, anything else an error. */
class FakeWorker {
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(request: EvalWorkerRequest) {
    posted.push(request);
    const reply = (response: EvalWorkerResponse) => queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<EvalWorkerResponse>));
    if (request.type === 'cells') reply({ type: 'cellsResult', id: request.id, values: [{ i: 0, j: 0, value: 0.25, ended: false }] });
    else if (request.type === 'subsearch') reply({ type: 'result', id: request.id, result: { score: 0.3, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } } });
    else reply({ type: 'error', id: request.id, message: 'fake worker: no scripted answer' });
  }
  terminate() {}
}

/** The real worker module on this thread; answers go back to the pool worker that asked, by message id. */
const askers = new Map<number, RealWorker>();
const scope = {
  onmessage: null as ((event: MessageEvent<EvalWorkerRequest>) => Promise<void>) | null,
  postMessage: (message: EvalWorkerResponse) => {
    answered.push(message);
    askers.get(message.id)?.deliver(message);
  },
};
/** The one message type whose rule set the stand-in drops on its way to the worker (null: none). */
let dropped: EvalWorkerRequest['type'] | null = null;

function withoutRuleset(request: EvalWorkerRequest): EvalWorkerRequest {
  if (request.type !== dropped) return request;
  if (request.type === 'mctstree' || request.type === 'search') return { ...request, settings: { ...request.settings, ruleset: undefined } };
  return { ...request, ruleset: undefined };
}

class RealWorker {
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(request: EvalWorkerRequest) {
    posted.push(request);
    askers.set(request.id, this);
    const sent = withoutRuleset(request);
    queueMicrotask(() => { void scope.onmessage?.({ data: sent } as MessageEvent<EvalWorkerRequest>); });
  }
  deliver(message: EvalWorkerResponse) {
    queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<EvalWorkerResponse>));
  }
  terminate() {}
}

const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

let serializedBattle = '';

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../../src/workers/eval-worker');
  vi.unstubAllGlobals();
  const battle = new Battle({
    formatid: 'gen9customgame' as never, seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack([mon('Garchomp', ['earthquake', 'dragonclaw'])]) },
    p2: { name: 'Beta', team: Teams.pack([mon('Heatran', ['magmastorm', 'earthpower'])]) },
  });
  if (battle.sides[0].requestState === 'teampreview') {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  serializedBattle = serializeLiveBattle(battle);
});

afterEach(() => {
  posted.length = 0;
  answered.length = 0;
  dropped = null;
  vi.unstubAllGlobals();
});

const rulesetOf = (request: EvalWorkerRequest) =>
  (request.type === 'mctstree' || request.type === 'search' ? request.settings.ruleset : request.ruleset);

async function evaluateOnRealWorker(settings: EvalSettings) {
  vi.stubGlobal('Worker', RealWorker);
  const client = new EvalWorkerClient();
  try {
    return await client.evaluate(serializedBattle, settings);
  } finally {
    client.dispose();
  }
}

/** Every message type the run sent names `ruleset`; dropping it on any one of them gets that message refused. */
async function expectEveryPathGuarded(settings: EvalSettings) {
  await evaluateOnRealWorker(settings);
  const types = [...new Set(posted.map(request => request.type))];
  expect(posted.every(request => rulesetOf(request) === settings.ruleset)).toBe(true);
  for (const type of types) {
    posted.length = 0;
    answered.length = 0;
    dropped = type;
    await evaluateOnRealWorker(settings).catch(() => null);
    expect(answered.some(answer => answer.type === 'error' && /rule set/.test(answer.message)), type).toBe(true);
  }
  return types;
}

describe('worker client rule set', () => {
  test('a matrix evaluation names the rule set on every message, and a message that drops it is refused', async () => {
    const types = await expectEveryPathGuarded({ depth: 2, samples: 1, tera: false, ruleset: 'vgc' });
    expect(types).toEqual(expect.arrayContaining(['choices', 'cells', 'subsearch']));
  });

  test('a tree evaluation names the rule set on its trees and its other messages, and a message that drops it is refused', async () => {
    localStorage.setItem('ps-replay-interceptor:search-budget', 'trees=2,iterations=50');
    onTestFinished(() => localStorage.removeItem('ps-replay-interceptor:search-budget'));
    const types = await expectEveryPathGuarded({ depth: 1, samples: 1, mode: 'mcts', tera: false, ruleset: 'champions' });
    expect(types).toContain('mctstree');
  });

  test('a pair valued by one cell names the rule set on its message', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    await client.evalPair('{}', 'move 1', 'move 1', { depth: 1, samples: 1, ruleset: 'champions' });
    const cells = posted.find(request => request.type === 'cells');
    expect(cells?.ruleset).toBe('champions');
    client.dispose();
  });

  test('a pair valued by a sub-search names the rule set on the message and in its settings', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    await client.evalPair('{}', 'move 1', 'move 1', { depth: 2, samples: 1, ruleset: 'champions' });
    const sub = posted.find(request => request.type === 'subsearch');
    expect(sub?.ruleset).toBe('champions');
    expect(sub?.type === 'subsearch' ? sub.job.settings.ruleset : null).toBe('champions');
    client.dispose();
  });

  // Round 67 (T140): the played pair's sub-search filters a second sleep like the sweep does.
  test('a pair valued by a sub-search carries the Sleep Clause in its settings', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    await client.evalPair('{}', 'move 1', 'move 1', { depth: 2, samples: 1, sleepClause: true, ruleset: 'standard' });
    const sub = posted.find(request => request.type === 'subsearch');
    expect(sub?.type === 'subsearch' ? sub.job.settings.sleepClause : null).toBe(true);
    client.dispose();
  });

  test('a standard replay names its rule set too', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    await client.evalPair('{}', 'move 1', 'move 1', { depth: 1, samples: 1, ruleset: 'standard' });
    expect(posted.find(request => request.type === 'cells')?.ruleset).toBe('standard');
    client.dispose();
  });

  test('an evaluation or a pair without a rule set fails before any message', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    await expect(client.evaluate('{}', { depth: 1, samples: 1 })).rejects.toThrow(/rule set/);
    await expect(client.evaluate('{}', { depth: 1, samples: 1, mode: 'mcts' })).rejects.toThrow(/rule set/);
    await expect(client.evalPair('{}', 'move 1', 'move 1', { depth: 1, samples: 1 })).rejects.toThrow(/rule set/);
    await expect(client.evalPair('{}', 'move 1', 'move 1', { depth: 2, samples: 1 })).rejects.toThrow(/rule set/);
    expect(posted).toHaveLength(0);
    client.dispose();
  });
});
