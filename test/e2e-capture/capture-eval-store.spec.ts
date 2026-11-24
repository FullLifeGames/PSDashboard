import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import type { ReplayData } from '@fulllifegames/replay-core';
import { EVAL_STORE_CAPTURES, EVAL_STORE_DIR, evalStoreFileName, serializeEvalStoreFile, type EvalStoreFile, type EvalStoreRecord } from '../e2e/eval-store';
import { currentTag, openReplayAnalysis, readEvalStore } from '../e2e/eval-store-seed';
import { installReplayEmbedCache } from '../e2e/helpers';

/**
 * One live analysis per capture of `EVAL_STORE_CAPTURES` (the game's sweep, or the capture's turns one by one with
 * "Analyze this position", as the spec does), then the records of the app's IndexedDB store go to
 * `test/e2e/fixtures/eval-store/<replay>--<mode>-d<depth>s<samples>[-t<turns>].json`. `EVAL_STORE_ONLY=<replay id or file name>` captures one replay or one file.
 */
const here = dirname(fileURLToPath(import.meta.url));
const only = process.env.EVAL_STORE_ONLY;

test.beforeAll(installReplayEmbedCache);
test.use({ actionTimeout: 60_000 });

/** A saved record holds numbers, text and nested lists only: JSON would turn Infinity or NaN into null and the seed would differ from the live record. */
function findNonFinite(value: unknown, path: string): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findNonFinite(value[i], `${path}[${i}]`);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      const found = findNonFinite(item, `${path}.${name}`);
      if (found) return found;
    }
  }
  return null;
}

/** The replay fixture of an id: the engine's fixtures first, then the feedback corpus' (win-paths reads both). */
function readReplay(id: string): ReplayData {
  const dirs = ['../../packages/eval-engine/test/fixtures', '../e2e-feedback/fixtures'].map(dir => join(here, dir, `${id}.json`));
  const found = dirs.find(path => existsSync(path));
  if (!found) throw new Error(`No replay fixture ${id}`);
  return JSON.parse(readFileSync(found, 'utf-8')) as ReplayData;
}

/** The sweep saves fire and forget: read until the count stands still. */
async function settledRecords(page: Page, replayId: string): Promise<EvalStoreRecord[]> {
  let records = await readEvalStore(page, replayId);
  for (let stable = 0; stable < 3;) {
    await page.waitForTimeout(1_000);
    const next = await readEvalStore(page, replayId);
    stable = next.length === records.length ? stable + 1 : 0;
    records = next;
  }
  return records;
}

for (const capture of EVAL_STORE_CAPTURES.filter(entry => !only || entry.replay === only || evalStoreFileName(entry.replay, entry.settings, entry.turns) === only)) {
  test(`capture ${evalStoreFileName(capture.replay, capture.settings, capture.turns)}`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const replay = readReplay(capture.replay);
    await openReplayAnalysis(page, replay, capture.settings);
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    let records: EvalStoreRecord[];
    if (capture.turns) {
      // the route of lines-play and hard-mode: the slider to the turn, "Analyze this position", until the records of the turn and of the
      // next position (the search grades the played move there) are saved: a doubles turn saves its second record seconds after its first
      for (const turn of capture.turns) {
        await page.locator('input[type="range"]').fill(String(turn));
        // after the first report of the game the panel shows the overview: the graph's column opens the turn's own view
        const column = panel.locator(`svg rect[data-turn="${turn}"]`).first();
        if (await column.count() > 0) await column.click({ force: true });
        const analyze = panel.getByRole('button', { name: /^Analyze this position/ });
        await expect(analyze).toBeEnabled({ timeout: 60_000 });
        await analyze.click();
        await expect.poll(async () => {
          const keys = (await readEvalStore(page, replay.id)).map(record => record.key);
          return [turn, turn + 1].every(position => keys.some(key => key.includes(`|${replay.id}:${position}:`)));
        }, { message: `the records of turn ${turn} and ${turn + 1}`, timeout: 600_000, intervals: [2_000] }).toBe(true);
      }
      records = await settledRecords(page, replay.id);
    } else {
      await panel.getByRole('button', { name: 'Analyze game' }).click();
      await expect(panel.getByRole('button', { name: 'Re-analyze' })).toBeVisible({ timeout: 1_500_000 });
      // an Auto sweep keeps no lines on its matrix turns: after the report the app searches them (the review's "Finding lines for graded
      // turns" stage) and writes the lines into each turn's record, so the capture waits for that stage to end
      const stage = panel.locator('.ps-eval-review').getByText(/Finding lines for graded turns: \d+ of \d+/);
      if (await stage.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)) await stage.waitFor({ state: 'hidden', timeout: 1_200_000 });
      records = await settledRecords(page, replay.id);
    }
    expect(records.length, 'the analysis saved records').toBeGreaterThan(0);
    for (const record of records) expect(findNonFinite(record, record.key), 'a saved record that JSON cannot hold').toBeNull();

    const file: EvalStoreFile = {
      format: 1, replay: replay.id, cacheVersion: await currentTag(page), settings: capture.settings, ...(capture.turns ? { turns: capture.turns } : {}), records,
    };
    const target = join(process.cwd(), EVAL_STORE_DIR, evalStoreFileName(replay.id, capture.settings, capture.turns));
    mkdirSync(dirname(target), { recursive: true });
    const text = serializeEvalStoreFile(file);
    writeFileSync(target, text);
    console.log(`${target}: ${records.length} records, ${(text.length / 1024).toFixed(0)} KiB`);
  });
}
