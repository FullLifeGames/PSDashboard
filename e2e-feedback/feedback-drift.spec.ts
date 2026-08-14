import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { TurnAnalysis } from '../src/lib/eval/analysis';
import type { GameReport } from '../src/lib/eval/report';
import { parseReplayLogWithObservations } from '../src/lib/protocol-parser';
import { finalPlayedTurn } from '../src/lib/replay-turns';
import { FEEDBACK_CORPUS, FEEDBACK_REPLAYS } from './corpus';
import { evaluateItem, validateCorpus, type ClaimResult } from './claims';
import { installHermeticRoutes, RECORD } from './hermetic';
import { renderReport, type DriftMeta } from './report';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORT_DIR = join(__dirname, '..', 'docs', 'reports');
const DUMP = process.env.FEEDBACK_DUMP === '1';

/**
 * The expert-feedback drift run: analyzes each pinned replay through the
 * REAL app (fresh context = default d2s3 auto line) and grades the corpus.
 * WARN-ONLY: claim statuses are report content. The only reds are harness
 * breakage — hermetic violations, unfinished sweeps, empty extraction, a
 * malformed corpus. Run: npm run test:feedback
 * (FEEDBACK_RECORD=1 records data.pkmn.cc pins; FEEDBACK_DUMP=1 writes
 * full graph dumps for dossier work.)
 */

interface ExtractedDebug {
  scores: (number | null)[];
  notice: string | null;
  analyses: (TurnAnalysis | null)[] | null;
  gameReport: GameReport | null;
}

const results: ClaimResult[] = [];
const wallTimes: Record<string, number> = {};
const noticeByReplay: Record<string, string | null> = {};

test.describe.configure({ mode: 'serial' });

test('corpus is well-formed against the real fixtures', () => {
  const turnsByReplay = Object.fromEntries(FEEDBACK_REPLAYS.map(id => {
    const replay = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${id}.json`), 'utf-8')) as { log: string };
    return [id, finalPlayedTurn(parseReplayLogWithObservations(replay.log).snapshots)];
  }));
  expect(validateCorpus(FEEDBACK_CORPUS, turnsByReplay)).toEqual([]);
});

for (const replayId of FEEDBACK_REPLAYS) {
  test(`drift: ${replayId}`, async ({ page }) => {
    const log = await installHermeticRoutes(page, replayId);
    const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${replayId}.json`), 'utf-8')) as { players: string[] };
    const started = Date.now();
    await page.goto(`/?replay=${replayId}`);
    await expect(page.getByText(fixture.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    await page.waitForFunction(() => {
      const dbg = (window as unknown as { __psDebug?: { graph: { running: boolean }; gameReport: unknown } }).__psDebug;
      return !!dbg && dbg.graph.running === false && dbg.gameReport !== null;
    }, undefined, { timeout: 2_100_000, polling: 1_000 });
    const dbg = await page.evaluate(() => {
      const raw = (window as unknown as {
        __psDebug: { graph: { scores: unknown; notice: unknown }; analyses: unknown; gameReport: unknown };
      }).__psDebug;
      return JSON.parse(JSON.stringify({
        scores: raw.graph.scores, notice: raw.graph.notice,
        analyses: raw.analyses, gameReport: raw.gameReport,
      }));
    }) as ExtractedDebug;
    wallTimes[replayId] = Math.round((Date.now() - started) / 1000);
    noticeByReplay[replayId] = dbg.notice;
    if (DUMP) {
      const full = await page.evaluate(() =>
        JSON.parse(JSON.stringify((window as unknown as { __psDebug: unknown }).__psDebug)));
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(join(REPORT_DIR, `feedback-full-${replayId}.json`), JSON.stringify(full, null, 2));
    }

    // Harness reds — the ONLY reds on this path.
    expect(log.violations, 'unexpected external requests').toEqual([]);
    expect(log.smogonMisses, 'unpinned data.pkmn.cc requests — run once with FEEDBACK_RECORD=1').toEqual([]);
    expect(dbg.analyses, 'debug handle exposed no analyses').not.toBeNull();
    expect(dbg.scores.filter(score => score !== null).length, 'sweep produced no scores').toBeGreaterThan(0);

    for (const item of FEEDBACK_CORPUS.filter(entry => entry.replay === replayId)) {
      results.push(evaluateItem(item, dbg.analyses!, dbg.gameReport));
    }
  });
}

test.afterAll(() => {
  if (results.length === 0) return;
  const meta: DriftMeta = {
    commit: execSync('git rev-parse --short HEAD').toString().trim(),
    date: new Date().toISOString(),
    settingsLine: `depth 2 · samples 3 · mode auto (fresh-context defaults)${RECORD ? ' · RECORD' : ''}`,
    wallTimes,
    noticeByReplay,
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  const { markdown, json } = renderReport(results, meta);
  writeFileSync(join(REPORT_DIR, 'feedback-drift.md'), markdown);
  writeFileSync(join(REPORT_DIR, 'feedback-drift.json'), json);
  console.log(`\n${markdown}`);
});
