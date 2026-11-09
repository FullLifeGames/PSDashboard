import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { blendValues, blendWorlds, type EvalResult, type EvalWorkerRequest, type EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { installFakeWorker, FakeWorker } from '../fixtures/worker';
import { clearWorldPositions, registerWorldPositions, worldPositionsOf } from '../../../src/lib/eval/world-positions';

/**
 * Round 89 (#124): the worker client is the one place every evaluation passes, so it is where a short-side game's worlds blend. A
 * position the registry knows runs once per world, one after the other, and comes back blended by usage; a position it does not know
 * runs once, as before. The orchestrator is a stand-in that asks the pool one question about the position it was handed, so the
 * spec reads which positions reached the pool, in which order and under which cancel rules. Singles and doubles take the same path:
 * the registry holds opaque position strings, and the choice ids below are the one string every world shares.
 */
const engine = vi.hoisted(() => ({ afterWorld: null as null | ((position: string) => void) }));
vi.mock('@fulllifegames/eval-engine', async importOriginal => {
  const actual = await importOriginal<typeof import('@fulllifegames/eval-engine')>();
  return {
    ...actual,
    searchOrchestrated: vi.fn(async (executor: { choices(tera: boolean, keepPlayed: unknown, sleepClause: boolean): Promise<{ position: string }> }) => {
      const info = await executor.choices(false, undefined, false);
      engine.afterWorld?.(info.position);
      return resultFor(info.position);
    }),
  };
});

const SCORES: Record<string, number> = { A: 0.2, B: 0.6, C: -0.4, Z: 0.9 };
/** The three worlds of one turn: A the heaviest, then B, then C. */
const WORLDS = [{ position: 'A', weight: 0.5 }, { position: 'B', weight: 0.3 }, { position: 'C', weight: 0.2 }];

function resultFor(position: string): EvalResult {
  const ev = SCORES[position];
  const row = (choice: string, shift: number) => ({ choice, label: choice, worstCase: ev - 0.1 + shift, expected: ev + shift, ev: ev + shift, punishedBy: null });
  return { score: ev, interval: 0.1, depthCompleted: 1, perSide: { p1: [row('move 1', 0), row('switch 4', -0.1)], p2: [row('move 1', 0)] } };
}

const settings = { depth: 1 as const, samples: 1, tera: false, ruleset: 'vgc' as const };
const positionsSent = (type: EvalWorkerRequest['type']) =>
  FakeWorker.requests.filter(request => request.type === type).map(request => (request as { serializedBattle: string }).serializedBattle);

/** The pool answers a choices question with the position it was asked about, and a cell with the position's own score. */
function answer(request: EvalWorkerRequest): EvalWorkerResponse[] {
  if (request.type === 'choices') return [{ type: 'choicesResult', id: request.id, info: { position: request.serializedBattle } as never }];
  if (request.type === 'cells') {
    return [{ type: 'cellsResult', id: request.id, values: [{ i: 0, j: 0, value: SCORES[request.serializedBattle], ended: false }] }];
  }
  return [];
}

const { EvalWorkerClient } = await import('../../../src/lib/eval/worker-client');

beforeEach(() => {
  installFakeWorker(answer);
  clearWorldPositions();
  engine.afterWorld = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearWorldPositions();
});

describe('the world registry', () => {
  test('a position with several worlds is found by its heaviest world; one world registers nothing', () => {
    registerWorldPositions(WORLDS);
    expect(worldPositionsOf('A')).toEqual(WORLDS);
    expect(worldPositionsOf('B')).toBeNull();
    registerWorldPositions([{ position: 'Z', weight: 1 }]);
    expect(worldPositionsOf('Z')).toBeNull();
  });

  test('a later registration replaces the weights of the same position, and an empty clear forgets all', () => {
    registerWorldPositions(WORLDS);
    registerWorldPositions([{ position: 'A', weight: 0.6 }, { position: 'B', weight: 0.4 }]);
    expect(worldPositionsOf('A')?.map(world => world.weight)).toEqual([0.6, 0.4]);
    clearWorldPositions();
    expect(worldPositionsOf('A')).toBeNull();
  });

  test('the registry holds at most 4,096 positions, the oldest leaving first', () => {
    for (let index = 0; index < 4_100; index += 1) {
      registerWorldPositions([{ position: `p${index}`, weight: 0.5 }, { position: `q${index}`, weight: 0.5 }]);
    }
    expect(worldPositionsOf('p0')).toBeNull();
    expect(worldPositionsOf('p4099')).not.toBeNull();
  });
});

describe('a registered position runs once per world', () => {
  test('evaluate sends one search per world in weight order and returns the blend of the answers', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    const blended = await client.evaluate('A', settings);
    expect(positionsSent('choices')).toEqual(['A', 'B', 'C']);
    const expected = blendWorlds(WORLDS.map(world => resultFor(world.position)), WORLDS.map(world => world.weight));
    expect(blended).toEqual(expected);
    expect(blended.score).toBeCloseTo(0.5 * 0.2 + 0.3 * 0.6 + 0.2 * -0.4, 12);
    client.dispose();
  });

  test('evalPair values the pair in every world and blends the values by weight', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    const value = await client.evalPair('A', 'move 1', 'move 1', settings);
    expect(positionsSent('cells')).toEqual(['A', 'B', 'C']);
    expect(value).toBe(blendValues([0.2, 0.6, -0.4], [0.5, 0.3, 0.2]));
    client.dispose();
  });

  test('a sub-search pair (depth 2) runs once per world too', async () => {
    FakeWorker.answer = request => (request.type === 'subsearch'
      ? [{ type: 'result', id: request.id, result: resultFor(request.serializedBattle) }]
      : []);
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    const value = await client.evalPair('A', 'move 1', 'move 1', { ...settings, depth: 2 });
    expect(positionsSent('subsearch')).toEqual(['A', 'B', 'C']);
    expect(value).toBeCloseTo(0.5 * 0.2 + 0.3 * 0.6 + 0.2 * -0.4, 12);
    client.dispose();
  });
});

describe('a position without worlds takes the old path', () => {
  test('evaluate sends one search and returns the answer itself, not a blend', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    const result = await client.evaluate('Z', settings);
    expect(positionsSent('choices')).toEqual(['Z']);
    expect(result).toEqual(resultFor('Z'));
    client.dispose();
  });

  test('evalPair sends one cell and returns its value', async () => {
    const client = new EvalWorkerClient();
    await expect(client.evalPair('Z', 'move 1', 'move 1', settings)).resolves.toBe(0.9);
    expect(positionsSent('cells')).toEqual(['Z']);
    client.dispose();
  });
});

describe('a cancel stops the loop', () => {
  test('a cancel between two worlds sends no search for the rest and rejects as cancelled', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    engine.afterWorld = position => { if (position === 'A') client.cancel(); };
    await expect(client.evaluate('A', settings)).rejects.toThrow('cancelled');
    expect(positionsSent('choices')).toEqual(['A']);
    client.dispose();
  });

  test('an exclusive evaluation started meanwhile supersedes the loop of an earlier one', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    let later: Promise<EvalResult> | null = null;
    engine.afterWorld = position => { if (position === 'A') later = client.evaluate('Z', settings); };
    await expect(client.evaluate('A', settings)).rejects.toThrow('cancelled');
    expect((await later!).score).toBe(0.9);
    expect(positionsSent('choices').filter(position => position !== 'Z')).toEqual(['A']);
    client.dispose();
  });

  test('a cancel between two worlds of a pair stops the loop', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    FakeWorker.answer = request => {
      // Two hops: the cancel lands after the pool's answer for A resolved the call and before the loop asks about B.
      if (request.type === 'cells' && request.serializedBattle === 'A') queueMicrotask(() => queueMicrotask(() => client.cancel()));
      return answer(request);
    };
    await expect(client.evalPair('A', 'move 1', 'move 1', settings)).rejects.toThrow('cancelled');
    expect(positionsSent('cells')).toEqual(['A']);
    client.dispose();
  });

  test('a world that fails after the first drops out of the blend, and a failing first world rejects', async () => {
    registerWorldPositions(WORLDS);
    const client = new EvalWorkerClient();
    FakeWorker.answer = request => (request.type === 'cells' && request.serializedBattle === 'B'
      ? [{ type: 'error', id: request.id, message: 'sibling failed' }]
      : answer(request));
    await expect(client.evalPair('A', 'move 1', 'move 1', settings)).resolves.toBe(blendValues([0.2, -0.4], [0.5, 0.2]));
    FakeWorker.answer = request => (request.type === 'cells' && request.serializedBattle === 'A'
      ? [{ type: 'error', id: request.id, message: 'heaviest failed' }]
      : answer(request));
    await expect(client.evalPair('A', 'move 1', 'move 1', settings)).rejects.toThrow('heaviest failed');
    client.dispose();
  });
});
