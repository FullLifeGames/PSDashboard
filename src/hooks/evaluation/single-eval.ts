import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type TurnSensitivity, type TurnVerification, type EvalPreferences, type EvalResult, type EvalSettings,
  type SearchProgress, type TeraAllowance, teraKey,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient } from '../../lib/eval/worker-client';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../../lib/eval-cache-store';
import { resolveAutoTurnSettings, serializedFaintedFraction, type EngineMode, type TurnEvalSettings } from './prefs';

export type EvalStatus = 'idle' | 'reconstructing' | 'searching' | 'done' | 'stale' | 'error';

interface EvaluateParams {
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
  /**
   * Identity of the position this run evaluates (unified timeline). Exposed
   * back as resultTag so consumers can tell whether the shown result still
   * belongs to the position on screen — a run finishing AFTER the user
   * navigated away must not display (or be recorded) as the new position's.
   */
  tag?: string;
}

export interface CachedEval {
  result: EvalResult;
  /** Round 35: false marks a sketch result (no forced-win prover); a full pass never reuses it. */
  prove?: boolean;
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

/** The state setters and shared refs a single-evaluation run writes through. */
interface SingleEvalIO {
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  setStatus: (value: EvalStatus | ((prev: EvalStatus) => EvalStatus)) => void;
  setResult: (value: EvalResult | null) => void;
  setError: (value: string | null) => void;
  setProgress: (value: SearchProgress | null) => void;
  setReconstructProgress: (value: { turn: number; target: number } | null) => void;
}

/**
 * Engine resolution and the stored-eval fast path. 'auto' needs the position
 * before the engine is known — acquire first and resolve; concrete modes
 * keep the stored-eval fast path that skips reconstruction entirely.
 */
async function resolveEngineAndStored(
  io: SingleEvalIO, params: EvaluateParams, runId: number,
  prefs: { depth: EvalSettings['depth']; samples: EvalSettings['samples']; mode: EvalPreferences['mode'] },
): Promise<'aborted' | 'done' | { serialized: string | null; resolved: TurnEvalSettings }> {
  const { depth, samples, mode } = prefs;
  let serialized: string | null = null;
  let resolved: TurnEvalSettings = mode === 'auto' ? resolveAutoTurnSettings(0) : { depth, samples, mode };
  if (mode === 'auto') {
    serialized = await params.acquire((turn, target) => {
      if (io.runRef.current === runId) io.setReconstructProgress({ turn, target });
    });
    if (io.runRef.current !== runId) return 'aborted';
    resolved = resolveAutoTurnSettings(serializedFaintedFraction(serialized));
  }
  // Persistent cache: a result from a previous session for the same
  // position + settings skips reconstruction and search entirely.
  if (params.cacheKey) {
    const stored = await loadStoredEval(evalStoreKey(params.cacheKey, resolved.depth, resolved.samples, resolved.mode, params.tera));
    if (io.runRef.current !== runId) return 'aborted';
    if (stored) {
      io.cacheRef.current.set(params.cacheKey, {
        result: stored.result, depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera,
        ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
      });
      io.setResult(stored.result);
      io.setStatus('done');
      return 'done';
    }
  }
  return { serialized, resolved };
}

/** The search itself: acquire (if the fast paths left no position), run the workers, install and persist. */
async function searchAndInstall(
  io: SingleEvalIO, params: EvaluateParams, runId: number,
  resolved: TurnEvalSettings, acquired: string | null,
): Promise<void> {
  let serialized = acquired;
  if (serialized === null) {
    serialized = await params.acquire((turn, target) => {
      if (io.runRef.current === runId) io.setReconstructProgress({ turn, target });
    });
    if (io.runRef.current !== runId) return;
  }
  io.setStatus('searching');
  io.setReconstructProgress(null);

  io.clientRef.current ??= new EvalWorkerClient();
  const final = await io.clientRef.current.evaluate(serialized, { depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera, sleepClause: params.sleepClause }, {
    onProgress: update => {
      if (io.runRef.current === runId) io.setProgress(update);
    },
    onPartial: partial => {
      if (io.runRef.current === runId) io.setResult(partial);
    },
  });
  if (io.runRef.current !== runId) return;
  io.setResult(final);
  io.setStatus('done');
  io.setProgress(null);
  if (params.cacheKey) {
    io.cacheRef.current.set(params.cacheKey, { result: final, depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera });
    void saveStoredEval({
      key: evalStoreKey(params.cacheKey, resolved.depth, resolved.samples, resolved.mode, params.tera),
      result: final, depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera, savedAt: Date.now(),
    });
  }
}

async function runSingleEvaluation(
  io: SingleEvalIO, params: EvaluateParams, runId: number,
  prefs: { depth: EvalSettings['depth']; samples: EvalSettings['samples']; mode: EvalPreferences['mode'] },
): Promise<void> {
  try {
    const stage = await resolveEngineAndStored(io, params, runId, prefs);
    if (stage === 'aborted' || stage === 'done') return;
    await searchAndInstall(io, params, runId, stage.resolved, stage.serialized);
  } catch (err) {
    if (io.runRef.current !== runId) return;
    if (err instanceof Error && err.message === 'cancelled') return;
    io.setStatus('error');
    io.setError(err instanceof Error ? err.message : String(err));
    io.setProgress(null);
    io.setReconstructProgress(null);
  }
}

/** The evaluate entry: the in-memory cache fast path, then the staged async run. */
function useEvaluateAction(
  io: SingleEvalIO,
  prefsRef: React.RefObject<EvalPreferences>,
  setResultTag: (value: string | null) => void,
) {
  const { runRef, cacheRef, setResult, setStatus, setError, setProgress, setReconstructProgress } = io;
  return useCallback((params: EvaluateParams) => {
    const { depth, samples, mode } = prefsRef.current;
    if (params.cacheKey) {
      const hit = cacheRef.current.get(params.cacheKey);
      if (hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera)) {
        runRef.current += 1;
        setResult(hit.result);
        setResultTag(params.tag ?? null);
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
    setResultTag(params.tag ?? null);
    setProgress(null);
    setReconstructProgress(null);

    void runSingleEvaluation(io, params, runId, { depth, samples, mode });
  }, [io, prefsRef, setResultTag, runRef, cacheRef, setResult, setStatus, setError, setProgress, setReconstructProgress]);
}

/**
 * The single-position evaluation surface: status/result state, the
 * evaluate entry with its two cache layers, cancel, and staleness.
 */
export function useSingleEval(env: {
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  prefsRef: React.RefObject<EvalPreferences>;
  /** cancel also stops the sweep's painting (the run counter kills its work). */
  stopGraphPaint: () => void;
}) {
  const { runRef, clientRef, cacheRef, prefsRef, stopGraphPaint } = env;
  const [status, setStatus] = useState<EvalStatus>('idle');
  const [result, setResultState] = useState<EvalResult | null>(null);
  /** Position tag of the run that produced `result` (see EvaluateParams.tag). */
  const [resultTag, setResultTag] = useState<string | null>(null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconstructProgress, setReconstructProgress] = useState<{ turn: number; target: number } | null>(null);
  const resultRef = useRef<EvalResult | null>(null);
  const setResult = useCallback((value: EvalResult | null) => {
    resultRef.current = value;
    setResultState(value);
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
    stopGraphPaint();
  }, [runRef, clientRef, stopGraphPaint]);

  const io = useMemo<SingleEvalIO>(() => ({
    runRef, clientRef, cacheRef, setStatus, setResult, setError, setProgress, setReconstructProgress,
  }), [runRef, clientRef, cacheRef, setResult]);
  const evaluate = useEvaluateAction(io, prefsRef, setResultTag);

  const markStale = useCallback(() => {
    setStatus(prev => (prev === 'done' ? 'stale' : prev));
  }, []);

  const reset = useCallback(() => {
    cancel();
    setStatus('idle');
    setResult(null);
    setError(null);
  }, [cancel, setResult]);

  return {
    status, result, resultTag, progress, error, reconstructProgress,
    evaluate, cancel, markStale, reset,
  };
}
