import { createMatchupCache, unansweredMons, type MatchupCache } from '../eval-function.ts';
import {
  advancePosition, createRootPosition, positionBattle, type ChoiceOption, type SimPosition,
} from '../forward-model.ts';
import {
  applyTrendExtrapolation, applyTrendTiebreak, attachLines, cellKey, rankFromMatrix, selectExpansionCells,
  selectTieProbeCells, toResult, TOP_EXPANSION, type PvStep, type Ranked,
} from '../rank.ts';
import { koOddsForOptions } from '../cell-blend.ts';
import type { CellValue, SearchExecutor } from '../orchestrator.ts';
import type { EvalResult, EvalSettings, RankedChoice } from '../types.ts';
import { countFainted, leafValue, SEARCH_SEEDS } from './leaf.ts';
import { sampleCell } from './cell-sampler.ts';
import { isCombined } from './hints.ts';
import { expandPivotPairs, restrictOptions, searchOptions } from './options.ts';
import { attachRootPayload, koOddsMapsFor, type RootPayload } from './root-payload.ts';
import { recordDeepenedCell, type DeepeningState } from './deepening.ts';
import { forcedWinFor } from './forced-win.ts';
import { applyForcedWin, forcedWinInput } from './forced-win-apply.ts';
import { perfSync } from '../perf-trace.ts';
import { buildMatrix, cellValueMemo, maximinRows, minimaxColumns, type Matrix, type SearchCallbacks } from './matrix.ts';

/**
 * The sync search: the pruned depth-1 sub-search, the full root search with
 * its iterative deepening and horizon-trend layers, and the single-threaded
 * executor the orchestrator parity test pins against.
 */

/**
 * Score-focused depth-1 search: deepening sub-searches only consume the
 * score, the interval, and each side's top choice — so maximin permits
 * exact alpha/beta row and column cutoffs over an on-demand cell memo.
 * Results match `searchPosition` for those fields (ties resolve identically:
 * first encounter wins, matching the stable sort). The `expected` of the
 * returned tops approximates as the guarantee value; rankings beyond [0]
 * are not produced.
 */
export function subSearchDepth1(
  serializedBattle: string,
  settings: EvalSettings,
  matchupCache: MatchupCache = createMatchupCache(),
): EvalResult {
  const root = createRootPosition(serializedBattle);
  const battle = positionBattle(root);
  if (battle.ended) {
    return { score: leafValue(battle, matchupCache), interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }
  const tera = settings.tera ?? true;
  const p1Options = searchOptions(root, 'p1', { tera, keep: settings.keepPlayed?.p1Slots, sleepClause: settings.sleepClause });
  const p2Options = searchOptions(root, 'p2', { tera, keep: settings.keepPlayed?.p2Slots, sleepClause: settings.sleepClause });
  if (p1Options.length === 0 || p2Options.length === 0) {
    return searchPosition(serializedBattle, settings, undefined, matchupCache);
  }

  const cellValue = cellValueMemo(root, countFainted(battle), p1Options, p2Options, settings.samples, matchupCache);
  const { v1, bestI, bestIPunish } = maximinRows(cellValue, p1Options.length, p2Options.length);
  const { v2, bestJ, bestJPunish } = minimaxColumns(cellValue, p1Options.length, p2Options.length);
  // Pruned path: no full matrix exists, so ev falls back to the guarantee.
  const p1Top: RankedChoice = {
    choice: p1Options[bestI].choice, label: p1Options[bestI].label,
    worstCase: v1, expected: v1, ev: v1, punishedBy: p2Options[bestIPunish].label,
  };
  const p2Top: RankedChoice = {
    choice: p2Options[bestJ].choice, label: p2Options[bestJ].label,
    worstCase: -v2, expected: -v2, ev: -v2, punishedBy: p1Options[bestJPunish].label,
  };
  return {
    score: (v1 + v2) / 2,
    interval: Math.max(0, v2 - v1),
    depthCompleted: 1,
    perSide: { p1: [p1Top], p2: [p2Top] },
  };
}

/**
 * Dispatches deepening sub-searches: depth-1 leaves take the pruned path,
 * deeper sub-searches run full-rank but with restricted candidates (their
 * cost is quadratic in the option count and they only feed cell values).
 */
function subSearch(serializedBattle: string, settings: EvalSettings, matchupCache: MatchupCache): EvalResult {
  return settings.depth === 1
    ? subSearchDepth1(serializedBattle, settings, matchupCache)
    : searchPosition(serializedBattle, settings, undefined, matchupCache, true);
}

/** The root's option lists: restricted for deep sub-searches, pivot-expanded for the root matrix. */
function rootOptions(
  root: SimPosition,
  settings: EvalSettings,
  restrictCandidates: boolean,
): { p1Options: ChoiceOption[]; p2Options: ChoiceOption[] } {
  const tera = settings.tera ?? true;
  let p1Options = searchOptions(root, 'p1', { tera, keep: settings.keepPlayed?.p1Slots, sleepClause: settings.sleepClause });
  let p2Options = searchOptions(root, 'p2', { tera, keep: settings.keepPlayed?.p2Slots, sleepClause: settings.sleepClause });
  if (restrictCandidates) {
    p1Options = restrictOptions(root, 'p1', p1Options);
    p2Options = restrictOptions(root, 'p2', p2Options);
  } else {
    // Root matrix only: sub-searches keep the greedy pivot resolution.
    p1Options = expandPivotPairs(root, 'p1', p1Options);
    p2Options = expandPivotPairs(root, 'p2', p2Options);
  }
  return { p1Options, p2Options };
}

/**
 * The root's narrative payload, computed once per search and re-attached
 * to every partial result: the sampler's mismatch diagnostics, each root
 * option's analytic kill odds (vs the standing opposing active), and the
 * unanswered-mon profile (round 13). Sub-searches skip the odds and the
 * profile.
 */
function rootPayload(
  battle: ReturnType<typeof positionBattle>,
  matrix: Matrix,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  matchupCache: MatchupCache,
  restrictCandidates: boolean,
): RootPayload {
  const koOddsMaps = restrictCandidates ? null : koOddsMapsFor(p1Options, p2Options, {
    p1: koOddsForOptions(battle, 'p1', p1Options.map(option => option.choice)),
    p2: koOddsForOptions(battle, 'p2', p2Options.map(option => option.choice)),
  });
  const unanswered = restrictCandidates ? null : unansweredMons(battle, matchupCache);
  return { diagnostics: matrix.diagnostics, koOddsMaps, unanswered };
}

/** The sync search's deepening state: the shared record plus what the sync sub-searches need. */
interface Deepening extends DeepeningState {
  matrix: Matrix;
  rootValue: number;
  settings: EvalSettings;
  callbacks: SearchCallbacks | undefined;
  matchupCache: MatchupCache;
  ranked: Ranked;
}

/**
 * Deepens the first-seed child one level shallower with a single sample
 * (the child is seed-specific); its midpoint score replaces the cell's
 * static value. keepPlayed is a root-position hint — child positions have
 * their own choice space where those actions mean nothing.
 */
function deepenCell(state: Deepening, i: number, j: number, depth: number, expandedThisLevel: Set<number>): void {
  const child = state.matrix.children[i][j];
  const sub = subSearch(child.serialized, { ...state.settings, depth: (depth - 1) as 1 | 2, samples: 1, keepPlayed: undefined }, state.matchupCache);
  recordDeepenedCell(state, i, j, sub, depth, expandedThisLevel);
}

/**
 * Deepening a cell usually moves its value, which shifts a row's worst
 * case onto a sibling that is still shallow — so expansion iterates:
 * re-rank, chase the current punishing cells, repeat under a budget.
 * Cells are re-expanded per level (deeper sub-searches overwrite).
 */
function deepenLevel(state: Deepening, depth: number): boolean {
  const expandedThisLevel = new Set<number>();
  const budget = TOP_EXPANSION * 2;
  let used = 0;
  while (used < budget) {
    const wanted = selectExpansionCells(state.matrix, state.ranked, budget - used)
      .filter(([i, j]) => !expandedThisLevel.has(cellKey(i, j)));
    if (wanted.length === 0) break;

    for (const [i, j] of wanted) {
      if (state.callbacks?.shouldStop?.()) return true;
      deepenCell(state, i, j, depth, expandedThisLevel);
      used += 1;
      state.callbacks?.onProgress?.({ done: used, total: budget, depth });
    }
    state.ranked = rankFromMatrix(state.matrix, state.rootValue);
  }
  return false;
}

/**
 * Horizon-trend layers: root search over singles-shaped lists only
 * (combined doubles probes cost far more than a label swap is worth);
 * sub-searches skip them — ordering inside a tie cannot move a cell value.
 */
function applyTrendLayers(
  state: Deepening,
  result: EvalResult,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  restrictCandidates: boolean,
  stopped: boolean,
): void {
  if (!(!stopped && !restrictCandidates && !isCombined(p1Options) && !isCombined(p2Options))) return;
  for (const [i, j] of selectTieProbeCells(state.matrix, result, state.trendMap)) {
    const sub = subSearch(state.matrix.children[i][j].serialized, { ...state.settings, depth: 1, samples: 1, keepPlayed: undefined }, state.matchupCache);
    state.trendMap.set(cellKey(i, j), sub.score - state.staticValues[i][j]);
  }
  // 2b: fold the tied rows' trends into their values (no re-solve) — a
  // bleeding stall separates from a building switch BY VALUE (draft T50).
  applyTrendExtrapolation(state.matrix, result, state.trendMap);
  applyTrendTiebreak(state.matrix, result, state.trendMap);
}

export function searchPosition(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: SearchCallbacks,
  matchupCache: MatchupCache = createMatchupCache(),
  restrictCandidates = false,
): EvalResult {
  const root = createRootPosition(serializedBattle);
  const battle = positionBattle(root);
  if (battle.ended) {
    const score = leafValue(battle, matchupCache);
    return { score, interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const rootValue = leafValue(battle, matchupCache);
  const { p1Options, p2Options } = rootOptions(root, settings, restrictCandidates);
  const progress = { done: 0, total: Math.max(p1Options.length * p2Options.length, 1) };

  // Root matrices blend boundary cells analytically; restricted sub-searches
  // keep the plain seed average (their consumers read only score/tops).
  const matrix = buildMatrix(root, p1Options, p2Options, settings.samples, 1, callbacks, progress, matchupCache, !restrictCandidates);
  const payload = rootPayload(battle, matrix, p1Options, p2Options, matchupCache, restrictCandidates);
  // Pre-deepening statics: the trend baseline. Every trend the tiebreak
  // compares is uniformly 1-ply-vs-static — mixed ply counts inside one
  // comparison are the depth-asymmetry trap.
  const state: Deepening = {
    matrix, blends: matrix.blends, staticValues: matrix.values.map(row => [...row]), trendMap: new Map<number, number>(),
    pvByCell: new Map<number, PvStep[]>(), rootValue, settings, callbacks, matchupCache,
    ranked: rankFromMatrix(matrix, rootValue),
  };
  let result = toResult(state.ranked, 1);
  attachRootPayload(result, payload);
  callbacks?.onPartial?.(result);

  let stopped = false;
  for (let depth = 2; depth <= settings.depth; depth++) {
    if (callbacks?.shouldStop?.()) break;
    if (deepenLevel(state, depth)) {
      stopped = true;
      break;
    }
    state.ranked = rankFromMatrix(matrix, rootValue);
    attachLines(matrix, state.ranked, state.pvByCell);
    result = toResult(state.ranked, depth);
    attachRootPayload(result, payload);
    callbacks?.onPartial?.(result);
  }

  applyTrendLayers(state, result, p1Options, p2Options, restrictCandidates, stopped);
  if (!restrictCandidates && settings.prove !== false) {
    applyForcedWin(result, perfSync('prover', () => forcedWinFor(root, forcedWinInput(result, settings))));
  }
  return result;
}

/**
 * Single-threaded SearchExecutor over this module's sim primitives — the
 * reference implementation the orchestrator parity test pins against, and
 * the fallback when no worker pool is available.
 */
export function createLocalExecutor(serializedBattle: string): SearchExecutor {
  const matchupCache = createMatchupCache();
  const root = createRootPosition(serializedBattle);
  return {
    async choices(tera, keepPlayed, sleepClause) {
      const battle = positionBattle(root);
      // The choices RPC serves the orchestrated ROOT — pivot pairs expand
      // here exactly as in searchPosition (the sync path), or the app's
      // worker-pool matrix shows a bare "U-turn" row the sync pins never see.
      const p1 = expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera, keep: keepPlayed?.p1Slots, sleepClause }));
      const p2 = expandPivotPairs(root, 'p2', searchOptions(root, 'p2', { tera, keep: keepPlayed?.p2Slots, sleepClause }));
      return {
        p1, p2,
        rootValue: leafValue(battle, matchupCache),
        rootEnded: battle.ended,
        koOdds: {
          p1: koOddsForOptions(battle, 'p1', p1.map(option => option.choice)),
          p2: koOddsForOptions(battle, 'p2', p2.map(option => option.choice)),
        },
        unanswered: unansweredMons(battle, matchupCache),
      };
    },
    async evalCells(jobs, onDone) {
      const out: CellValue[] = [];
      const rootFainted = countFainted(positionBattle(root));
      let completed = 0;
      for (const job of jobs) {
        // evalCells only ever serves the orchestrated ROOT — blend like the
        // sync path's root matrix.
        const cell = sampleCell(root, rootFainted, job.p1Choice, job.p2Choice, job.samples, matchupCache, true);
        out.push({
          i: job.i, j: job.j, value: cell.value, ended: cell.ended,
          ...(cell.blend ? { blend: cell.blend } : {}),
          ...(cell.diagnostic ? { diagnostic: { ...cell.diagnostic, i: job.i, j: job.j } } : {}),
        });
        completed += 1;
        onDone?.(completed);
      }
      return out;
    },
    async subSearch(job) {
      const child = advancePosition(root, job.p1Choice, job.p2Choice, SEARCH_SEEDS[0]);
      return subSearch(child.serialized, job.settings, matchupCache);
    },
    async prove(input) {
      return forcedWinFor(root, input);
    },
  };
}
