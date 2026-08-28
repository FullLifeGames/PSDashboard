import { useCallback, useEffect, useRef, useState } from 'react';
import {
  matchPlayedSide, phantomStayIn, REGRET_THRESHOLD,
  type SensitivityProbe, type TurnSensitivity, type TurnVerification,
} from '../lib/eval/analysis';
import { patchSerializedItem, selectProbeCombos, type SensitivityTarget } from '../lib/eval/sensitivity';
import type { LeadEvalData } from '../lib/eval/leads';
import type { PlayedTurn } from '../lib/eval/played';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import { perfReport, perfReset, perfSpan } from '../lib/eval/perf-trace';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../lib/eval-cache-store';
import { selectKeyTurns } from '../lib/eval/graph';
import { AUTO_MCTS_FAINTED_FRACTION, type EvalPreferences, type EvalResult, type EvalSettings, type RankedChoice, type SearchProgress, type TeraAllowance } from '../lib/eval/types';
import { teraKey } from '../lib/eval/tera';

export type EvalStatus = 'idle' | 'reconstructing' | 'searching' | 'done' | 'stale' | 'error';

export interface EvaluateParams {
  /** Cache key for replay-view positions; null disables caching (branch mode). */
  cacheKey: string | null;
  /** Resolved Tera allowance (the panel pref resolved against the replay). */
  tera: TeraAllowance;
  /** Sleep Clause enforced for this replay (resolved from the branch format). */
  sleepClause?: boolean;
  /**
   * Produces the serialized position. A reconstruction-based acquire calls
   * reportReconstruct(turn, target) as it replays turns; the hook surfaces
   * that as reconstructProgress state.
   */
  acquire: (reportReconstruct: (turn: number, target: number) => void) => Promise<string>;
}

const PREFS_KEY = 'ps-replay-interceptor:eval-prefs';
// Default line engine: 'auto' — the grid-tuned measured best (matrix d1s1
// through the opening, the DUCT tree once AUTO_MCTS_FAINTED_FRACTION of all
// bodies fell). depth/samples apply when the user picks an explicit matrix
// mode; stored user prefs always win over this default.
const DEFAULT_PREFS: EvalPreferences = { depth: 2, samples: 3, mode: 'auto', auto: false, tera: 'auto' };

function loadPrefs(): EvalPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<EvalPreferences>;
    return {
      depth: parsed.depth === 1 ? 1 : 2,
      samples: parsed.samples === 1 || parsed.samples === 5 ? parsed.samples : 3,
      mode: parsed.mode === 'mcts' || parsed.mode === 'auto' ? parsed.mode : 'matrix',
      auto: !!parsed.auto,
      tera: parsed.tera === 'on' || parsed.tera === 'off' || parsed.tera === 'revealed' ? parsed.tera : 'auto',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Played-pair matching with the KO'd-before-acting stand-in: a side that
 * never got to act still prices its pair through the charitable
 * outcome-equivalent phantom (analysis.ts) — T14/T36 stop reading
 * "unclear". */
const matchOrPhantom = (result: EvalResult, side: 'p1' | 'p2', played: PlayedTurn | null): RankedChoice | null =>
  matchPlayedSide(result, side, played) ?? phantomStayIn(result, side, played);

/** A concrete engine — what actually runs and what stored results carry ('auto' resolves before dispatch). */
export type EngineMode = NonNullable<EvalSettings['mode']>;

/**
 * Resolve the auto mode at one position: the VERIFIED line configuration —
 * d1s1 matrix while boards are full, the DUCT tree once the fainted
 * fraction crosses the threshold. Auto is a complete engine spec (its
 * matrix side is pinned to the measured d1s1, independent of the depth
 * prefs, which apply to the explicit matrix modes only).
 */
export function resolveAutoTurnSettings(faintedFraction: number): TurnEvalSettings {
  return faintedFraction >= AUTO_MCTS_FAINTED_FRACTION
    ? { depth: 1, samples: 1, mode: 'mcts' }
    : { depth: 1, samples: 1, mode: 'matrix' };
}

/** Mirror of the engine's battleFaintedFraction on a serialized battle (sim-free for the UI chunk). */
export function serializedFaintedFraction(serialized: string): number {
  const battle = JSON.parse(serialized) as { sides?: { pokemon?: { hp?: number; fainted?: boolean }[] }[] };
  let fainted = 0;
  let total = 0;
  for (const side of battle.sides ?? []) {
    for (const pokemon of side.pokemon ?? []) {
      total += 1;
      if (pokemon.fainted || (pokemon.hp ?? 0) <= 0) fainted += 1;
    }
  }
  return total > 0 ? fainted / total : 0;
}

/**
 * The tier a flagged turn re-adjudicates at: matrix pairs one depth up.
 * ENGINE-INDEPENDENT — an MCTS-line flag verifies at the same matrix-d2
 * tier the d1 matrix line gets. Sound because the verdict statistic
 * (bestDeep − playedDeep vs the threshold) is internal to the deep pass,
 * and pair valuation under any settings already runs as matrix subsearches
 * (playedOutcomeSettings). null = no tier left (the ladder caps at the
 * engine's depth 3).
 */
export function verificationDeepSettings(settings: EvalSettings): EvalSettings | null {
  if ((settings.mode ?? 'matrix') === 'mcts') {
    return { ...settings, depth: 2, mode: 'matrix', keepPlayed: undefined };
  }
  if (settings.depth > 2) return null;
  return { ...settings, depth: (settings.depth + 1) as 2 | 3, mode: 'matrix', keepPlayed: undefined };
}

/**
 * Why the game line is short, worded by shape. The counts describe the
 * RECONSTRUCTION pass — one fast replay of the game that hands out every
 * turn's position — which settles seconds after "Analyze game" while the
 * per-turn evaluations are still streaming, so the wording must not claim
 * analysis that has not happened yet. A missing FINAL turn alone is the
 * cascade's mildest form (the simulated line reaches the game's end one
 * turn early — the draft replay does this) and gets a calm story without
 * set-correction advice; anything else is genuine divergence.
 */
export function coverageNotice(positions: (string | null)[]): string | null {
  const total = positions.length;
  const covered = positions.filter(Boolean).length;
  if (total === 0 || covered === total) return null;
  if (covered === 0) {
    return 'The replay could not be reconstructed from the guessed sets — no turn has a live position to analyze. Correcting items/moves via Edit Player/Opp usually fixes it.';
  }
  if (covered === total - 1 && positions[total - 1] === null) {
    return "The simulated replay reached the game's end one turn early, so the real game's final turn has no live position to analyze — the rest of the line is unaffected.";
  }
  return `The reconstruction diverged from the real game: ${covered} of ${total} turns could be reconstructed for analysis. Correcting items/moves via Edit Player/Opp usually fixes it.`;
}

/**
 * Eval-layer lifecycle guard: a failure is only a gap while the turn is
 * scoreless — the monotone sweep never lets a failing later pass talk over
 * an earlier score (the settings badges already say how converged a scored
 * turn is).
 */
export function recordEvalError(
  evalErrors: (string | null)[], scores: (number | null)[], turn: number, error: unknown,
): void {
  if (scores[turn - 1] !== null) return;
  evalErrors[turn - 1] = error instanceof Error ? error.message : String(error);
}

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

interface CachedEval {
  result: EvalResult;
  // Engine-typed: the UI only offers depth 1/2, but sweeps cache whatever
  // EvalSettings the engine ran with.
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
  tera: TeraAllowance;
  /** Engine expectation of the actually played pair (set by graph sweeps). */
  playedOutcome?: number | null;
  /** Depth+1 re-search of flagged misplays (null = checked, nothing flagged). */
  verified?: TurnVerification | null;
  /** Item-sensitivity probes for still-flagged sides (null = checked, none needed). */
  sensitivity?: TurnSensitivity | null;
}

export interface GraphSweepParams {
  /** Number of turns in the game (sizes the graph; sweep may cover less). */
  turns: number;
  /** Optional sub-range to sweep (on-demand analysis); defaults to 1..turns. */
  from?: number;
  to?: number;
  /** Resolved Tera allowance. */
  tera: TeraAllowance;
  /** Sleep Clause enforced for this replay (resolved from the branch format). */
  sleepClause?: boolean;
  cacheKeyFor(turn: number): string;
  acquireFor(turn: number): (report: (turn: number, target: number) => void) => Promise<string>;
  /**
   * Optional single-pass acquisition of ALL positions (index = turn − 1).
   * Preferred over acquireFor when present — one reconstruction instead of
   * one per turn. Only invoked once, on the first cache miss. `onPosition`
   * streams each position as it is captured so searches start immediately
   * instead of waiting for the full replay pass.
   */
  acquireAll?(
    report: (turn: number, target: number) => void,
    onPosition?: (turn: number, serialized: string) => void,
    onDiagnostic?: (message: string) => void,
  ): Promise<(string | null)[]>;
  /** What was actually played on this turn (parsed from the replay log). */
  playedFor(turn: number): PlayedTurn | null;
  /**
   * Turn 0: the serialized team-preview position, or null for formats
   * without preview. Present only on full-game sweeps.
   */
  acquirePreview?(): Promise<string | null>;
  /** The leads each side actually sent (species, slot order). */
  playedLeads?: { p1: string[] | null; p2: string[] | null };
  /**
   * Guessed-item mons per side with their usage-plausible alternative items
   * (rule-outs applied) — the sensitivity probes' search space. Absent =
   * probing disabled.
   */
  sensitivityTargetsFor?(side: 'p1' | 'p2'): SensitivityTarget[];
  /**
   * Engine-settings override for this sweep (the explicit think-deeper
   * escalation). The whole sweep runs at these settings instead of the
   * panel preferences — meant for short ranges.
   */
  settings?: TurnEvalSettings;
}

/** Sweep-level settings: like EvalSettings, but the mode may still be the unresolved 'auto'. */
type SweepSettings = Omit<EvalSettings, 'mode'> & { mode?: EvalPreferences['mode'] };

/** The engine settings that produced a stored per-turn result (always concrete — never 'auto'). */
export interface TurnEvalSettings {
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
}

/**
 * The turn's configured target engine: 'auto' resolves through the
 * position's fainted fraction when known; null = unresolvable (auto prefs
 * but the fraction was never recorded for this turn — callers stay
 * conservative until a sweep resolves it).
 */
const configuredTarget = (
  mode: EvalPreferences['mode'],
  faintedFraction: number | null | undefined,
): EngineMode | null =>
  mode !== 'auto' ? mode : faintedFraction == null ? null : resolveAutoTurnSettings(faintedFraction).mode;

/**
 * The stored result is SHALLOWER than the panel preferences — the turn can
 * be re-run at full settings (the explicit deepen button offers exactly
 * that). Deeper/heavier stored results never downgrade (a depth-2 result
 * stays shown under depth-1 prefs); that includes a matrix escalation of
 * depth ≥ 2 sitting on an MCTS-target turn — think-deeper's cross-engine
 * product is settled, not stale. Auto prefs resolve through the turn's
 * fainted fraction; with the fraction unknown the answer is conservative
 * (no upgrade claimed — the next sweep resolves it).
 */
export function needsSettingsUpgrade(
  stored: TurnEvalSettings | null,
  prefs: EvalPreferences,
  faintedFraction?: number | null,
): boolean {
  if (!stored) return true;
  const escalatedPastMcts = (target: EngineMode) =>
    target === 'mcts' && stored.mode === 'matrix' && stored.depth >= 2;
  if (prefs.mode === 'auto') {
    const target = configuredTarget('auto', faintedFraction);
    if (target === null) return false;
    const resolved = resolveAutoTurnSettings(faintedFraction!);
    if (stored.mode !== resolved.mode) return !escalatedPastMcts(resolved.mode);
    if (resolved.mode === 'mcts') return false;
    return stored.depth < resolved.depth || stored.samples < resolved.samples;
  }
  if (stored.mode !== prefs.mode) return !escalatedPastMcts(prefs.mode);
  if (prefs.mode === 'mcts') return false;
  return stored.depth < prefs.depth || stored.samples < prefs.samples;
}

/**
 * May a sweep pass replace the graph's stored per-turn data? Monotone merge:
 * a shallower result never overwrites a deeper one — the fast re-scan of a
 * later "Analyze game" must not downgrade an explicitly deepened turn.
 * Cross-mode results replace only when the incoming pass carries the
 * CONFIGURED engine mode (the user's stated intent beats a stale result
 * from the other engine) — except that a matrix escalation of depth ≥ 2
 * outranks the d1s1-grade MCTS tier in BOTH directions: the think-deeper
 * click's d2s3 pass LANDS on a stored MCTS turn even though matrix is not
 * that turn's configured engine, and once stored it survives the next
 * MCTS-target sweep. Auto resolves per turn via the fainted fraction;
 * unresolvable cross-mode conflicts keep the stored result (fail closed).
 */
export function supersedesStored(
  stored: TurnEvalSettings | null,
  incoming: TurnEvalSettings,
  configuredMode: EvalPreferences['mode'],
  faintedFraction?: number | null,
): boolean {
  if (!stored) return true;
  if (stored.mode !== incoming.mode) {
    if (incoming.mode === 'matrix' && incoming.depth >= 2 && stored.mode === 'mcts') return true;
    if (incoming.mode !== configuredTarget(configuredMode, faintedFraction)) return false;
    return !(incoming.mode === 'mcts' && stored.mode === 'matrix' && stored.depth >= 2);
  }
  if (incoming.mode === 'mcts') return true;
  return incoming.depth >= stored.depth && incoming.samples >= stored.samples;
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
   * Why the line is short, when it is: the single-pass acquisition only
   * reached part of the game (a diverging reconstruction). Silence here
   * used to leave the panel showing an unexplained empty graph.
   */
  notice: string | null;
  running: boolean;
  progress: { done: number; total: number } | null;
}

export function useEvaluation() {
  const [prefs, setPrefsState] = useState<EvalPreferences>(loadPrefs);
  const [status, setStatus] = useState<EvalStatus>('idle');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconstructProgress, setReconstructProgress] = useState<{ turn: number; target: number } | null>(null);
  const [graph, setGraph] = useState<EvalGraphState>({
    scores: [], results: [], settings: [], faintedFractions: [], played: [], playedOutcome: [], verified: [], sensitivity: [], evalErrors: [], lead: null,
    notice: null, running: false, progress: null,
  });

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const cacheRef = useRef(new Map<string, CachedEval>());
  /** Latest graph arrays, so partial (range) sweeps merge instead of wiping. */
  const graphDataRef = useRef<Pick<EvalGraphState, 'scores' | 'results' | 'settings' | 'faintedFractions' | 'played' | 'playedOutcome' | 'verified' | 'sensitivity' | 'evalErrors' | 'lead'> | null>(null);
  const runRef = useRef(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => () => {
    runRef.current += 1;
    clientRef.current?.dispose();
    clientRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    runRef.current += 1;
    clientRef.current?.cancel();
    setProgress(null);
    setReconstructProgress(null);
    setStatus(prev => {
      if (prev !== 'searching' && prev !== 'reconstructing') return prev;
      return resultRef.current ? 'stale' : 'idle';
    });
    setGraph(prev => (prev.running ? { ...prev, running: false, progress: null } : prev));
  }, []);

  const evaluate = useCallback((params: EvaluateParams) => {
    const { depth, samples, mode } = prefsRef.current;
    if (params.cacheKey) {
      const hit = cacheRef.current.get(params.cacheKey);
      if (hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera)) {
        runRef.current += 1;
        setResult(hit.result);
        setStatus('done');
        setError(null);
        setProgress(null);
        setReconstructProgress(null);
        return;
      }
    }

    const runId = ++runRef.current;
    setStatus('reconstructing');
    setError(null);
    setResult(null);
    setProgress(null);
    setReconstructProgress(null);

    void (async () => {
      try {
        // 'auto' needs the position before the engine is known — acquire
        // first and resolve; concrete modes keep the stored-eval fast path
        // that skips reconstruction entirely.
        let serialized: string | null = null;
        let resolved: TurnEvalSettings = mode === 'auto' ? resolveAutoTurnSettings(0) : { depth, samples, mode };
        if (mode === 'auto') {
          serialized = await params.acquire((turn, target) => {
            if (runRef.current === runId) setReconstructProgress({ turn, target });
          });
          if (runRef.current !== runId) return;
          resolved = resolveAutoTurnSettings(serializedFaintedFraction(serialized));
        }
        // Persistent cache: a result from a previous session for the same
        // position + settings skips reconstruction and search entirely.
        if (params.cacheKey) {
          const stored = await loadStoredEval(evalStoreKey(params.cacheKey, resolved.depth, resolved.samples, resolved.mode, params.tera));
          if (runRef.current !== runId) return;
          if (stored) {
            cacheRef.current.set(params.cacheKey, {
              result: stored.result, depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera,
              ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
            });
            setResult(stored.result);
            setStatus('done');
            return;
          }
        }

        if (serialized === null) {
          serialized = await params.acquire((turn, target) => {
            if (runRef.current === runId) setReconstructProgress({ turn, target });
          });
          if (runRef.current !== runId) return;
        }
        setStatus('searching');
        setReconstructProgress(null);

        clientRef.current ??= new EvalWorkerClient();
        const final = await clientRef.current.evaluate(serialized, { depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera, sleepClause: params.sleepClause }, {
          onProgress: update => {
            if (runRef.current === runId) setProgress(update);
          },
          onPartial: partial => {
            if (runRef.current === runId) setResult(partial);
          },
        });
        if (runRef.current !== runId) return;
        setResult(final);
        setStatus('done');
        setProgress(null);
        if (params.cacheKey) {
          cacheRef.current.set(params.cacheKey, { result: final, depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera });
          void saveStoredEval({
            key: evalStoreKey(params.cacheKey, resolved.depth, resolved.samples, resolved.mode, params.tera),
            result: final, depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera, savedAt: Date.now(),
          });
        }
      } catch (err) {
        if (runRef.current !== runId) return;
        if (err instanceof Error && err.message === 'cancelled') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        setProgress(null);
        setReconstructProgress(null);
      }
    })();
  }, []);

  const setPrefs = useCallback((next: EvalPreferences) => {
    const changed = next.depth !== prefsRef.current.depth ||
      next.samples !== prefsRef.current.samples ||
      next.mode !== prefsRef.current.mode ||
      next.tera !== prefsRef.current.tera;
    setPrefsState(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Storage full/blocked — the prefs still apply for this session.
    }
    if (changed) setStatus(prev => (prev === 'done' ? 'stale' : prev));
  }, []);

  const markStale = useCallback(() => {
    setStatus(prev => (prev === 'done' ? 'stale' : prev));
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStatus('idle');
    setResult(null);
    setError(null);
  }, [cancel]);

  /**
   * Sequential background sweep evaluating turns for the game graph — the
   * whole game by default, or a sub-range (on-demand turn analysis). Range
   * results merge into the existing graph state.
   */
  const runGraphSweep = useCallback((params: GraphSweepParams) => {
    cancel();
    perfReset();
    const runId = ++runRef.current;
    const { depth, samples, mode } = params.settings ?? prefsRef.current;
    // Cross-mode merge arbiter: the mode the USER configured, even when this
    // sweep runs an escalation override.
    const configuredMode = prefsRef.current.mode;
    const from = Math.max(1, params.from ?? 1);
    const to = Math.min(params.turns, params.to ?? params.turns);
    const previous = graphDataRef.current;
    const keepPrevious = previous !== null && previous.scores.length === params.turns;
    const scores: (number | null)[] = keepPrevious ? [...previous.scores] : new Array(params.turns).fill(null);
    const results: (EvalResult | null)[] = keepPrevious ? [...previous.results] : new Array(params.turns).fill(null);
    const turnSettings: (TurnEvalSettings | null)[] = keepPrevious && previous.settings?.length === params.turns
      ? [...previous.settings]
      : new Array(params.turns).fill(null);
    const faintedFractions: (number | null)[] = keepPrevious && previous.faintedFractions?.length === params.turns
      ? [...previous.faintedFractions]
      : new Array(params.turns).fill(null);
    const played: (PlayedTurn | null)[] = keepPrevious ? [...previous.played] : new Array(params.turns).fill(null);
    const playedOutcome: (number | null)[] = keepPrevious ? [...previous.playedOutcome] : new Array(params.turns).fill(null);
    const verified: (TurnVerification | null)[] = keepPrevious && previous.verified.length === params.turns
      ? [...previous.verified]
      : new Array(params.turns).fill(null);
    const sensitivity: (TurnSensitivity | null)[] = keepPrevious && previous.sensitivity?.length === params.turns
      ? [...previous.sensitivity]
      : new Array(params.turns).fill(null);
    const evalErrors: (string | null)[] = keepPrevious && previous.evalErrors?.length === params.turns
      ? [...previous.evalErrors]
      : new Array(params.turns).fill(null);
    let lead: LeadEvalData | null = keepPrevious ? previous.lead : null;
    let notice: string | null = null;
    const snapshot = () => {
      const data = {
        scores: [...scores], results: [...results], settings: [...turnSettings],
        faintedFractions: [...faintedFractions], played: [...played],
        playedOutcome: [...playedOutcome], verified: [...verified], sensitivity: [...sensitivity],
        evalErrors: [...evalErrors], lead,
        notice,
      };
      graphDataRef.current = data;
      return data;
    };
    const total = Math.max(0, to - from + 1);
    setGraph({ ...snapshot(), running: true, progress: { done: 0, total } });
    // Painting (snapshot + setGraph) is presentation only — the sweep's
    // own logic reads the local arrays, and every result also lands in the
    // caches. Per-turn painting made a long sweep pay a fresh copy of ten
    // whole-game arrays plus a React re-render for every single turn, so
    // routine paints are throttled; forced paints keep pass boundaries and
    // the final state exact.
    let lastPaintAt = 0;
    const paint = (progress: { done: number; total: number } | null, force = false) => {
      const at = Date.now();
      if (!force && at - lastPaintAt < 200) return;
      lastPaintAt = at;
      setGraph({ ...snapshot(), running: true, progress });
    };

    // Lazily-run single-pass acquisition, pipelined: positions stream out of
    // the ongoing reconstruction, so the first search starts after the first
    // captured turn instead of after the whole replay pass. Started at most
    // once; a failure fails every waiting turn instead of retrying.
    const arrived = new Map<number, string>();
    const waiters = new Map<number, { resolve(serialized: string): void; reject(error: unknown): void }[]>();
    let acquireStarted = false;
    let acquireSettled = false;
    let acquireError: unknown = null;
    const settleWaiters = () => {
      for (const [turn, list] of waiters) {
        for (const waiter of list) {
          const found = arrived.get(turn);
          if (found) waiter.resolve(found);
          else waiter.reject(acquireError ?? new Error(`No position captured for turn ${turn}.`));
        }
      }
      waiters.clear();
    };
    const acquireDiagnostics: string[] = [];
    const startAcquisition = () => {
      if (acquireStarted) return;
      acquireStarted = true;
      params.acquireAll!(() => {}, (turn, serialized) => {
        arrived.set(turn, serialized);
        for (const waiter of waiters.get(turn) ?? []) waiter.resolve(serialized);
        waiters.delete(turn);
      }, message => acquireDiagnostics.push(message)).then(positions => {
        positions.forEach((serialized, index) => {
          if (serialized) arrived.set(index + 1, serialized);
        });
        // An unexplained short line is the worst outcome: the sweep leaves
        // gaps for every turn the reconstruction never produced, and the
        // panel used to show that as a blank graph with no reason given.
        notice = coverageNotice(positions);
        if (acquireDiagnostics.length > 0) {
          const extra = acquireDiagnostics.join(' ');
          notice = notice ? `${notice} ${extra}` : extra;
        }
      }).catch(error => {
        acquireError = error;
        notice = `The replay could not be reconstructed: ${error instanceof Error ? error.message : String(error)}`;
      }).finally(() => {
        acquireSettled = true;
        settleWaiters();
      });
    };
    const positionFor = (turn: number): Promise<string> => perfSpan('position-wait', () => {
      if (!params.acquireAll) return params.acquireFor(turn)(() => {});
      const found = arrived.get(turn);
      if (found) return Promise.resolve(found);
      if (acquireSettled) {
        return Promise.reject(acquireError ?? new Error(`No position captured for turn ${turn}.`));
      }
      startAcquisition();
      return new Promise((resolve, reject) => {
        const list = waiters.get(turn) ?? [];
        list.push({ resolve, reject });
        waiters.set(turn, list);
      });
    });

    /**
     * Deep re-search before a misplay verdict sticks (chess.com's sacrifice
     * verification): for each side whose played choice trails the best by
     * the regret threshold, value the played and best pairs at the matrix
     * verification tier (verificationDeepSettings — the line engine that
     * raised the flag is irrelevant to the deep verdict). Flag checks are
     * pure — the position is only acquired when needed.
     */
    const verifyFlagged = async (
      getSerialized: () => Promise<string>,
      result: EvalResult,
      turnPlayed: PlayedTurn | null,
      settings: EvalSettings,
    ): Promise<TurnVerification | null> => {
      const deep = verificationDeepSettings(settings);
      if (!deep) return null;
      const p1Choice = matchOrPhantom(result, 'p1', turnPlayed);
      const p2Choice = matchOrPhantom(result, 'p2', turnPlayed);
      if (!p1Choice || !p2Choice) return null;
      const flaggedBest = (side: 'p1' | 'p2', chosen: RankedChoice): RankedChoice | null => {
        const best = result.perSide[side][0];
        return best && best.ev - chosen.ev >= REGRET_THRESHOLD ? best : null;
      };
      const p1Best = flaggedBest('p1', p1Choice);
      const p2Best = flaggedBest('p2', p2Choice);
      if (!p1Best && !p2Best) return null;
      const serialized = await getSerialized();
      clientRef.current ??= new EvalWorkerClient();
      const playedDeep = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice, deep);
      const verification: TurnVerification = {};
      if (p1Best) {
        verification.p1 = {
          playedDeep,
          bestDeep: await clientRef.current.evalPair(serialized, p1Best.choice, p2Choice.choice, deep),
        };
      }
      if (p2Best) {
        verification.p2 = {
          playedDeep,
          bestDeep: await clientRef.current.evalPair(serialized, p1Choice.choice, p2Best.choice, deep),
        };
      }
      return verification;
    };

    /**
     * Item-sensitivity probes for sides still flagged AFTER verification:
     * re-evaluate the played and best pairs with an opposing guessed item
     * swapped for its next usage candidates (≤2 combos per side = ≤4 extra
     * pair-evals). Probes run at the sweep's own settings; pair valuation is
     * engine-independent (an MCTS line's pairs value as matrix subsearches),
     * and the acquit statistic compares only probe EVs with each other.
     * Acquit-only downstream (analyzeTurn) — this only gathers evidence.
     */
    const probeSensitivity = async (
      getSerialized: () => Promise<string>,
      result: EvalResult,
      turnPlayed: PlayedTurn | null,
      settings: EvalSettings,
      turnVerified: TurnVerification | null,
    ): Promise<TurnSensitivity | null> => {
      if (!params.sensitivityTargetsFor) return null;
      const p1Choice = matchOrPhantom(result, 'p1', turnPlayed);
      const p2Choice = matchOrPhantom(result, 'p2', turnPlayed);
      if (!p1Choice || !p2Choice) return null;
      const probeSettings: EvalSettings = { ...settings, keepPlayed: undefined };
      const out: TurnSensitivity = {};
      for (const side of ['p1', 'p2'] as const) {
        const chosen = side === 'p1' ? p1Choice : p2Choice;
        const best = result.perSide[side][0];
        if (!best || best.ev - chosen.ev < REGRET_THRESHOLD) continue;
        // The deep pass already acquitted this side — nothing left to soften.
        const sign = side === 'p1' ? 1 : -1;
        const deepSide = turnVerified?.[side];
        if (deepSide && Math.max(0, sign * (deepSide.bestDeep - deepSide.playedDeep)) < REGRET_THRESHOLD) continue;
        const opposing = side === 'p1' ? 'p2' : 'p1';
        const targets = params.sensitivityTargetsFor(opposing);
        if (targets.length === 0) continue;
        const serialized = await getSerialized();
        const opposingPlayed = side === 'p1' ? p2Choice : p1Choice;
        const opposingLabels = [opposingPlayed.label, ...(result.perSide[opposing][0] ? [result.perSide[opposing][0].label] : [])];
        const combos = selectProbeCombos(serialized, opposing, targets, opposingLabels);
        const probes: SensitivityProbe[] = [];
        for (const combo of combos) {
          const patched = patchSerializedItem(serialized, opposing, combo.species, combo.item);
          if (!patched) continue;
          clientRef.current ??= new EvalWorkerClient();
          const playedEv = await clientRef.current.evalPair(patched, p1Choice.choice, p2Choice.choice, probeSettings);
          const bestEv = side === 'p1'
            ? await clientRef.current.evalPair(patched, best.choice, p2Choice.choice, probeSettings)
            : await clientRef.current.evalPair(patched, p1Choice.choice, best.choice, probeSettings);
          probes.push({ species: combo.species, item: combo.item, playedEv: sign * playedEv, bestEv: sign * bestEv });
        }
        if (probes.length > 0) out[side] = probes;
      }
      return out.p1 || out.p2 ? out : null;
    };

    /**
     * One sequential pass over `turnList` at `settings`; false = cancelled.
     * `verify` runs the depth+1 misplay verification — final-verdict passes
     * only, never the fast shaping pass (its results are provisional).
     */
    const sweepTurns = async (turnList: number[], settings: SweepSettings, verify: boolean): Promise<boolean> => {
      for (let index = 0; index < turnList.length; index++) {
        const turn = turnList[index];
        if (runRef.current !== runId) return false;
        // Resolve 'auto' to this turn's concrete engine BEFORE any cache or
        // store-key work — stored results only ever carry concrete modes.
        // The fainted fraction comes from the same serialized position the
        // engine will evaluate (the app-side mirror of the harness rule).
        let { depth, samples } = settings;
        let mode: EngineMode = settings.mode === 'auto' ? 'matrix' : (settings.mode ?? 'matrix');
        if (settings.mode === 'auto') {
          let fraction = faintedFractions[turn - 1];
          if (fraction === null) {
            try {
              fraction = serializedFaintedFraction(await positionFor(turn));
            } catch (err) {
              if (runRef.current !== runId) return false;
              if (err instanceof Error && err.message === 'cancelled') return false;
              // Reconstruction failed — leave the gap, as the eval path would.
              paint({ done: index + 1, total: turnList.length });
              continue;
            }
            if (runRef.current !== runId) return false;
            faintedFractions[turn - 1] = fraction;
          }
          ({ depth, samples, mode } = resolveAutoTurnSettings(fraction));
        }
        const key = params.cacheKeyFor(turn);
        const storeKey = evalStoreKey(key, depth, samples, mode, params.tera);
        const turnPlayed = params.playedFor(turn);
        played[turn - 1] = turnPlayed;
        const resolvedSettings: EvalSettings = {
          depth, samples, mode, tera: params.tera, sleepClause: params.sleepClause,
        };

        // Monotone merge: the graph already holds a deeper result for this
        // turn (an explicit deepen, a deeper prior sweep) — every stored
        // field stands and this pass skips the turn entirely.
        if (!supersedesStored(turnSettings[turn - 1], { depth, samples, mode }, configuredMode, faintedFractions[turn - 1])) {
          paint({ done: index + 1, total: turnList.length });
          continue;
        }

        let hit = cacheRef.current.get(key);
        if (!(hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera))) {
          // Second cache layer: results persisted by a previous session.
          const stored = await perfSpan('cache-load', () => loadStoredEval(storeKey));
          if (runRef.current !== runId) return false;
          hit = stored ? {
            result: stored.result, depth, samples, mode: mode, tera: params.tera,
            ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
            ...(stored.verified !== undefined ? { verified: stored.verified } : {}),
            ...(stored.sensitivity !== undefined ? { sensitivity: stored.sensitivity } : {}),
          } : undefined;
          if (hit) cacheRef.current.set(key, hit);
        }
        if (hit) {
          scores[turn - 1] = hit.result.score;
          evalErrors[turn - 1] = null;
          results[turn - 1] = hit.result;
          turnSettings[turn - 1] = { depth, samples, mode };
          // Entries written by single evaluations never computed the
          // played-pair expectation (undefined ≠ null = tried, unmatched) —
          // fill it in so the analysis gets its decision/chance split.
          let outcome: number | null | undefined = hit.playedOutcome;
          if (outcome === undefined) {
            outcome = null;
            const p1Choice = matchOrPhantom(hit.result, 'p1', turnPlayed);
            const p2Choice = matchOrPhantom(hit.result, 'p2', turnPlayed);
            if (p1Choice && p2Choice) {
              try {
                const serialized = await positionFor(turn);
                if (runRef.current !== runId) return false;
                clientRef.current ??= new EvalWorkerClient();
                const client = clientRef.current;
                outcome = await perfSpan('played-pair', () =>
                  client.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: params.tera, sleepClause: params.sleepClause }));
              } catch (err) {
                if (runRef.current !== runId) return false;
                if (err instanceof Error && err.message === 'cancelled') return false;
              }
              if (runRef.current !== runId) return false;
            }
            cacheRef.current.set(key, { ...hit, playedOutcome: outcome });
            void saveStoredEval({
              key: storeKey, result: hit.result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome, savedAt: Date.now(),
            });
          }
          playedOutcome[turn - 1] = outcome;
          // Verification backfill: cached entries from before the pass (or
          // written by single evaluations) never verified their flags.
          let turnVerified: TurnVerification | null | undefined = hit.verified;
          if (verify && turnVerified === undefined) {
            turnVerified = null;
            try {
              turnVerified = await perfSpan('verify', () => verifyFlagged(() => positionFor(turn), hit.result, turnPlayed, resolvedSettings));
            } catch (err) {
              if (runRef.current !== runId) return false;
              if (err instanceof Error && err.message === 'cancelled') return false;
            }
            if (runRef.current !== runId) return false;
            cacheRef.current.set(key, { ...cacheRef.current.get(key) ?? hit, verified: turnVerified });
            void saveStoredEval({
              key: storeKey, result: hit.result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome ?? null, verified: turnVerified, savedAt: Date.now(),
            });
          }
          if (turnVerified !== undefined) verified[turn - 1] = turnVerified;
          // Sensitivity backfill, same shape as the verification backfill.
          let turnSensitivity: TurnSensitivity | null | undefined = hit.sensitivity;
          if (verify && turnSensitivity === undefined) {
            turnSensitivity = null;
            try {
              turnSensitivity = await perfSpan('sensitivity', () => probeSensitivity(() => positionFor(turn), hit.result, turnPlayed, resolvedSettings, turnVerified ?? null));
            } catch (err) {
              if (runRef.current !== runId) return false;
              if (err instanceof Error && err.message === 'cancelled') return false;
            }
            if (runRef.current !== runId) return false;
            cacheRef.current.set(key, { ...cacheRef.current.get(key) ?? hit, sensitivity: turnSensitivity });
            void saveStoredEval({
              key: storeKey, result: hit.result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome ?? null, verified: turnVerified ?? null,
              sensitivity: turnSensitivity, savedAt: Date.now(),
            });
          }
          if (turnSensitivity !== undefined) sensitivity[turn - 1] = turnSensitivity;
        } else {
          // Acquisition failure = the coverage notice's story; only a
          // THROWING EVAL on a live position is an eval-layer gap.
          let acquired: string | null = null;
          try {
            acquired = await positionFor(turn);
          } catch (err) {
            if (runRef.current !== runId) return false;
            if (err instanceof Error && err.message === 'cancelled') return false;
            // Reconstruction failed — leave the gap, as before.
          }
          if (acquired !== null) {
            const serialized = acquired;
            try {
              if (runRef.current !== runId) return false;
              clientRef.current ??= new EvalWorkerClient();
              const client = clientRef.current;
              const keepPlayed = turnPlayed?.p1Slots || turnPlayed?.p2Slots ? turnPlayed : undefined;
              const result = await perfSpan(`evaluate[${mode}-d${depth}s${samples}]`, () =>
                client.evaluate(serialized, { depth, samples, mode, tera: params.tera, keepPlayed, sleepClause: params.sleepClause }));
              if (runRef.current !== runId) return false;
              scores[turn - 1] = result.score;
              evalErrors[turn - 1] = null;
              results[turn - 1] = result;
              turnSettings[turn - 1] = { depth, samples, mode };

              // The engine's expectation of the real choices — the decision
              // part of the coming swing (chance is the rest).
              let outcome: number | null = null;
              const p1Choice = matchOrPhantom(result, 'p1', turnPlayed);
              const p2Choice = matchOrPhantom(result, 'p2', turnPlayed);
              if (p1Choice && p2Choice) {
                try {
                  outcome = await perfSpan('played-pair', () =>
                    client.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: params.tera, sleepClause: params.sleepClause }));
                } catch (err) {
                  if (runRef.current !== runId) return false;
                  if (err instanceof Error && err.message === 'cancelled') return false;
                }
                if (runRef.current !== runId) return false;
              }
              playedOutcome[turn - 1] = outcome;

              let turnVerified: TurnVerification | null | undefined;
              let turnSensitivity: TurnSensitivity | null | undefined;
              if (verify) {
                turnVerified = null;
                try {
                  turnVerified = await perfSpan('verify', () => verifyFlagged(() => Promise.resolve(serialized), result, turnPlayed, resolvedSettings));
                } catch (err) {
                  if (runRef.current !== runId) return false;
                  if (err instanceof Error && err.message === 'cancelled') return false;
                }
                if (runRef.current !== runId) return false;
                verified[turn - 1] = turnVerified;
                turnSensitivity = null;
                try {
                  turnSensitivity = await perfSpan('sensitivity', () => probeSensitivity(() => Promise.resolve(serialized), result, turnPlayed, resolvedSettings, turnVerified ?? null));
                } catch (err) {
                  if (runRef.current !== runId) return false;
                  if (err instanceof Error && err.message === 'cancelled') return false;
                }
                if (runRef.current !== runId) return false;
                sensitivity[turn - 1] = turnSensitivity;
              }
              cacheRef.current.set(key, {
                result, depth, samples, mode: mode, tera: params.tera,
                playedOutcome: outcome,
                ...(turnVerified !== undefined ? { verified: turnVerified } : {}),
                ...(turnSensitivity !== undefined ? { sensitivity: turnSensitivity } : {}),
              });
              void saveStoredEval({
                key: storeKey, result, depth, samples, mode: mode, tera: params.tera,
                playedOutcome: outcome,
                ...(turnVerified !== undefined ? { verified: turnVerified } : {}),
                ...(turnSensitivity !== undefined ? { sensitivity: turnSensitivity } : {}),
                savedAt: Date.now(),
              });
            } catch (err) {
              if (runRef.current !== runId) return false;
              if (err instanceof Error && err.message === 'cancelled') return false;
              // Eval-layer failure on a live position — keep the reason.
              recordEvalError(evalErrors, scores, turn, err);
            }
          }
        }
        paint({ done: index + 1, total: turnList.length });
      }
      paint({ done: turnList.length, total: turnList.length }, true);
      return true;
    };

    void (async () => {
      const rangeTurns: number[] = [];
      for (let turn = from; turn <= to; turn++) rangeTurns.push(turn);
      const fullSettings: SweepSettings = { depth, samples, mode, tera: params.tera, sleepClause: params.sleepClause };
      const fastSettings: SweepSettings = { depth: 1, samples: 1, mode: 'matrix', tera: params.tera, sleepClause: params.sleepClause };
      const isFast = depth === 1 && samples === 1 && mode === 'matrix';

      // Three-pass sweep: a fast depth-1 pass shapes the whole graph in
      // seconds, the configured settings then deepen the report-worthy
      // swings (both sides of each — analysis compares across them), and
      // finally EVERY remaining turn converges to the configured settings
      // too — the settings ARE the line, the fast pass is only the sketch
      // ("I cannot configure anything for the graph line", GPL). Badges
      // track the convergence; the monotone merge makes each pass safe.
      // Short ranges (on-demand turn analysis) go straight to full settings.
      if (rangeTurns.length > 2 && !isFast) {
        if (!(await perfSpan('pass1-sketch', () => sweepTurns(rangeTurns, fastSettings, false)))) return;
        const keyTurns = selectKeyTurns(scores).filter(turn => turn >= from && turn <= to);
        if (keyTurns.length > 0 && !(await perfSpan('pass2-key-turns', () => sweepTurns(keyTurns, fullSettings, true)))) return;
        const keySet = new Set(keyTurns);
        const rest = rangeTurns.filter(turn => !keySet.has(turn));
        if (rest.length > 0 && !(await perfSpan('pass3-rest', () => sweepTurns(rest, fullSettings, true)))) return;
      } else if (!(await perfSpan('single-pass', () => sweepTurns(rangeTurns, fullSettings, true)))) {
        return;
      }

      // Turn 0: the lead decision, one extra evaluation at full settings —
      // after the graph so the game line appears first.
      if (params.acquirePreview && lead === null && runRef.current === runId) {
        // Team preview has zero fainted bodies — under auto the lead always
        // resolves to the pinned matrix side.
        const lead0 = mode === 'auto' ? resolveAutoTurnSettings(0) : { depth, samples, mode };
        const leadSettings: EvalSettings = { ...lead0, tera: params.tera, sleepClause: params.sleepClause };
        const key = params.cacheKeyFor(0);
        const storeKey = evalStoreKey(key, lead0.depth, lead0.samples, lead0.mode, params.tera);
        let hit = cacheRef.current.get(key);
        if (!(hit && hit.depth === lead0.depth && hit.samples === lead0.samples && hit.mode === lead0.mode && teraKey(hit.tera) === teraKey(params.tera))) {
          const stored = await loadStoredEval(storeKey);
          if (runRef.current !== runId) return;
          hit = stored ? { result: stored.result, depth: lead0.depth, samples: lead0.samples, mode: lead0.mode, tera: params.tera } : undefined;
          if (hit) cacheRef.current.set(key, hit);
        }
        let leadResult = hit?.result ?? null;
        if (!leadResult) {
          try {
            const serialized = await params.acquirePreview();
            if (runRef.current !== runId) return;
            if (serialized) {
              clientRef.current ??= new EvalWorkerClient();
              const client = clientRef.current;
              leadResult = await perfSpan('lead', () => client.evaluate(serialized, leadSettings));
              if (runRef.current !== runId) return;
              cacheRef.current.set(key, { result: leadResult, depth: lead0.depth, samples: lead0.samples, mode: lead0.mode, tera: params.tera });
              void saveStoredEval({
                key: storeKey, result: leadResult, depth: lead0.depth, samples: lead0.samples, mode: lead0.mode, tera: params.tera,
                savedAt: Date.now(),
              });
            }
          } catch (err) {
            if (runRef.current !== runId) return;
            if (err instanceof Error && err.message === 'cancelled') return;
            // No turn 0 for this replay — the graph stands on its own.
          }
        }
        if (leadResult) {
          lead = { result: leadResult, played: params.playedLeads ?? { p1: null, p2: null } };
          setGraph({ ...snapshot(), running: true, progress: null });
        }
      }

      if (runRef.current === runId) {
        // The summary ⚠ line settles once, when the line is final.
        notice = withEvalGapNotice(notice, evalErrors);
        setGraph({ ...snapshot(), running: false, progress: null });
        perfReport(`graph sweep ${from}-${to} of ${params.turns} turns`);
      }
    })();
  }, [cancel]);

  const clearGraph = useCallback(() => {
    graphDataRef.current = null;
    setGraph({ scores: [], results: [], settings: [], faintedFractions: [], played: [], playedOutcome: [], verified: [], sensitivity: [], evalErrors: [], lead: null, notice: null, running: false, progress: null });
  }, []);

  return {
    prefs, setPrefs,
    status, result, progress, error, reconstructProgress,
    evaluate, markStale, reset, cancel,
    graph, runGraphSweep, clearGraph,
  };
}
