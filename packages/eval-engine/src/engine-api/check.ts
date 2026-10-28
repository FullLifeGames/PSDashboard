import { engineRequestFor } from './request.ts';
import { validateEngineResponse } from './validate.ts';

/** The pages that host the dashboard: an engine must let them call it (CORS). */
export const DASHBOARD_ORIGINS = ['https://fulllifegames.github.io', 'https://fulllifegames.com'];

export interface EngineCheckReport {
  ok: boolean;
  samples: { name: string; ok: boolean; ms: number; errors: string[] }[];
  cors: { origin: string; ok: boolean; error?: string }[];
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** One sample: the request, the timed answer, and the protocol's checks. */
async function checkSample(url: string, position: { name: string; serialized: string; format?: string }, budgetMs: number, fetcher: Fetch, clock: () => number) {
  const request = engineRequestFor(position.serialized, budgetMs, true, position.format);
  const started = clock();
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  } catch (error) {
    return { name: position.name, ok: false, ms: clock() - started, errors: [`no answer: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const ms = clock() - started;
  if (!response.ok) return { name: position.name, ok: false, ms, errors: [`HTTP ${response.status}`] };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { name: position.name, ok: false, ms, errors: ['the answer is no JSON'] };
  }
  const checked = validateEngineResponse(request, body);
  const errors = [
    ...(checked.ok ? [] : checked.errors),
    ...(ms > budgetMs ? [`answered in ${ms} ms, over the budget of ${budgetMs} ms`] : []),
  ];
  return { name: position.name, ok: errors.length === 0, ms, errors };
}

/** The browser's preflight for a JSON POST from one hosting page. */
async function checkCors(url: string, origin: string, fetcher: Fetch) {
  try {
    const response = await fetcher(url, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    const allowed = response.headers.get('Access-Control-Allow-Origin');
    if (allowed !== '*' && allowed !== origin) return { origin, ok: false, error: `no Access-Control-Allow-Origin for ${origin}` };
    const headers = (response.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    if (headers !== '*' && !headers.split(',').map(entry => entry.trim()).includes('content-type')) {
      return { origin, ok: false, error: 'Access-Control-Allow-Headers must name content-type' };
    }
    return { origin, ok: true };
  } catch (error) {
    return { origin, ok: false, error: `the preflight failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Round 77 (user gate 28.10.2026, 6a): the conformance check of an engine endpoint, behind
 * `npx @fulllifegames/eval-engine check-engine <url>`. It sends the shipped sample positions (singles,
 * doubles, VGC) with the options the dashboard ranks, checks every answer as the dashboard reads it
 * (validateEngineResponse) and against the budget, and checks the preflight of both hosting pages.
 */
export async function checkEngine(url: string, options: {
  positions: { name: string; serialized: string; format?: string }[];
  budgetMs?: number;
  origins?: string[];
  fetch?: Fetch;
  clock?: () => number;
}): Promise<EngineCheckReport> {
  const fetcher = options.fetch ?? ((target, init) => fetch(target, init));
  const clock = options.clock ?? (() => Date.now());
  const budgetMs = options.budgetMs ?? 5000;
  const samples = [];
  for (const position of options.positions) samples.push(await checkSample(url, position, budgetMs, fetcher, clock));
  const cors = [];
  for (const origin of options.origins ?? DASHBOARD_ORIGINS) cors.push(await checkCors(url, origin, fetcher));
  return { ok: samples.every(entry => entry.ok) && cors.every(entry => entry.ok), samples, cors };
}
