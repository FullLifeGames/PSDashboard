import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENGINE_PROTOCOL, type EngineRequest } from '@fulllifegames/eval-engine';
import { evalPairWithEngine, evaluateWithEngine } from '../../src/lib/eval/engine-evaluate';
import type { EngineEntry } from '../../src/lib/engines/registry';

const serialized = (JSON.parse(readFileSync('packages/eval-engine/test/fixtures/positions/gen9ou-2658658993-t2.json', 'utf8')) as { serialized: string }).serialized;
const engine: EngineEntry = { id: 'url:http://localhost:8765/', name: 'Test engine', url: 'http://localhost:8765/', source: 'added' };
const choices = {
  rootEnded: false, rootValue: 0.1,
  p1: [{ choice: 'move closecombat', label: 'Close Combat' }, { choice: 'switch 5', label: '→ Mandibuzz' }],
  p2: [{ choice: 'move shadowball', label: 'Shadow Ball' }, { choice: 'switch 6', label: '→ Weavile' }],
};
const executor = { choices: vi.fn(async () => choices) };

/** A fetch stand-in that records the request and answers with what the test names. */
function serve(answer: (request: EngineRequest) => { status?: number; body: unknown }) {
  const seen: EngineRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('http://localhost:8765/');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const request = JSON.parse(String(init.body)) as EngineRequest;
    seen.push(request);
    const { status = 200, body } = answer(request);
    return new Response(JSON.stringify(body), { status });
  }));
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('another engine answers over HTTP (round 77, user gate 28.10.2026)', () => {
  test('the request carries the pool\'s options; the checked answer comes back ranked and names its engine', async () => {
    const seen = serve(request => ({
      body: {
        protocol: ENGINE_PROTOCOL, score: 0.2, engine: { name: 'Bot', version: '0.1' },
        values: {
          p1: Object.fromEntries(request.options.p1.map((option, index) => [option.id, index === 0 ? 0.3 : 0.1])),
          p2: Object.fromEntries(request.options.p2.map(option => [option.id, -0.2])),
        },
      },
    }));
    const result = await evaluateWithEngine(engine, serialized, executor, { tera: true, sleepClause: false, keepPlayed: undefined }, () => true);
    expect(seen).toHaveLength(1);
    expect(seen[0].protocol).toBe(ENGINE_PROTOCOL);
    expect(seen[0].options.p1.map(option => option.id)).toEqual(['move closecombat', 'switch 5']);
    expect(seen[0].state).toBe(serialized);
    expect(result.score).toBe(0.2);
    expect(result.perSide.p1[0]).toMatchObject({ choice: 'move closecombat', ev: 0.3 });
    expect(result.engine).toEqual({ id: engine.id, name: 'Test engine', version: '0.1' });
  });

  test('a played pair asks for one option per side and reads the score', async () => {
    const seen = serve(() => ({ body: { protocol: ENGINE_PROTOCOL, score: -0.4, values: { p1: { 'switch 5': -0.4 }, p2: { 'switch 6': 0.4 } } } }));
    await expect(evalPairWithEngine(engine, serialized, 'switch 5', 'switch 6', () => true)).resolves.toBe(-0.4);
    expect(seen[0].options).toEqual({
      p1: [{ id: 'switch 5', label: 'switch 5', command: 'switch 5' }],
      p2: [{ id: 'switch 6', label: 'switch 6', command: 'switch 6' }],
    });
  });

  test('an HTTP error, a bad answer, or a dead request comes back as a message that names the engine', async () => {
    serve(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(evaluateWithEngine(engine, serialized, executor, { tera: true }, () => true)).rejects.toThrow('Test engine answered HTTP 500');
    serve(() => ({ body: { protocol: ENGINE_PROTOCOL, score: 2, values: { p1: {}, p2: {} } } }));
    await expect(evaluateWithEngine(engine, serialized, executor, { tera: true }, () => true))
      .rejects.toThrow(/Test engine's answer does not fit the protocol: score must be a number from -1 to 1; values\.p1 lacks option/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(evaluateWithEngine(engine, serialized, executor, { tera: true }, () => true))
      .rejects.toThrow('Test engine did not answer (Failed to fetch). Is it running, and does it allow this page (CORS)?');
  });
});
