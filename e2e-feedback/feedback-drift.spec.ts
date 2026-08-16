import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { TurnAnalysis } from '../src/lib/eval/analysis';
import type { GameReport } from '../src/lib/eval/report';
import type { AlignmentSummary } from '../src/lib/hax-alignment';
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
  evalErrors: (string | null)[];
  analyses: (TurnAnalysis | null)[] | null;
  gameReport: GameReport | null;
  haxAlignment: { summary: AlignmentSummary } | null;
}

const results: ClaimResult[] = [];
const wallTimes: Record<string, number> = {};
const noticeByReplay: Record<string, string | null> = {};
const evalErrorsByReplay: Record<string, { turn: number; error: string }[]> = {};
const alignmentByReplay: Record<string, AlignmentSummary | null> = {};

/** A replay that cannot be graded still shows up — as ERROR rows, never silence. */
function pushErrorResults(replayId: string, details: string[]) {
  for (const item of FEEDBACK_CORPUS.filter(entry => entry.replay === replayId)) {
    results.push({ item, status: 'error', details });
  }
}

interface SweepPoll {
  running: boolean;
  done: number;
  total: number;
}

/**
 * Waits for the sweep to TERMINATE (running false), with a stall detector:
 * the 653785 baseline wedged mid-sweep at "10/26" and burned the full
 * 35-minute wait — running stayed true with frozen progress (the registered
 * return102 family taking down the whole sweep, not just branching). Six
 * minutes without a progress tick is declared a wedge; the slowest healthy
 * per-turn step in the baseline was far under one minute. The stable reason
 * string (no elapsed seconds) feeds the report so determinism diffs stay
 * clean.
 */
async function waitForSweepEnd(page: Page): Promise<{ ok: true } | { ok: false; reason: string }> {
  const POLL_MS = 10_000;
  const STALL_MS = 360_000;
  const CAP_MS = 2_100_000;
  const startedAt = Date.now();
  let sawRunning = false;
  let lastDone = -2;
  let lastProgressAt = Date.now();
  for (;;) {
    const state = await page.evaluate((): SweepPoll | null => {
      const dbg = (window as unknown as {
        __psDebug?: { graph: { running: boolean; progress: { done: number; total: number } | null } };
      }).__psDebug;
      if (!dbg) return null;
      return {
        running: dbg.graph.running,
        done: dbg.graph.progress?.done ?? -1,
        total: dbg.graph.progress?.total ?? -1,
      };
    });
    const elapsed = Date.now() - startedAt;
    if (state) {
      if (state.running) sawRunning = true;
      if (state.done !== lastDone) {
        lastDone = state.done;
        lastProgressAt = Date.now();
      }
      if (!state.running && (sawRunning || elapsed > 30_000)) return { ok: true };
      if (state.running && Date.now() - lastProgressAt > STALL_MS) {
        return {
          ok: false,
          reason: `sweep wedged at ${state.done}/${state.total} — no progress for ${Math.round(STALL_MS / 1000)}s`,
        };
      }
    }
    if (elapsed > CAP_MS) return { ok: false, reason: `sweep did not finish within ${Math.round(CAP_MS / 1000)}s` };
    await page.waitForTimeout(POLL_MS);
  }
}

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
    const wait = await waitForSweepEnd(page);
    wallTimes[replayId] = Math.round((Date.now() - started) / 1000);
    if (!wait.ok) {
      noticeByReplay[replayId] = wait.reason;
      pushErrorResults(replayId, [wait.reason]);
      throw new Error(`harness failure: ${wait.reason}`);
    }
    const dbg = await page.evaluate(() => {
      const raw = (window as unknown as {
        __psDebug: { graph: { scores: unknown; notice: unknown; evalErrors: unknown }; analyses: unknown; gameReport: unknown; haxAlignment: unknown };
      }).__psDebug;
      return JSON.parse(JSON.stringify({
        scores: raw.graph.scores, notice: raw.graph.notice, evalErrors: raw.graph.evalErrors,
        analyses: raw.analyses, gameReport: raw.gameReport,
        haxAlignment: raw.haxAlignment ?? null,
      }));
    }) as ExtractedDebug;
    noticeByReplay[replayId] = dbg.notice;
    alignmentByReplay[replayId] = dbg.haxAlignment?.summary ?? null;
    evalErrorsByReplay[replayId] = dbg.evalErrors
      .map((error, index) => (error === null ? null : { turn: index + 1, error }))
      .filter((entry): entry is { turn: number; error: string } => entry !== null);
    if (DUMP) {
      const full = await page.evaluate(() =>
        JSON.parse(JSON.stringify((window as unknown as { __psDebug: unknown }).__psDebug)));
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(join(REPORT_DIR, `feedback-full-${replayId}.json`), JSON.stringify(full, null, 2));
    }

    // Harness reds — the ONLY reds on this path. A failed replay still
    // reaches the report as ERROR rows before the test goes red.
    const problems: string[] = [];
    if (log.violations.length > 0) problems.push(`unexpected external requests: ${log.violations.join(' ')}`);
    if (log.smogonMisses.length > 0) problems.push(`unpinned data.pkmn.cc requests (record once with FEEDBACK_RECORD=1): ${log.smogonMisses.join(' ')}`);
    if (!dbg.analyses) problems.push('debug handle exposed no analyses (sweep ended below the report threshold)');
    if (dbg.scores.filter(score => score !== null).length === 0) problems.push('sweep produced no scores');
    if (problems.length > 0) {
      pushErrorResults(replayId, problems);
      throw new Error(`harness failure: ${problems.join(' · ')}`);
    }

    for (const item of FEEDBACK_CORPUS.filter(entry => entry.replay === replayId)) {
      results.push(evaluateItem(item, dbg.analyses!, dbg.gameReport,
        [fixture.players[0], fixture.players[1]]));
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
    evalErrorsByReplay,
    alignmentByReplay,
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  const { markdown, json } = renderReport(results, meta);
  writeFileSync(join(REPORT_DIR, 'feedback-drift.md'), markdown);
  writeFileSync(join(REPORT_DIR, 'feedback-drift.json'), json);
  console.log(`\n${markdown}`);
});
