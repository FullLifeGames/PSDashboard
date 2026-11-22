import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import {
  EVAL_STORE_DIR, createSearchGuard, parseEvalStoreFile, seedRecords, type EvalStoreFile, type EvalStoreRecord, type SearchGuard,
} from './eval-store';
import { routeOfflineFixtures } from './helpers';

/**
 * Round 90 (#222): the browser half of the saved engine results (the file form and the two failure paths are in `eval-store.ts`).
 * A spec that judges a view calls `openReplayAnalysis(page, replay, { seed })`: the records go into the app's own store before the
 * reload, so "Analyze game" reads them, and the returned guard fails the spec, naming the capture command, when the page starts a search.
 * `EVAL_STORE=live` runs the same rows without the seed (a check that the saved results still equal a live run).
 */
const here = dirname(fileURLToPath(import.meta.url));
const STORE_MODULE = '/src/lib/eval-cache-store.ts';

export const evalStoreLive = (): boolean => process.env.EVAL_STORE === 'live';

/** A file of the saved results by name (as `evalStoreFileName` writes it). */
export function readEvalStoreFile(name: string): EvalStoreFile {
  return parseEvalStoreFile(readFileSync(join(here, 'fixtures', 'eval-store', name), 'utf-8'), `${EVAL_STORE_DIR}/${name}`);
}

/** The app's current version tag (`v80`, with the budget tag when one is set), read from the app's own module. */
export async function currentTag(page: Page): Promise<string> {
  return page.evaluate(async path => {
    const store = await import(/* @vite-ignore */ path);
    return (store.evalStorePrefix('probe') as string).split('|')[0];
  }, STORE_MODULE);
}

/** Tells the guard about every worker request the page posts (init script on every load, bridge to the test). */
async function watchWorkerRequests(page: Page, guard: SearchGuard): Promise<void> {
  await page.exposeFunction('__e2eWorkerRequest', (type: string) => guard.note(type));
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function patched(this: Worker, message: unknown, ...rest: unknown[]) {
      const request = message as { type?: unknown; serializedBattle?: unknown } | null;
      if (request && typeof request.type === 'string' && 'serializedBattle' in request) {
        void (window as unknown as { __e2eWorkerRequest: (type: string) => Promise<void> }).__e2eWorkerRequest(request.type);
      }
      return (post as (...args: unknown[]) => void).call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
}

/** Writes the saved records into the app's store, under the app's current cache version. Call on a loaded page, before the reload. */
export async function seedEvalStore(page: Page, name: string): Promise<void> {
  const file = readEvalStoreFile(name);
  const records = seedRecords(file, { tag: await currentTag(page), now: Date.now() });
  await page.evaluate(async ({ path, saved }) => {
    const store = await import(/* @vite-ignore */ path);
    for (const record of saved) await store.saveStoredEval(record);
  }, { path: STORE_MODULE, saved: records });
}

/** Every record the app holds for a replay under the current version (what the capture writes). */
export async function readEvalStore(page: Page, replayId: string): Promise<EvalStoreRecord[]> {
  const records = await page.evaluate(async ({ path, id }) => {
    const store = await import(/* @vite-ignore */ path);
    const map = await store.loadStoredEvalsByPrefix(store.evalStorePrefix(id));
    return map ? [...map.values()] : null;
  }, { path: STORE_MODULE, id: replayId }) as EvalStoreRecord[] | null;
  if (!records) throw new Error('The browser has no IndexedDB store to read.');
  return records;
}

export interface AnalysisSettings {
  mode: string;
  depth: number;
  samples: number;
}

export interface OpenedReplay {
  /** Fails the wait it races, or the spec at its end, when the page starts a search; a no-op guard in a live run. */
  guard: SearchGuard;
  seeded: boolean;
}

/**
 * The route every analysis spec takes: offline fixtures, the Evaluation preferences, the saved results when `seed` names a file (and the
 * run is not `EVAL_STORE=live`), the reload, the replay served by id, "Load". The page is on the replay when this returns. `prefs` adds
 * stored Evaluation preferences (Hard mode: `{ hardMode: true }`); it never changes what the search reads.
 */
export async function openReplayAnalysis(
  page: Page, replay: ReplayData, settings: AnalysisSettings, options: { seed?: string; prefs?: Record<string, unknown> } = {},
): Promise<OpenedReplay> {
  const guard = createSearchGuard(options.seed ?? 'no saved file');
  const seeded = options.seed !== undefined && !evalStoreLive();
  if (seeded) await watchWorkerRequests(page, guard);
  await routeOfflineFixtures(page);
  await page.goto('/');
  await page.evaluate(prefs => {
    localStorage.setItem('ps-replay-interceptor:eval-pool', '2');
    localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify({ ...prefs, auto: false, tera: 'auto' }));
  }, { depth: settings.depth, samples: settings.samples, mode: settings.mode, ...options.prefs });
  if (seeded) await seedEvalStore(page, options.seed!);
  await page.reload();
  // Registered last, so it answers before routeOfflineFixtures' default replay.
  await page.route('**/replay.pokemonshowdown.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(replay),
  }));
  await page.locator('input[type="text"]').first().fill(replay.id);
  await page.locator('button', { hasText: 'Load' }).click();
  await expect(page.getByText(replay.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  return { guard, seeded };
}
