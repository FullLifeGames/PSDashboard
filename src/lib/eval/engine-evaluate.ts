import {
  buildEngineRequest, engineResponseToResult, loadSimModsFor, validateEngineResponse,
  type EngineRequest, type EngineResponse, type EvalResult, type EvalSettings, type SearchExecutor,
} from '@fulllifegames/eval-engine';
import type { EngineEntry } from '../engines/registry';
import { engineGameFormat } from './engine-setting';

/** How long an engine may think about one position; the request names it. */
export const ENGINE_BUDGET_MS = 5000;
/** The network's share on top of the budget before the dashboard gives up. */
const ENGINE_SLACK_MS = 5000;

/** One POST of the engine protocol: the answer checked as the conformance tool checks it, or a message that says why not. */
async function askEngine(engine: EngineEntry, request: EngineRequest, live: () => boolean): Promise<EngineResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.budgetMs + ENGINE_SLACK_MS);
  // A newer evaluation supersedes this one: the request stops with it.
  const watch = window.setInterval(() => {
    if (!live()) controller.abort();
  }, 200);
  let response: Response;
  try {
    response = await fetch(engine.url!, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new Error(`${engine.name} did not answer within ${(request.budgetMs + ENGINE_SLACK_MS) / 1000} s.`, { cause: error });
    throw new Error(
      `${engine.name} did not answer (${error instanceof Error ? error.message : String(error)}). Is it running, and does it allow this page (CORS)?`,
      { cause: error },
    );
  } finally {
    window.clearTimeout(timer);
    window.clearInterval(watch);
  }
  if (!response.ok) throw new Error(`${engine.name} answered HTTP ${response.status}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${engine.name}'s answer is no JSON.`);
  }
  const checked = validateEngineResponse(request, body);
  if (!checked.ok) throw new Error(`${engine.name}'s answer does not fit the protocol: ${checked.errors.slice(0, 4).join('; ')}.`);
  return checked.response;
}

/**
 * Round 77 (user gate 28.10.2026, "1a 2a 3a 5a"): a position evaluated by another engine. The options
 * are the ones the dashboard's own matrix ranks (the pool's choices, pivot pairs included); the answer
 * is read through the same ranking, and the result names the engine.
 */
export async function evaluateWithEngine(
  engine: EngineEntry,
  serialized: string,
  executor: Pick<SearchExecutor, 'choices'>,
  settings: Pick<EvalSettings, 'tera' | 'sleepClause' | 'keepPlayed'>,
  live: () => boolean,
): Promise<EvalResult> {
  const info = await executor.choices(settings.tera ?? true, settings.keepPlayed, settings.sleepClause);
  if (info.rootEnded) return { score: info.rootValue, interval: 0, depthCompleted: 1, perSide: { p1: [], p2: [] } };
  // A Champions position revives on the Champions mod (round 67, T145).
  await loadSimModsFor(serialized);
  const request = buildEngineRequest(serialized, { p1: info.p1, p2: info.p2 }, ENGINE_BUDGET_MS, { format: engineGameFormat() ?? undefined });
  const response = await askEngine(engine, request, live);
  const version = response.engine?.version;
  return { ...engineResponseToResult(request, response), engine: { id: engine.id, name: engine.name, ...(version ? { version } : {}) } };
}

/** The value of one played pair: the position with one option per side, so the engine's score is that pair's. */
export async function evalPairWithEngine(
  engine: EngineEntry, serialized: string, p1Choice: string, p2Choice: string, live: () => boolean,
): Promise<number> {
  await loadSimModsFor(serialized);
  const request = buildEngineRequest(serialized, {
    p1: [{ choice: p1Choice, label: p1Choice }], p2: [{ choice: p2Choice, label: p2Choice }],
  }, ENGINE_BUDGET_MS, { format: engineGameFormat() ?? undefined });
  return (await askEngine(engine, request, live)).score;
}
