import { afterEach, describe, expect, test, vi } from 'vitest';
import type { EvalWorkerRequest, EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { EvalWorkerClient } from '../../src/lib/eval/worker-client';

/**
 * Round 65: the pool's messages name the rule set of the position (Pokémon
 * Champions or standard), so the worker's executor reads the replay's
 * weight table in cells, sub-searches and proofs.
 */

const posted: EvalWorkerRequest[] = [];

class FakeWorker {
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(request: EvalWorkerRequest) {
    posted.push(request);
    const reply = (response: EvalWorkerResponse) => queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<EvalWorkerResponse>));
    if (request.type === 'cells') reply({ type: 'cellsResult', id: request.id, values: [{ i: 0, j: 0, value: 0.25, ended: false }] });
    else if (request.type === 'subsearch') reply({ type: 'result', id: request.id, result: { score: 0.3, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } } });
  }
  terminate() {}
}

afterEach(() => {
  posted.length = 0;
  vi.unstubAllGlobals();
});

describe('worker client rule set', () => {
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

  test('a standard replay sends no rule set, the worker reads it as standard', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new EvalWorkerClient();
    await client.evalPair('{}', 'move 1', 'move 1', { depth: 1, samples: 1 });
    expect(posted.find(request => request.type === 'cells')?.ruleset).toBeUndefined();
    client.dispose();
  });
});
