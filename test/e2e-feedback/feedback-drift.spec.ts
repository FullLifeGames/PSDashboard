import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { TurnAnalysis } from '../../packages/eval-engine/src/analysis';
import type { GameReport } from '../../packages/eval-engine/src/report';
import type { AlignmentSummary } from '../../packages/eval-engine/src/hax-alignment';
import { parseReplayLogWithObservations } from '../../packages/replay-core/src/protocol-parser';
import { finalPlayedTurn } from '../../packages/replay-core/src/replay-turns';
import { parseSearchBudget } from '../../packages/eval-engine/src/search/budget';
import { FEEDBACK_CENSUS_REPLAYS, FEEDBACK_CORPUS, FEEDBACK_REPLAYS } from './corpus';
import { evaluateItem, validateCorpus, type ClaimResult } from './claims';
import { installHermeticRoutes, RECORD } from './hermetic';
import { renderReport, type DriftMeta } from './report';
import { guardedEvaluate, isRendererDead, RENDERER_DEAD_REASON, waitForSweepEnd } from './sweep-wait';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORT_DIR = join(__dirname, '..', '..', 'docs', 'reports');
const DUMP = process.env.FEEDBACK_DUMP === '1';
/** Round 59: '0' | '1' | a lever list for the speed layer; unset keeps the app's default and no perf trace. */
const SIM_FAST = process.env.FEEDBACK_SIM_FAST;
/**
 * Round 61: a search-budget form (search/budget.ts syntax); unset keeps the app's default. Round 67 (T111):
 * parsed here before any page opens, so a typo stops the run instead of measuring the default (the browser
 * reads a bad form as the default).
 */
const SEARCH_BUDGET = process.env.FEEDBACK_SEARCH_BUDGET;
parseSearchBudget(SEARCH_BUDGET);
const perfByReplay: Record<string, unknown> = {};
/** Round 88 (T328): how long one single read of the debug handle may take before the page counts as dead. */
const READ_TIMEOUT_MS = 120_000;

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
  koMismatches: number;
}

const results: ClaimResult[] = [];
const wallTimes: Record<string, number> = {};
const noticeByReplay: Record<string, string | null> = {};
const evalErrorsByReplay: Record<string, { turn: number; error: string }[]> = {};
const alignmentByReplay: Record<string, AlignmentSummary | null> = {};
const koMismatchByReplay: Record<string, number> = {};

/** A replay that cannot be graded still shows up — as ERROR rows, never silence. */
function pushErrorResults(replayId: string, details: string[]) {
  const items = FEEDBACK_CORPUS.filter(entry => entry.replay === replayId);
  for (const item of items) results.push({ item, status: 'error', details });
  // A census-only replay has no rows to carry the failure: the notice line does.
  if (items.length === 0) noticeByReplay[replayId] = `harness failure: ${details.join(' · ')}`;
}

test('corpus is well-formed against the real fixtures', () => {
  const turnsByReplay = Object.fromEntries(FEEDBACK_REPLAYS.map(id => {
    const replay = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${id}.json`), 'utf-8')) as { log: string };
    return [id, finalPlayedTurn(parseReplayLogWithObservations(replay.log).snapshots)];
  }));
  expect(validateCorpus(FEEDBACK_CORPUS, turnsByReplay)).toEqual([]);
});

// The census replays (doubles, no corpus items) run last: the pinned six keep their place in every report.
for (const replayId of [...FEEDBACK_REPLAYS, ...FEEDBACK_CENSUS_REPLAYS]) {
  test(`drift: ${replayId}`, async ({ page }) => {
    const log = await installHermeticRoutes(page, replayId);
    if (SIM_FAST !== undefined) {
      await page.addInitScript(value => {
        localStorage.setItem('ps-replay-interceptor:sim-fast', value);
        localStorage.setItem('ps-replay-interceptor:perf', '1');
      }, SIM_FAST);
    }
    if (SEARCH_BUDGET !== undefined) {
      await page.addInitScript(value => {
        localStorage.setItem('ps-replay-interceptor:search-budget', value);
      }, SEARCH_BUDGET);
    }
    const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${replayId}.json`), 'utf-8')) as { players: string[] };
    const started = Date.now();
    await page.goto(`/?replay=${replayId}`);
    await expect(page.getByText(fixture.players[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const panel = page.locator('.ps-main-right .ps-eval-panel');
    await panel.locator('button', { hasText: 'Analyze game' }).click();
    const wait = await waitForSweepEnd(page);
    // Round 88 (T328): the single reads race a timeout as well; the generous bound covers the serialising of a full dump.
    const read = async <R>(fn: () => R | Promise<R>): Promise<R> => {
      try {
        return await guardedEvaluate(page, fn, { evalTimeoutMs: READ_TIMEOUT_MS });
      } catch (error) {
        if (!isRendererDead(error)) throw error;
        noticeByReplay[replayId] = RENDERER_DEAD_REASON;
        pushErrorResults(replayId, [RENDERER_DEAD_REASON]);
        throw new Error(`harness failure: ${RENDERER_DEAD_REASON}`, { cause: error });
      }
    };
    wallTimes[replayId] = Math.round((Date.now() - started) / 1000);
    if (SIM_FAST !== undefined && !(!wait.ok && wait.reason === RENDERER_DEAD_REASON)) {
      perfByReplay[replayId] = await read(() => (window as unknown as { __EVAL_PERF__?: unknown }).__EVAL_PERF__ ?? null);
    }
    if (!wait.ok) {
      noticeByReplay[replayId] = wait.reason;
      pushErrorResults(replayId, [wait.reason]);
      throw new Error(`harness failure: ${wait.reason}`);
    }
    const dbg = await read(() => {
      const raw = (window as unknown as {
        __psDebug: {
          graph: { scores: unknown; notice: unknown; evalErrors: unknown; results: ({ koDiagnostics?: unknown[] } | null)[] };
          analyses: unknown; gameReport: unknown; haxAlignment: unknown;
        };
      }).__psDebug;
      return JSON.parse(JSON.stringify({
        scores: raw.graph.scores, notice: raw.graph.notice, evalErrors: raw.graph.evalErrors,
        analyses: raw.analyses, gameReport: raw.gameReport,
        haxAlignment: raw.haxAlignment ?? null,
        koMismatches: raw.graph.results.reduce(
          (count: number, result) => count + (result?.koDiagnostics?.length ?? 0), 0),
      }));
    }) as ExtractedDebug;
    noticeByReplay[replayId] = dbg.notice;
    alignmentByReplay[replayId] = dbg.haxAlignment?.summary ?? null;
    koMismatchByReplay[replayId] = dbg.koMismatches;
    evalErrorsByReplay[replayId] = dbg.evalErrors
      .map((error, index) => (error === null ? null : { turn: index + 1, error }))
      .filter((entry): entry is { turn: number; error: string } => entry !== null);
    if (DUMP) {
      const full = await read(() =>
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
    settingsLine: `depth 2 · samples 3 · mode auto (fresh-context defaults)${RECORD ? ' · RECORD' : ''}${SIM_FAST !== undefined ? ` · sim-fast ${SIM_FAST}` : ''}${SEARCH_BUDGET !== undefined ? ` · budget ${SEARCH_BUDGET}` : ''}`,
    wallTimes,
    noticeByReplay,
    evalErrorsByReplay,
    alignmentByReplay,
    koMismatchByReplay,
    ...(SIM_FAST !== undefined ? { perfByReplay } : {}),
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  const { markdown, json } = renderReport(results, meta);
  writeFileSync(join(REPORT_DIR, 'feedback-drift.md'), markdown);
  writeFileSync(join(REPORT_DIR, 'feedback-drift.json'), json);
  console.log(`\n${markdown}`);
});
