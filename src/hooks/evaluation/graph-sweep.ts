import { useCallback, useRef, useState } from 'react';
import {
  type TurnSensitivity, type TurnVerification, type LeadEvalData, type ReplacementEvalData, type PlayedTurn, perfReport, perfReset,
  perfSpan, selectKeyTurns, type EvalPreferences, type EvalResult, type EvalSettings, teraKey,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { evalStoreKey, loadStoredEval, loadStoredEvalsByPrefix, saveStoredEval } from '../../lib/eval-cache-store';
import { resolveAutoLeadSettings, type TurnEvalSettings } from './prefs';
import type { CachedEval } from './single-eval';
import type { GraphSweepParams, SweepData, SweepEnv, SweepSettings } from './sweep-types';
import { sweepTurns } from './sweep-core';
import { evaluateReplacements } from './sweep-replacements';
import { coverageNotice, makePositionSource } from './sweep-positions';

export type { GraphSweepParams } from './sweep-types';
export { coverageNotice };

/**
 * The ⚠ line's second half: acquisition gaps keep coverageNotice's wording,
 * eval-layer gaps (live position, throwing evaluation) append their count
 * and the first reason — without this they were invisible (653785 lost
 * 16 of 26 turns with the notice staying null).
 */
export function withEvalGapNotice(
  acquisition: string | null, evalErrors: (string | null)[],
): string | null {
  const failed = evalErrors.filter((message): message is string => message !== null);
  if (failed.length === 0) return acquisition;
  const sentence = `${failed.length} turn${failed.length === 1 ? '' : 's'} had a live position but could not be evaluated (first error: "${failed[0]}").`;
  return acquisition ? `${acquisition} ${sentence}` : sentence;
}

export interface EvalGraphState {
  /** scores[t-1] = score at turn t; null = not evaluated (gap). */
  scores: (number | null)[];
  /** Full per-turn results for the analysis view. */
  results: (EvalResult | null)[];
  /** What produced each result (fast scan vs configured settings). */
  settings: (TurnEvalSettings | null)[];
  /** Fainted fraction at each swept turn's position — the auto mode's routing signal. */
  faintedFractions: (number | null)[];
  played: (PlayedTurn | null)[];
  playedOutcome: (number | null)[];
  /** Depth+1 verification of flagged misplays (null = nothing flagged / not run). */
  verified: (TurnVerification | null)[];
  /** Item-sensitivity probes per turn (null = nothing to probe / not run). */
  sensitivity: (TurnSensitivity | null)[];
  /**
   * Per-turn eval-layer failure: the position existed but its evaluation
   * threw (evalErrors[t-1] = message). Acquisition gaps stay in `notice` —
   * a turn never carries both. Cleared the moment any pass scores the turn.
   */
  evalErrors: (string | null)[];
  /** Turn 0 (team preview) evaluation — null when unavailable or not swept. */
  lead: LeadEvalData | null;
  /**
   * Round 79 (T290): the replacement points after a knockout, under the card of the turn that follows it (replacements[t - 1]
   * holds what happened between turn t - 1 and turn t, in request order). Null = none or not priced; absent = no sweep ran.
   */
  replacements?: (ReplacementEvalData[] | null)[];
  /**
   * Why the line is short, when it is: the single-pass acquisition only
   * reached part of the game (a diverging reconstruction). Silence here
   * used to leave the panel showing an unexplained empty graph.
   */
  notice: string | null;
  running: boolean;
  progress: { done: number; total: number } | null;
  /**
   * Round 77 (C1): set when a single evaluation took over while the sweep was running; the sweep's status names
   * where it stopped. Any new sweep or a clear resets it. Absent or null = nothing was stopped.
   */
  stopped?: { done: number; total: number } | null;
}

/** The persisted-between-sweeps slice of the graph state (range sweeps merge into it). */
export type GraphData = Pick<EvalGraphState, 'scores' | 'results' | 'settings' | 'faintedFractions' | 'played' | 'playedOutcome' | 'verified' | 'sensitivity' | 'evalErrors' | 'lead' | 'replacements'>;

const emptyGraphState = (): EvalGraphState => ({
  scores: [], results: [], settings: [], faintedFractions: [], played: [], playedOutcome: [], verified: [], sensitivity: [], evalErrors: [], lead: null, replacements: [],
  notice: null, running: false, progress: null,
});

/** Copy of the previous run's array when it is being kept, else a null-filled fresh one. */
function carriedArray<T>(kept: T[] | undefined, turns: number): (T | null)[] {
  return kept ? [...kept] : new Array(turns).fill(null);
}

/** Working arrays for one sweep: fresh, or copies of the previous graph when the game length matches. */
function buildSweepData(params: GraphSweepParams, previous: GraphData | null): SweepData {
  const keepPrevious = previous !== null && previous.scores.length === params.turns;
  const kept = <T>(array: T[] | undefined): T[] | undefined => (keepPrevious ? array : undefined);
  const keptSized = <T>(array: T[] | undefined): T[] | undefined =>
    (keepPrevious && array?.length === params.turns ? array : undefined);
  return {
    scores: carriedArray(kept(previous?.scores), params.turns),
    results: carriedArray(kept(previous?.results), params.turns),
    turnSettings: carriedArray(keptSized(previous?.settings), params.turns),
    faintedFractions: carriedArray(keptSized(previous?.faintedFractions), params.turns),
    played: carriedArray(kept(previous?.played), params.turns),
    playedOutcome: carriedArray(kept(previous?.playedOutcome), params.turns),
    verified: carriedArray(keptSized(previous?.verified), params.turns),
    sensitivity: carriedArray(keptSized(previous?.sensitivity), params.turns),
    evalErrors: carriedArray(keptSized(previous?.evalErrors), params.turns),
    lead: keepPrevious ? previous.lead : null,
    replacements: carriedArray(keptSized(previous?.replacements), params.turns),
    notice: null,
  };
}

/** The lead evaluation's cache layers (memory, then the persisted store). */
async function loadLeadResult(
  env: SweepEnv, lead0: TurnEvalSettings, key: string, storeKey: string,
): Promise<'abort' | EvalResult | null> {
  let hit = env.cacheRef.current.get(key);
  if (!(hit && hit.depth === lead0.depth && hit.samples === lead0.samples && hit.mode === lead0.mode && teraKey(hit.tera) === teraKey(env.params.tera))) {
    const stored = env.prefetched ? (env.prefetched.get(storeKey) ?? null) : await loadStoredEval(storeKey);
    if (env.runRef.current !== env.runId) return 'abort';
    hit = stored ? { result: stored.result, depth: lead0.depth, samples: lead0.samples, mode: lead0.mode, tera: env.params.tera } : undefined;
    if (hit) env.cacheRef.current.set(key, hit);
  }
  return hit?.result ?? null;
}

/** Search the team-preview position and persist the result. */
async function searchLeadResult(
  env: SweepEnv, leadSettings: AppEvalSettings, lead0: TurnEvalSettings, key: string, storeKey: string,
): Promise<'abort' | EvalResult | null> {
  try {
    const serialized = await env.params.acquirePreview!();
    if (env.runRef.current !== env.runId) return 'abort';
    if (!serialized) return null;
    env.clientRef.current ??= new EvalWorkerClient();
    const client = env.clientRef.current;
    const leadResult = await perfSpan('lead', () => client.evaluate(serialized, leadSettings));
    if (env.runRef.current !== env.runId) return 'abort';
    env.cacheRef.current.set(key, { result: leadResult, depth: lead0.depth, samples: lead0.samples, mode: lead0.mode, tera: env.params.tera });
    void saveStoredEval({
      key: storeKey, result: leadResult, depth: lead0.depth, samples: lead0.samples, mode: lead0.mode, tera: env.params.tera,
      savedAt: Date.now(),
    });
    return leadResult;
  } catch (err) {
    if (env.runRef.current !== env.runId) return 'abort';
    if (err instanceof Error && err.message === 'cancelled') return 'abort';
    // No turn 0 for this replay — the graph stands on its own.
    return null;
  }
}

/**
 * Turn 0: the lead decision, one extra evaluation at full settings —
 * after the graph so the game line appears first. false = aborted (the
 * caller must skip the finalize, exactly like the pre-split early return).
 */
async function evaluateLead(
  env: SweepEnv,
  sweep: { depth: EvalSettings['depth']; samples: EvalSettings['samples']; mode: EvalPreferences['mode'] },
  paintFinal: (running: boolean) => void,
): Promise<boolean> {
  if (!(env.params.acquirePreview && env.data.lead === null && env.runRef.current === env.runId)) return true;
  // Round 61: under auto the lead keeps the matrix whatever the turns run;
  // round 63: the budget's own lead matrix, apart from the early splits
  // (resolveAutoLeadSettings).
  const { depth, samples, mode } = sweep;
  const lead0 = mode === 'auto' ? resolveAutoLeadSettings() : { depth, samples, mode };
  const leadSettings: AppEvalSettings = { ...lead0, tera: env.params.tera, sleepClause: env.params.sleepClause, ruleset: env.params.ruleset };
  const key = env.params.cacheKeyFor(0);
  const storeKey = evalStoreKey(key, lead0.depth, lead0.samples, lead0.mode, env.params.tera);
  const cached = await loadLeadResult(env, lead0, key, storeKey);
  if (cached === 'abort') return false;
  let leadResult = cached;
  if (!leadResult) {
    const searched = await searchLeadResult(env, leadSettings, lead0, key, storeKey);
    if (searched === 'abort') return false;
    leadResult = searched;
  }
  if (leadResult) {
    env.data.lead = { result: leadResult, played: env.params.playedLeads ?? { p1: null, p2: null } };
    paintFinal(true);
  }
  return true;
}

/** The stages after the turn passes: the lead, then the replacement points. false = aborted. */
async function evaluateEnd(
  env: SweepEnv,
  sweep: { depth: EvalSettings['depth']; samples: EvalSettings['samples']; mode: EvalPreferences['mode'] },
  paintFinal: (running: boolean) => void,
): Promise<boolean> {
  return (await evaluateLead(env, sweep, paintFinal)) && (await evaluateReplacements(env, paintFinal));
}

/**
 * One store read for the whole run: every persisted eval of this replay
 * (all turns, engines, fingerprints) instead of one read per turn. false
 * = the run changed hands while the read was in flight.
 */
async function prefetchStore(env: SweepEnv): Promise<boolean> {
  const { storePrefix } = env.params;
  env.prefetched = storePrefix ? await perfSpan('cache-load', () => loadStoredEvalsByPrefix(storePrefix)) : null;
  return env.runRef.current === env.runId;
}

/**
 * Three-pass sweep: a fast depth-1 pass shapes the whole graph in
 * seconds, the configured settings then deepen the report-worthy
 * swings (both sides of each — analysis compares across them), and
 * finally EVERY remaining turn converges to the configured settings
 * too — the settings ARE the line, the fast pass is only the sketch
 * ("I cannot configure anything for the graph line", GPL). Badges
 * track the convergence; the monotone merge makes each pass safe.
 * Short ranges (on-demand turn analysis) go straight to full settings.
 */
async function runSweep(env: SweepEnv, opts: {
  from: number; to: number;
  depth: EvalSettings['depth']; samples: EvalSettings['samples']; mode: EvalPreferences['mode'];
  paintFinal: (running: boolean) => void;
}): Promise<void> {
  const { from, to, depth, samples, mode, paintFinal } = opts;
  if (!(await prefetchStore(env))) return;
  const rangeTurns: number[] = [];
  for (let turn = from; turn <= to; turn++) rangeTurns.push(turn);
  const fullSettings: SweepSettings = { depth, samples, mode, tera: env.params.tera, sleepClause: env.params.sleepClause, ruleset: env.params.ruleset };
  // The sketch skips the forced-win prover (round 35): every sketch is replaced by the full pass.
  const fastSettings: SweepSettings = { depth: 1, samples: 1, mode: 'matrix', tera: env.params.tera, sleepClause: env.params.sleepClause, ruleset: env.params.ruleset, prove: false };
  const isFast = depth === 1 && samples === 1 && mode === 'matrix';

  if (rangeTurns.length > 2 && !isFast) {
    if (!(await perfSpan('pass1-sketch', () => sweepTurns(env, rangeTurns, fastSettings, false)))) return;
    const keyTurns = selectKeyTurns(env.data.scores).filter(turn => turn >= from && turn <= to);
    if (keyTurns.length > 0 && !(await perfSpan('pass2-key-turns', () => sweepTurns(env, keyTurns, fullSettings, true)))) return;
    const keySet = new Set(keyTurns);
    const rest = rangeTurns.filter(turn => !keySet.has(turn));
    if (rest.length > 0 && !(await perfSpan('pass3-rest', () => sweepTurns(env, rest, fullSettings, true)))) return;
  } else if (!(await perfSpan('single-pass', () => sweepTurns(env, rangeTurns, fullSettings, true)))) {
    return;
  }

  if (!(await evaluateEnd(env, { depth, samples, mode }, paintFinal))) return;

  if (env.runRef.current === env.runId) {
    // The summary ⚠ line settles once, when the line is final.
    env.data.notice = withEvalGapNotice(env.data.notice, env.data.evalErrors);
    paintFinal(false);
    perfReport(`graph sweep ${from}-${to} of ${env.params.turns} turns`);
  }
}

/** The graph's state cell: shared by the sweep runner and the cancel path. */
export function useGraphState() {
  const [graph, setGraph] = useState<EvalGraphState>(emptyGraphState());
  /** Latest graph arrays, so partial (range) sweeps merge instead of wiping. */
  const graphDataRef = useRef<GraphData | null>(null);
  /**
   * cancel clears the sweep's running flag; the bumped run counter stops its work. A single evaluation that takes
   * over passes `superseded`, and the graph keeps where the sweep stopped (round 77, C1).
   */
  const stopGraphPaint = useCallback((superseded = false) => {
    setGraph(prev => {
      if (!prev.running) return prev;
      const stopped = superseded ? { done: prev.progress?.done ?? 0, total: prev.progress?.total ?? 0 } : null;
      return { ...prev, running: false, progress: null, stopped };
    });
  }, []);
  const clearGraph = useCallback(() => {
    graphDataRef.current = null;
    setGraph(emptyGraphState());
  }, []);
  return { graph, setGraph, graphDataRef, stopGraphPaint, clearGraph };
}

/**
 * Sequential background sweep evaluating turns for the game graph — the
 * whole game by default, or a sub-range (on-demand turn analysis). Range
 * results merge into the existing graph state.
 */
export function useGraphSweepRunner(env: {
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  prefsRef: React.RefObject<EvalPreferences>;
  cancel: () => void;
  setGraph: React.Dispatch<React.SetStateAction<EvalGraphState>>;
  graphDataRef: React.RefObject<GraphData | null>;
}) {
  const { runRef, clientRef, cacheRef, prefsRef, cancel, setGraph, graphDataRef } = env;
  return useCallback((params: GraphSweepParams) => {
    cancel();
    perfReset();
    const runId = ++runRef.current;
    const { depth, samples, mode } = prefsRef.current;
    const configuredMode = prefsRef.current.mode;
    const from = Math.max(1, params.from ?? 1);
    const to = Math.min(params.turns, params.to ?? params.turns);
    const data = buildSweepData(params, graphDataRef.current);
    const snapshot = () => {
      const out = {
        scores: [...data.scores], results: [...data.results], settings: [...data.turnSettings],
        faintedFractions: [...data.faintedFractions], played: [...data.played],
        playedOutcome: [...data.playedOutcome], verified: [...data.verified], sensitivity: [...data.sensitivity],
        evalErrors: [...data.evalErrors], lead: data.lead, replacements: [...data.replacements],
        notice: data.notice,
      };
      graphDataRef.current = out;
      return out;
    };
    const total = Math.max(0, to - from + 1);
    setGraph({ ...snapshot(), running: true, progress: { done: 0, total }, stopped: null });
    // Painting (snapshot + setGraph) is presentation only — the sweep's
    // own logic reads the local arrays, and every result also lands in the
    // caches. Per-turn painting made a long sweep pay a fresh copy of ten
    // whole-game arrays plus a React re-render for every single turn, so
    // routine paints are throttled; forced paints keep pass boundaries and
    // the final state exact.
    let lastPaintAt = 0;
    const paint = (progress: { done: number; total: number } | null, force = false) => {
      // A lane can finish a turn after this run was superseded — a stale
      // run must never repaint over the new one's state.
      if (runRef.current !== runId) return;
      const at = Date.now();
      if (!force && at - lastPaintAt < 200) return;
      lastPaintAt = at;
      setGraph({ ...snapshot(), running: true, progress, stopped: null });
    };
    const paintFinal = (running: boolean) => setGraph({ ...snapshot(), running, progress: null });
    const sweepEnv: SweepEnv = {
      params, runId, runRef, clientRef, cacheRef, configuredMode, data, paint,
      ...makePositionSource(params, data),
      prefetched: null,
    };
    void runSweep(sweepEnv, { from, to, depth, samples, mode, paintFinal });
  }, [cancel, prefsRef, runRef, clientRef, cacheRef, setGraph, graphDataRef]);
}
