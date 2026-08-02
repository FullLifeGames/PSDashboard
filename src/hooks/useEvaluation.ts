import { useCallback, useEffect, useRef, useState } from 'react';
import { matchPlayedChoice } from '../lib/eval/analysis';
import type { PlayedTurn } from '../lib/eval/played';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import type { EvalPreferences, EvalResult, SearchProgress } from '../lib/eval/types';

export type EvalStatus = 'idle' | 'reconstructing' | 'searching' | 'done' | 'stale' | 'error';

export interface EvaluateParams {
  /** Cache key for replay-view positions; null disables caching (branch mode). */
  cacheKey: string | null;
  /** Resolved Tera enumeration flag (the 'auto' pref resolved against the replay). */
  tera: boolean;
  /**
   * Produces the serialized position. A reconstruction-based acquire calls
   * reportReconstruct(turn, target) as it replays turns; the hook surfaces
   * that as reconstructProgress state.
   */
  acquire: (reportReconstruct: (turn: number, target: number) => void) => Promise<string>;
}

const PREFS_KEY = 'ps-replay-interceptor:eval-prefs';
const DEFAULT_PREFS: EvalPreferences = { depth: 2, samples: 3, mode: 'matrix', auto: false, tera: 'auto' };

function loadPrefs(): EvalPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<EvalPreferences>;
    return {
      depth: parsed.depth === 1 || parsed.depth === 3 ? parsed.depth : 2,
      samples: parsed.samples === 1 || parsed.samples === 5 ? parsed.samples : 3,
      mode: parsed.mode === 'mcts' ? 'mcts' : 'matrix',
      auto: !!parsed.auto,
      tera: parsed.tera === 'on' || parsed.tera === 'off' ? parsed.tera : 'auto',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface CachedEval {
  result: EvalResult;
  depth: EvalPreferences['depth'];
  samples: EvalPreferences['samples'];
  mode: EvalPreferences['mode'];
  tera: boolean;
  /** Engine expectation of the actually played pair (set by graph sweeps). */
  playedOutcome?: number | null;
}

export interface GraphSweepParams {
  /** Number of turns in the game (sizes the graph; sweep may cover less). */
  turns: number;
  /** Optional sub-range to sweep (on-demand analysis); defaults to 1..turns. */
  from?: number;
  to?: number;
  /** Resolved Tera enumeration flag. */
  tera: boolean;
  cacheKeyFor(turn: number): string;
  acquireFor(turn: number): (report: (turn: number, target: number) => void) => Promise<string>;
  /** What was actually played on this turn (parsed from the replay log). */
  playedFor(turn: number): PlayedTurn | null;
}

export interface EvalGraphState {
  /** scores[t-1] = score at turn t; null = not evaluated (gap). */
  scores: (number | null)[];
  /** Full per-turn results for the analysis view. */
  results: (EvalResult | null)[];
  played: (PlayedTurn | null)[];
  playedOutcome: (number | null)[];
  running: boolean;
  progress: { done: number; total: number } | null;
}

export function useEvaluation() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [prefs, setPrefsState] = useState<EvalPreferences>(loadPrefs);
  const [status, setStatus] = useState<EvalStatus>('idle');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconstructProgress, setReconstructProgress] = useState<{ turn: number; target: number } | null>(null);
  const [graph, setGraph] = useState<EvalGraphState>({
    scores: [], results: [], played: [], playedOutcome: [], running: false, progress: null,
  });

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const cacheRef = useRef(new Map<string, CachedEval>());
  /** Latest graph arrays, so partial (range) sweeps merge instead of wiping. */
  const graphDataRef = useRef<Pick<EvalGraphState, 'scores' | 'results' | 'played' | 'playedOutcome'> | null>(null);
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
      if (hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && hit.tera === params.tera) {
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
        const serialized = await params.acquire((turn, target) => {
          if (runRef.current === runId) setReconstructProgress({ turn, target });
        });
        if (runRef.current !== runId) return;
        setStatus('searching');
        setReconstructProgress(null);

        clientRef.current ??= new EvalWorkerClient();
        const final = await clientRef.current.evaluate(serialized, { depth, samples, mode, tera: params.tera }, {
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
        if (params.cacheKey) cacheRef.current.set(params.cacheKey, { result: final, depth, samples, mode, tera: params.tera });
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
    const runId = ++runRef.current;
    const { depth, samples, mode } = prefsRef.current;
    const from = Math.max(1, params.from ?? 1);
    const to = Math.min(params.turns, params.to ?? params.turns);
    const previous = graphDataRef.current;
    const keepPrevious = previous !== null && previous.scores.length === params.turns;
    const scores: (number | null)[] = keepPrevious ? [...previous.scores] : new Array(params.turns).fill(null);
    const results: (EvalResult | null)[] = keepPrevious ? [...previous.results] : new Array(params.turns).fill(null);
    const played: (PlayedTurn | null)[] = keepPrevious ? [...previous.played] : new Array(params.turns).fill(null);
    const playedOutcome: (number | null)[] = keepPrevious ? [...previous.playedOutcome] : new Array(params.turns).fill(null);
    const snapshot = () => {
      const data = {
        scores: [...scores], results: [...results], played: [...played], playedOutcome: [...playedOutcome],
      };
      graphDataRef.current = data;
      return data;
    };
    const total = Math.max(0, to - from + 1);
    setGraph({ ...snapshot(), running: true, progress: { done: 0, total } });

    void (async () => {
      for (let turn = from; turn <= to; turn++) {
        if (runRef.current !== runId) return;
        const key = params.cacheKeyFor(turn);
        const turnPlayed = params.playedFor(turn);
        played[turn - 1] = turnPlayed;

        const hit = cacheRef.current.get(key);
        if (hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && hit.tera === params.tera) {
          scores[turn - 1] = hit.result.score;
          results[turn - 1] = hit.result;
          // Entries written by single evaluations never computed the
          // played-pair expectation (undefined ≠ null = tried, unmatched) —
          // fill it in so the analysis gets its decision/chance split.
          let outcome: number | null | undefined = hit.playedOutcome;
          if (outcome === undefined) {
            outcome = null;
            const p1Choice = matchPlayedChoice(hit.result, 'p1', turnPlayed?.p1 ?? null);
            const p2Choice = matchPlayedChoice(hit.result, 'p2', turnPlayed?.p2 ?? null);
            if (p1Choice && p2Choice) {
              try {
                const serialized = await params.acquireFor(turn)(() => {});
                if (runRef.current !== runId) return;
                clientRef.current ??= new EvalWorkerClient();
                outcome = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice);
              } catch (err) {
                if (runRef.current !== runId) return;
                if (err instanceof Error && err.message === 'cancelled') return;
              }
              if (runRef.current !== runId) return;
            }
            cacheRef.current.set(key, { ...hit, playedOutcome: outcome });
          }
          playedOutcome[turn - 1] = outcome;
        } else {
          try {
            const serialized = await params.acquireFor(turn)(() => {});
            if (runRef.current !== runId) return;
            clientRef.current ??= new EvalWorkerClient();
            const result = await clientRef.current.evaluate(serialized, { depth, samples, mode, tera: params.tera });
            if (runRef.current !== runId) return;
            scores[turn - 1] = result.score;
            results[turn - 1] = result;

            // The engine's expectation of the real choices — the decision
            // part of the coming swing (chance is the rest).
            let outcome: number | null = null;
            const p1Choice = matchPlayedChoice(result, 'p1', turnPlayed?.p1 ?? null);
            const p2Choice = matchPlayedChoice(result, 'p2', turnPlayed?.p2 ?? null);
            if (p1Choice && p2Choice) {
              try {
                outcome = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice);
              } catch (err) {
                if (runRef.current !== runId) return;
                if (err instanceof Error && err.message === 'cancelled') return;
              }
              if (runRef.current !== runId) return;
            }
            playedOutcome[turn - 1] = outcome;
            cacheRef.current.set(key, { result, depth, samples, mode, tera: params.tera, playedOutcome: outcome });
          } catch (err) {
            if (runRef.current !== runId) return;
            if (err instanceof Error && err.message === 'cancelled') return;
            // This turn failed (e.g. reconstruction wedge) — leave a gap.
          }
        }
        setGraph({ ...snapshot(), running: true, progress: { done: turn - from + 1, total } });
      }
      if (runRef.current === runId) {
        setGraph(prev => ({ ...prev, running: false, progress: null }));
      }
    })();
  }, [cancel]);

  const clearGraph = useCallback(() => {
    graphDataRef.current = null;
    setGraph({ scores: [], results: [], played: [], playedOutcome: [], running: false, progress: null });
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen(open => {
      if (open) cancel();
      return !open;
    });
  }, [cancel]);

  return {
    panelOpen, togglePanel,
    prefs, setPrefs,
    status, result, progress, error, reconstructProgress,
    evaluate, markStale, reset, cancel,
    graph, runGraphSweep, clearGraph,
  };
}
