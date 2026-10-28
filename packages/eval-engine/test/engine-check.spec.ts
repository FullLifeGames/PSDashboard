import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENGINE_PROTOCOL, checkEngine, engineRequestFor, type EngineRequest } from '../src/engine-api/index.ts';

const sample = (name: string) => {
  const file = JSON.parse(readFileSync(new URL(`../samples/${name}.json`, import.meta.url), 'utf8')) as { serialized: string; format: string };
  return { name, serialized: file.serialized, format: file.format };
};
const positions = [sample('singles-gen9ou'), sample('doubles-gen9doublesou'), sample('vgc-gen9vgc2026regi')];

/** A valid engine: every option valued 0, CORS for every origin. */
function engine(overrides: { status?: number; body?: (request: EngineRequest) => unknown; cors?: string | null } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers();
    if (overrides.cors !== null) headers.set('Access-Control-Allow-Origin', overrides.cors ?? '*');
    if (init?.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Headers', 'content-type');
      return new Response(null, { status: 204, headers });
    }
    const request = JSON.parse(String(init?.body)) as EngineRequest;
    const valued = (side: 'p1' | 'p2') => Object.fromEntries(request.options[side].map(option => [option.id, 0]));
    const body = overrides.body?.(request) ?? { protocol: ENGINE_PROTOCOL, score: 0, values: { p1: valued('p1'), p2: valued('p2') } };
    return new Response(JSON.stringify(body), { status: overrides.status ?? 200, headers });
  });
}

describe('check-engine, the conformance tool (round 77, user gate 28.10.2026, 6a)', () => {
  test('the samples ship singles, doubles and VGC; a request lists the options of the dashboard\'s own matrix', () => {
    const requests = positions.map(position => engineRequestFor(position.serialized, 5000, true, position.format));
    expect(requests.map(request => request.gameType)).toEqual(['singles', 'doubles', 'doubles']);
    expect(requests.every(request => request.options.p1.length > 0 && request.options.p2.length > 0)).toBe(true);
    expect(requests[2].format).toBe('gen9vgc2026regi');
    // VGC rebuilds on the doubles format; the request names both.
    expect(requests[2].simFormat).toBe('gen9doublesou');
  });

  test('a valid engine passes every sample and the CORS check for both pages that host the dashboard', async () => {
    const fetcher = engine();
    const report = await checkEngine('http://localhost:8765/', { positions, fetch: fetcher });
    expect(report.ok).toBe(true);
    expect(report.samples.map(entry => [entry.name, entry.ok])).toEqual([
      ['singles-gen9ou', true], ['doubles-gen9doublesou', true], ['vgc-gen9vgc2026regi', true],
    ]);
    expect(report.cors.map(entry => [entry.origin, entry.ok])).toEqual([
      ['https://fulllifegames.github.io', true], ['https://fulllifegames.com', true],
    ]);
    const origins = fetcher.mock.calls.filter(([, init]) => init?.method === 'OPTIONS').map(([, init]) => new Headers(init?.headers).get('Origin'));
    expect(origins).toEqual(['https://fulllifegames.github.io', 'https://fulllifegames.com']);
  });

  test('a wrong answer, an HTTP error, a slow answer and missing CORS each fail with their reason', async () => {
    const wrong = await checkEngine('http://localhost:8765/', { positions: positions.slice(0, 1), fetch: engine({ body: () => ({ protocol: ENGINE_PROTOCOL, score: 3, values: { p1: {}, p2: {} } }) }) });
    expect(wrong.ok).toBe(false);
    expect(wrong.samples[0].errors[0]).toBe('score must be a number from -1 to 1');

    const broken = await checkEngine('http://localhost:8765/', { positions: positions.slice(0, 1), fetch: engine({ status: 500 }) });
    expect(broken.samples[0].errors).toEqual(['HTTP 500']);

    let now = 0;
    const slow = await checkEngine('http://localhost:8765/', {
      positions: positions.slice(0, 1), fetch: engine(), budgetMs: 100,
      clock: () => (now += 400),
    });
    expect(slow.samples[0].errors).toEqual(['answered in 400 ms, over the budget of 100 ms']);

    const closed = await checkEngine('http://localhost:8765/', { positions: positions.slice(0, 1), fetch: engine({ cors: null }) });
    expect(closed.ok).toBe(false);
    expect(closed.cors[0]).toMatchObject({ ok: false, error: 'no Access-Control-Allow-Origin for https://fulllifegames.github.io' });
  });
});
