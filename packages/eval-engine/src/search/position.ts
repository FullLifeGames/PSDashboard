import { createMatchupCache, unansweredMons, type MatchupCache, type StaticRuleset } from '../eval-function.ts';
import {
  advancePosition, createRootPosition, positionBattle, type ChoiceOption, type SimPosition,
} from '../forward-model.ts';
import {
  applyTrendExtrapolation, applyTrendTiebreak, attachLines, cellKey, meanTrend, rankFromMatrix, selectExpansionCells,
  selectTieProbeCells, toResult, TOP_EXPANSION, type PvStep, type Ranked,
} from '../rank.ts';
import { koOddsForOptions } from '../cell-blend.ts';
import { playedBoundsOf } from '../branch/action-bound.ts';
import type { CellValue, SearchExecutor } from '../orchestrator.ts';
import type { CellDraw, EvalCellJob, EvalResult, EvalSettings, RankedChoice } from '../types.ts';
import { countFainted, leafValue } from './leaf.ts';
import { cellSeeds } from './root-quantile.ts';
import { sampleCell, type CellSample } from './cell-sampler.ts';
import { probeDraw } from './trend-probe.ts';
import { deepenVerifiedCell, lightOptions, VERIFY_CHEAP, VERIFY_DEEPEN_COVER, VERIFY_LIGHT, VERIFY_PLAIN_DRAWS, type CheapDeepening } from './verify-cell.ts';
import { isCombined } from './hints.ts';
import { expandPivotPairs, searchOptions } from './options.ts';
import { attachRootPayload, type RootPayload } from './root-payload.ts';
import { FORCED_ROOT_LEVEL, deepenWholeLevel, recordDeepenedCell, withStaticPicks, type DeepeningState } from './deepening.ts';
import { deepenForcedRoot, isForcedRoot } from './forced-root.ts';
import { forcedWinFor } from './forced-win.ts';
import { rootOptions, rootPayload } from './root-setup.ts';
import { applyForcedWin, forcedWinInput } from './forced-win-apply.ts';
import { perfCount, perfSync } from '../perf-trace.ts';
import { buildMatrix, cellValueMemo, maximinRows, minimaxColumns, type Matrix, type SearchCallbacks } from './matrix.ts';
import { benchOrder, callbacksToGiven, executorToGiven, resultToGiven } from './bench-order.ts';
import { playLines } from './lines.ts';


/** Score-focused depth-1 search with alpha/beta cutoffs: matches `searchPosition` in score, interval and tops only. */
export function subSearchDepth1(
  serializedBattle: string,
  settings: EvalSettings,
  matchupCache: MatchupCache = createMatchupCache(settings.ruleset),
  light = false,
): EvalResult {
  const root = createRootPosition(serializedBattle, settings.ruleset);
  const battle = positionBattle(root);
  if (battle.ended) {
    return { score: leafValue(battle, matchupCache), interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }
  const tera = settings.tera ?? true;
  const full1 = searchOptions(root, 'p1', { tera, keep: settings.keepPlayed?.p1Slots, sleepClause: settings.sleepClause });
  const full2 = searchOptions(root, 'p2', { tera, keep: settings.keepPlayed?.p2Slots, sleepClause: settings.sleepClause });
  const p1Options = light ? lightOptions(root, 'p1', full1) : full1;
  const p2Options = light ? lightOptions(root, 'p2', full2) : full2;
  if (p1Options.length === 0 || p2Options.length === 0) {
    return searchOn(serializedBattle, settings, undefined, matchupCache);
  }

  const cellValue = cellValueMemo(root, countFainted(battle), p1Options, p2Options, settings.samples, matchupCache);
  const { v1, bestI, bestIPunish } = maximinRows(cellValue, p1Options.length, p2Options.length);
  const { v2, bestJ, bestJPunish } = minimaxColumns(cellValue, p1Options.length, p2Options.length);
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

function subSearch(serializedBattle: string, settings: EvalSettings, matchupCache: MatchupCache): EvalResult {
  return settings.depth === 1
    ? subSearchDepth1(serializedBattle, settings, matchupCache)
    : searchOn(serializedBattle, settings, undefined, matchupCache, true);
}

interface Deepening extends DeepeningState {
  matrix: Matrix;
  root: SimPosition;
  baseDraws: Map<number, CellDraw[]>;
  rootValue: number;
  settings: EvalSettings;
  callbacks: SearchCallbacks | undefined;
  matchupCache: MatchupCache;
  ranked: Ranked;
}

// keepPlayed is a root-position hint: child positions have their own choice space.
function cellSubSearch(state: Deepening, i: number, j: number, depth: number): EvalResult {
  const child = state.matrix.children[i][j];
  return withStaticPicks(subSearch(child.serialized, { ...state.settings, depth: (depth - 1) as 1 | 2, samples: 1, keepPlayed: undefined }, state.matchupCache), child);
}

function deepenLevel(state: Deepening, depth: number, wholeLevel: boolean): boolean {
  if (wholeLevel) return deepenWholeLevel(state, depth, (i, j) => cellSubSearch(state, i, j, depth));
  const expandedThisLevel = new Set<number>();
  const budget = TOP_EXPANSION * 2;
  let used = 0;
  while (used < budget) {
    const wanted = selectExpansionCells(state.matrix, state.ranked, budget - used)
      .filter(([i, j]) => !expandedThisLevel.has(cellKey(i, j)));
    if (wanted.length === 0) break;

    for (const [i, j] of wanted) {
      if (state.callbacks?.shouldStop?.()) return true;
      recordDeepenedCell(state, i, j, cellSubSearch(state, i, j, depth), depth, expandedThisLevel);
      used += 1;
      state.callbacks?.onProgress?.({ done: used, total: budget, depth });
    }
    state.ranked = rankFromMatrix(state.matrix, state.rootValue);
  }
  return false;
}

// Root search with singles-shaped lists only (doubles combo probes cost more than a swap is worth); sub-searches skip.
// A decisive cell of several draws is probed from each base draw against its own leaf: one draw vs the mean is noise.
function applyTrendLayers(
  state: Deepening,
  result: EvalResult,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  restrictCandidates: boolean,
  stopped: boolean,
): void {
  if (!(!stopped && !restrictCandidates && !isCombined(p1Options) && !isCombined(p2Options))) return;
  const settings: EvalSettings = { ...state.settings, depth: 1, samples: 1, keepPlayed: undefined };
  const search = (serialized: string) => subSearch(serialized, settings, state.matchupCache);
  for (const [i, j] of selectTieProbeCells(state.matrix, result, state.trendMap)) {
    const draws = state.baseDraws.get(cellKey(i, j));
    const trend = draws
      ? meanTrend(draws.map(draw => probeDraw(state.root, p1Options[i].choice, p2Options[j].choice, draw, search, state.matchupCache).trend))
      : search(state.matrix.children[i][j].serialized).score - state.staticValues[i][j];
    state.trendMap.set(cellKey(i, j), trend);
  }
  applyTrendExtrapolation(state.matrix, result, state.trendMap);
  applyTrendTiebreak(state.matrix, result, state.trendMap);
}

/** The root search on the canonical bench order; choices, partials included, come back in the given board's slots. */
export function searchPosition(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: SearchCallbacks,
  matchupCache: MatchupCache = createMatchupCache(settings.ruleset),
  restrictCandidates = false,
): EvalResult {
  const order = restrictCandidates ? null : benchOrder(serializedBattle);
  if (!order) return searchOn(serializedBattle, settings, callbacks, matchupCache, restrictCandidates);
  return resultToGiven(order, searchOn(order.serialized, settings, callbacksToGiven(order, callbacks), matchupCache, restrictCandidates));
}

function deepenRoot(
  state: Deepening, root: SimPosition, payload: RootPayload, first: EvalResult, restrictCandidates: boolean,
): { result: EvalResult; stopped: boolean } {
  const { matrix, rootValue, callbacks, settings } = state;
  let result = first;
  let stopped = false;
  let firstLevel = 2;
  if (!restrictCandidates && isForcedRoot(root)) {
    firstLevel = FORCED_ROOT_LEVEL + 1;
    stopped = deepenForcedRoot(state, (serialized, turn) => searchPosition(serialized, turn, undefined, state.matchupCache));
    if (!stopped) {
      state.ranked = rankFromMatrix(matrix, rootValue);
      attachLines(matrix, state.ranked, state.pvByCell);
      result = toResult(state.ranked, FORCED_ROOT_LEVEL);
      attachRootPayload(result, payload);
      callbacks?.onPartial?.(result);
    }
  }
  for (let depth = firstLevel; depth <= settings.depth && !stopped; depth++) {
    if (callbacks?.shouldStop?.()) break;
    if (deepenLevel(state, depth, !restrictCandidates && depth === 2)) {
      stopped = true;
      break;
    }
    state.ranked = rankFromMatrix(matrix, rootValue);
    attachLines(matrix, state.ranked, state.pvByCell);
    result = toResult(state.ranked, depth);
    attachRootPayload(result, payload);
    callbacks?.onPartial?.(result);
  }
  return { result, stopped };
}

function searchOn(
  serializedBattle: string,
  settings: EvalSettings,
  callbacks?: SearchCallbacks,
  matchupCache: MatchupCache = createMatchupCache(settings.ruleset),
  restrictCandidates = false,
): EvalResult {
  const root = createRootPosition(serializedBattle, settings.ruleset);
  const battle = positionBattle(root);
  if (battle.ended) {
    const score = leafValue(battle, matchupCache);
    return { score, interval: 0, depthCompleted: settings.depth, perSide: { p1: [], p2: [] } };
  }

  const rootValue = leafValue(battle, matchupCache);
  const { p1Options, p2Options } = rootOptions(root, settings, restrictCandidates);
  const progress = { done: 0, total: Math.max(p1Options.length * p2Options.length, 1) };

  // Root matrices blend boundary cells analytically; restricted sub-searches keep the plain seed average.
  const matrix = buildMatrix(root, p1Options, p2Options, settings.samples, 1, callbacks, progress, matchupCache, !restrictCandidates);
  const payload = rootPayload(battle, matrix, p1Options, p2Options, matchupCache, restrictCandidates, settings);
  // Pre-deepening statics: the trend baseline; every trend the tiebreak compares is 1-ply-vs-static, mixed ply counts
  // in one comparison are a depth-asymmetry trap.
  const state: Deepening = {
    matrix, blends: matrix.blends, staticValues: matrix.values.map(row => [...row]), trendMap: new Map<number, number>(),
    pvByCell: new Map<number, PvStep[]>(), root, baseDraws: matrix.baseDraws, rootValue, settings, callbacks, matchupCache,
    ranked: rankFromMatrix(matrix, rootValue),
  };
  let result = toResult(state.ranked, 1);
  attachRootPayload(result, payload);
  callbacks?.onPartial?.(result);

  const levels = deepenRoot(state, root, payload, result, restrictCandidates);
  result = levels.result;
  const { stopped } = levels;

  applyTrendLayers(state, result, p1Options, p2Options, restrictCandidates, stopped);
  if (!restrictCandidates && settings.prove !== false) {
    applyForcedWin(result, perfSync('prover', () => forcedWinFor(root, forcedWinInput(result, settings))));
  }
  return result;
}

/** The single-threaded SearchExecutor, the orchestrator's reference and fallback; one position under one rule set. */
export function createLocalExecutor(serializedBattle: string, ruleset: StaticRuleset = 'standard'): SearchExecutor {
  const order = benchOrder(serializedBattle);
  const lines: SearchExecutor['lines'] = async input => playLines(serializedBattle, ruleset, input);
  if (!order) return { ...localExecutorOn(serializedBattle, ruleset), lines };
  // the lines replay on the given board (their choices and slot choices name its bench), not on the canonical one
  return { ...executorToGiven(order, localExecutorOn(order.serialized, ruleset)), lines };
}

function deepenVerifyJob(
  value: CellValue, cell: CellSample, deepen: EvalSettings, matchupCache: MatchupCache, gameType: 'singles' | 'doubles',
): void {
  const full = (child: SimPosition) => { perfCount('verify-sub-full'); return subSearch(child.serialized, deepen, matchupCache).score; };
  const mode = VERIFY_CHEAP[gameType];
  const cheap: CheapDeepening | undefined = mode === 'off' ? undefined : {
    price: child => { perfCount('verify-sub-light'); return subSearchDepth1(child.serialized, deepen, matchupCache, true).score; },
    statesOnly: mode === 'states',
    minWeight: VERIFY_LIGHT.minWeight,
  };
  deepenVerifiedCell(value, cell, full, VERIFY_DEEPEN_COVER[gameType], cheap);
}

function cellValueOf(job: EvalCellJob, cell: CellSample): CellValue {
  return {
    i: job.i, j: job.j, value: cell.value, ended: cell.ended,
    ...(cell.blend ? { blend: cell.blend } : {}),
    ...(cell.diagnostic ? { diagnostic: { ...cell.diagnostic, i: job.i, j: job.j } } : {}),
    ...(cell.baseDraws ? { baseDraws: cell.baseDraws } : {}),
  };
}

function localExecutorOn(serializedBattle: string, ruleset: StaticRuleset): SearchExecutor {
  const matchupCache = createMatchupCache(ruleset);
  const root = createRootPosition(serializedBattle, ruleset);
  return {
    async choices(tera, keepPlayed, sleepClause) {
      const battle = positionBattle(root);
      // Pivot pairs expand here as in searchPosition, or the worker-pool matrix shows a bare "U-turn" row.
      const p1 = expandPivotPairs(root, 'p1', searchOptions(root, 'p1', { tera, keep: keepPlayed?.p1Slots, sleepClause }));
      const p2 = expandPivotPairs(root, 'p2', searchOptions(root, 'p2', { tera, keep: keepPlayed?.p2Slots, sleepClause }));
      const playedBounds = playedBoundsOf(battle, keepPlayed?.fell);
      return {
        p1, p2,
        rootValue: leafValue(battle, matchupCache),
        rootEnded: battle.ended,
        koOdds: {
          p1: koOddsForOptions(battle, 'p1', p1.map(option => option.choice)),
          p2: koOddsForOptions(battle, 'p2', p2.map(option => option.choice)),
        },
        unanswered: unansweredMons(battle, matchupCache),
        ...(playedBounds ? { playedBounds } : {}),
        ...(isForcedRoot(root) ? { forced: true } : {}),
      };
    },
    async evalCells(jobs, onDone) {
      const out: CellValue[] = [];
      const rootFainted = countFainted(positionBattle(root));
      const gameType = positionBattle(root).gameType === 'doubles' ? 'doubles' : 'singles';
      let completed = 0;
      for (const job of jobs) {
        if (job.plain) {
          const child = advancePosition(root, job.p1Choice, job.p2Choice, cellSeeds(root, job.p1Choice, job.p2Choice)[0]);
          const battle = positionBattle(child);
          const deeper = job.deepen !== undefined && !battle.ended;
          if (deeper) perfCount('answer-sub-light');
          const value = deeper ? subSearchDepth1(child.serialized, job.deepen!, matchupCache, true).score : leafValue(battle, matchupCache);
          out.push({ i: job.i, j: job.j, value, ended: battle.ended });
          completed += 1;
          onDone?.(completed);
          continue;
        }
        const { deepen } = job;
        const cell = sampleCell(root, rootFainted, job.p1Choice, job.p2Choice, job.samples, matchupCache, true, deepen ? VERIFY_PLAIN_DRAWS : undefined);
        const value = cellValueOf(job, cell);
        if (deepen) deepenVerifyJob(value, cell, deepen, matchupCache, gameType);
        out.push(value);
        completed += 1;
        onDone?.(completed);
      }
      return out;
    },
    async subSearch(job) {
      if (job.draw) return probeDraw(root, job.p1Choice, job.p2Choice, job.draw, serialized => subSearch(serialized, job.settings, matchupCache), matchupCache);
      const child = advancePosition(root, job.p1Choice, job.p2Choice, cellSeeds(root, job.p1Choice, job.p2Choice)[0]);
      if (job.turn) return searchPosition(child.serialized, job.settings, undefined, matchupCache);
      return withStaticPicks(subSearch(child.serialized, job.settings, matchupCache), child);
    },
    async prove(input) {
      return forcedWinFor(root, input);
    },
  };
}
