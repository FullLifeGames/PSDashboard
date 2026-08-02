import { useCallback, useEffect, useRef, useState } from 'react';
import { matchPlayedChoice } from '../lib/eval/analysis';
import type { PlayedTurn } from '../lib/eval/played';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../lib/eval-cache-store';
import { selectKeyTurns } from '../lib/eval/graph';
import type { EvalPreferences, EvalResult, EvalSettings, SearchProgress } from '../lib/eval/types';

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
  ): Promise<(string | null)[]>;
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
        // Persistent cache: a result from a previous session for the same
        // position + settings skips reconstruction and search entirely.
        if (params.cacheKey) {
          const stored = await loadStoredEval(evalStoreKey(params.cacheKey, depth, samples, mode, params.tera));
          if (runRef.current !== runId) return;
          if (stored) {
            cacheRef.current.set(params.cacheKey, {
              result: stored.result, depth, samples, mode, tera: params.tera,
              ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
            });
            setResult(stored.result);
            setStatus('done');
            return;
          }
        }

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
        if (params.cacheKey) {
          cacheRef.current.set(params.cacheKey, { result: final, depth, samples, mode, tera: params.tera });
          void saveStoredEval({
            key: evalStoreKey(params.cacheKey, depth, samples, mode, params.tera),
            result: final, depth, samples, mode, tera: params.tera, savedAt: Date.now(),
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
    const startAcquisition = () => {
      if (acquireStarted) return;
      acquireStarted = true;
      params.acquireAll!(() => {}, (turn, serialized) => {
        arrived.set(turn, serialized);
        for (const waiter of waiters.get(turn) ?? []) waiter.resolve(serialized);
        waiters.delete(turn);
      }).then(positions => {
        positions.forEach((serialized, index) => {
          if (serialized) arrived.set(index + 1, serialized);
        });
      }).catch(error => {
        acquireError = error;
      }).finally(() => {
        acquireSettled = true;
        settleWaiters();
      });
    };
    const positionFor = (turn: number): Promise<string> => {
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
    };

    /** One sequential pass over `turnList` at `settings`; false = cancelled. */
    const sweepTurns = async (turnList: number[], settings: EvalSettings): Promise<boolean> => {
      const { depth, samples } = settings;
      const mode = settings.mode ?? 'matrix';
      for (let index = 0; index < turnList.length; index++) {
        const turn = turnList[index];
        if (runRef.current !== runId) return false;
        const key = params.cacheKeyFor(turn);
        const storeKey = evalStoreKey(key, depth, samples, mode, params.tera);
        const turnPlayed = params.playedFor(turn);
        played[turn - 1] = turnPlayed;

        let hit = cacheRef.current.get(key);
        if (!(hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && hit.tera === params.tera)) {
          // Second cache layer: results persisted by a previous session.
          const stored = await loadStoredEval(storeKey);
          if (runRef.current !== runId) return false;
          hit = stored ? {
            result: stored.result, depth, samples, mode: mode, tera: params.tera,
            ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
          } : undefined;
          if (hit) cacheRef.current.set(key, hit);
        }
        if (hit) {
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
                const serialized = await positionFor(turn);
                if (runRef.current !== runId) return false;
                clientRef.current ??= new EvalWorkerClient();
                outcome = await clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice);
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
        } else {
          try {
            const serialized = await positionFor(turn);
            if (runRef.current !== runId) return false;
            clientRef.current ??= new EvalWorkerClient();
            const result = await clientRef.current.evaluate(serialized, { depth, samples, mode, tera: params.tera });
            if (runRef.current !== runId) return false;
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
                if (runRef.current !== runId) return false;
                if (err instanceof Error && err.message === 'cancelled') return false;
              }
              if (runRef.current !== runId) return false;
            }
            playedOutcome[turn - 1] = outcome;
            cacheRef.current.set(key, { result, depth, samples, mode: mode, tera: params.tera, playedOutcome: outcome });
            void saveStoredEval({
              key: storeKey, result, depth, samples, mode: mode, tera: params.tera,
              playedOutcome: outcome, savedAt: Date.now(),
            });
          } catch (err) {
            if (runRef.current !== runId) return false;
            if (err instanceof Error && err.message === 'cancelled') return false;
            // This turn failed (e.g. reconstruction wedge) — leave a gap.
          }
        }
        setGraph({ ...snapshot(), running: true, progress: { done: index + 1, total: turnList.length } });
      }
      return true;
    };

    void (async () => {
      const rangeTurns: number[] = [];
      for (let turn = from; turn <= to; turn++) rangeTurns.push(turn);
      const fullSettings: EvalSettings = { depth, samples, mode, tera: params.tera };
      const fastSettings: EvalSettings = { depth: 1, samples: 1, mode: 'matrix', tera: params.tera };
      const isFast = depth === 1 && samples === 1 && mode !== 'mcts';

      // Two-pass sweep: a fast depth-1 pass shapes the whole graph first,
      // then the configured settings deepen only the turns around the big
      // swings (both sides of each — analysis compares across them). Short
      // ranges (on-demand turn analysis) go straight to full settings.
      if (rangeTurns.length > 2 && !isFast) {
        if (!(await sweepTurns(rangeTurns, fastSettings))) return;
        const keyTurns = selectKeyTurns(scores).filter(turn => turn >= from && turn <= to);
        if (keyTurns.length > 0 && !(await sweepTurns(keyTurns, fullSettings))) return;
      } else if (!(await sweepTurns(rangeTurns, fullSettings))) {
        return;
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

  return {
    prefs, setPrefs,
    status, result, progress, error, reconstructProgress,
    evaluate, markStale, reset, cancel,
    graph, runGraphSweep, clearGraph,
  };
}
