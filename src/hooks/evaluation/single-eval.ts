import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type TurnSensitivity, type TurnVerification, type EvalPreferences, type EvalResult, type EvalSettings,
  type SearchProgress, type StaticRuleset, type TeraAllowance, teraKey,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { throttleLatest } from '../../lib/eval/throttle-latest';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../../lib/eval-cache-store';
import { resolveAutoTurnSettings, serializedAutoRouting, type EngineMode, type TurnEvalSettings } from './prefs';

export type EvalStatus = 'idle' | 'reconstructing' | 'searching' | 'done' | 'stale' | 'error';

const PROGRESS_INTERVAL_MS = 100;
const PARTIAL_INTERVAL_MS = 250;

export interface EvaluateParams {
  cacheKey: string | null;
  tera: TeraAllowance;
  sleepClause?: boolean;
  ruleset: StaticRuleset;
  acquire: (reportReconstruct: (turn: number, target: number) => void) => Promise<string>;
  /** Identity of the position, exposed as resultTag: a run finishing after navigation must not show as the new's. */
  tag?: string;
  /** The actions played on this replay turn, as the sweep passes them; absent for live and variation positions. */
  keepPlayed?: EvalSettings['keepPlayed'];
  /** Called once where the result lands; never for a partial, superseded, cancelled or failed run. */
  onResult?: (result: EvalResult) => void;
}

function deliverResult(params: EvaluateParams, result: EvalResult): void {
  try {
    params.onResult?.(result);
  } catch (err) {
    console.error('The result callback of an evaluation failed', err);
  }
}

export interface CachedEval {
  result: EvalResult;
  /** False marks a sketch result (no forced-win prover); a full pass never reuses it. */
  prove?: boolean;
  depth: EvalSettings['depth'];
  samples: EvalSettings['samples'];
  mode: EngineMode;
  tera: TeraAllowance;
  playedOutcome?: number | null;
  /** Depth+1 re-search of flagged misplays (null = checked, nothing flagged). */
  verified?: TurnVerification | null;
  /** Item-sensitivity probes for still-flagged sides (null = checked, none needed). */
  sensitivity?: TurnSensitivity | null;
}

/** The run the user stopped on a partial result; `tag` names its position (`EvaluateParams.tag`). */
export interface StoppedRun { tag: string | null; /** The stop came before any partial result. */ empty?: true }

interface SingleEvalIO {
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  setStatus: (value: EvalStatus) => void;
  setResult: (value: EvalResult | null) => void;
  setError: (value: string | null) => void;
  setProgress: (value: SearchProgress | null) => void;
  setReconstructProgress: (value: { turn: number; target: number } | null) => void;
  stopGraphPaint: (superseded?: boolean) => void;
}

async function resolveEngineAndStored(
  io: SingleEvalIO, params: EvaluateParams, runId: number,
  prefs: { depth: EvalSettings['depth']; samples: EvalSettings['samples']; mode: EvalPreferences['mode'] },
): Promise<'aborted' | 'done' | { serialized: string | null; resolved: TurnEvalSettings }> {
  const { depth, samples, mode } = prefs;
  let serialized: string | null = null;
  let resolved: TurnEvalSettings;
  if (mode === 'auto') {
    serialized = await params.acquire((turn, target) => {
      if (io.runRef.current === runId) io.setReconstructProgress({ turn, target });
    });
    if (io.runRef.current !== runId) return 'aborted';
    const { faintedFraction, doubles } = serializedAutoRouting(serialized);
    resolved = resolveAutoTurnSettings(faintedFraction, doubles);
  } else {
    resolved = { depth, samples, mode };
  }
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
      deliverResult(params, stored.result);
      return 'done';
    }
  }
  return { serialized, resolved };
}

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
  // The final result supersedes anything still held: cancel the throttle, never flush.
  const progress = throttleLatest<SearchProgress>(update => {
    if (io.runRef.current === runId) io.setProgress(update);
  }, PROGRESS_INTERVAL_MS);
  const partials = throttleLatest<EvalResult>(partial => {
    if (io.runRef.current === runId) io.setResult(partial);
  }, PARTIAL_INTERVAL_MS);
  let final: EvalResult;
  try {
    const settings: AppEvalSettings = {
      depth: resolved.depth, samples: resolved.samples, mode: resolved.mode, tera: params.tera, sleepClause: params.sleepClause, ruleset: params.ruleset,
      ...(params.keepPlayed ? { keepPlayed: params.keepPlayed } : {}),
    };
    final = await io.clientRef.current.evaluate(serialized, settings, {
      onProgress: update => progress.push(update),
      onPartial: partial => partials.push(partial),
    });
  } finally {
    progress.cancel();
    partials.cancel();
  }
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
  deliverResult(params, final);
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

function useEvaluateAction(
  io: SingleEvalIO,
  prefsRef: React.RefObject<EvalPreferences>,
  engineOverrideRef: React.RefObject<TurnEvalSettings | null>,
  setResultTag: (value: string | null) => void,
  setStopped: (value: StoppedRun | null) => void,
) {
  const { runRef, cacheRef, setResult, setStatus, setError, setProgress, setReconstructProgress, stopGraphPaint } = io;
  return useCallback((params: EvaluateParams) => {
    const { depth, samples, mode } = engineOverrideRef.current ?? prefsRef.current;
    if (params.cacheKey) {
      const hit = cacheRef.current.get(params.cacheKey);
      if (hit && hit.depth === depth && hit.samples === samples && hit.mode === mode && teraKey(hit.tera) === teraKey(params.tera)) {
        runRef.current += 1;
        // Bumping the run counter kills a running sweep: its status must say so.
        stopGraphPaint(true);
        setResult(hit.result);
        setResultTag(params.tag ?? null);
        setStopped(null);
        setStatus('done');
        setError(null);
        setProgress(null);
        setReconstructProgress(null);
        deliverResult(params, hit.result);
        return;
      }
    }

    const runId = ++runRef.current;
    stopGraphPaint(true);
    setStatus('reconstructing');
    setError(null);
    setResult(null);
    setResultTag(params.tag ?? null);
    setStopped(null);
    setProgress(null);
    setReconstructProgress(null);

    void runSingleEvaluation(io, params, runId, { depth, samples, mode });
  }, [io, prefsRef, engineOverrideRef, setResultTag, setStopped, runRef, cacheRef, setResult, setStatus, setError, setProgress, setReconstructProgress, stopGraphPaint]);
}

function useStop(
  cancel: () => void, resultRef: React.RefObject<EvalResult | null>, resultTagRef: React.RefObject<string | null>,
  statusRef: React.RefObject<EvalStatus>, setStopped: (value: StoppedRun | null) => void,
) {
  return useCallback(() => {
    const partial = resultRef.current !== null;
    // The game analysis's Cancel calls this too; only a single search that was under way leaves the empty mark.
    const searching = statusRef.current === 'searching' || statusRef.current === 'reconstructing';
    cancel();
    if (partial) setStopped({ tag: resultTagRef.current });
    else if (searching) setStopped({ tag: resultTagRef.current, empty: true });
  }, [cancel, resultRef, resultTagRef, statusRef, setStopped]);
}

export function useSingleEval(env: {
  runRef: React.RefObject<number>;
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  prefsRef: React.RefObject<EvalPreferences>;
  engineOverrideRef: React.RefObject<TurnEvalSettings | null>;
  stopGraphPaint: (superseded?: boolean) => void;
}) {
  const { runRef, clientRef, cacheRef, prefsRef, engineOverrideRef, stopGraphPaint } = env;
  const [status, setStatusState] = useState<EvalStatus>('idle');
  // Written with every change, not in an effect: a Cancel click can land between a change and the commit's effects.
  const statusRef = useRef<EvalStatus>('idle');
  const setStatus = useCallback((value: EvalStatus) => {
    statusRef.current = value;
    setStatusState(value);
  }, []);
  const [result, setResultState] = useState<EvalResult | null>(null);
  const [resultTag, setResultTagState] = useState<string | null>(null);
  const resultTagRef = useRef<string | null>(null);
  const setResultTag = useCallback((value: string | null) => {
    resultTagRef.current = value;
    setResultTagState(value);
  }, []);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconstructProgress, setReconstructProgress] = useState<{ turn: number; target: number } | null>(null);
  const [stopped, setStopped] = useState<StoppedRun | null>(null);
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
    if (statusRef.current === 'searching' || statusRef.current === 'reconstructing') setStatus(resultRef.current ? 'stale' : 'idle');
    stopGraphPaint();
  }, [runRef, clientRef, stopGraphPaint, setStatus]);

  const io = useMemo<SingleEvalIO>(() => ({
    runRef, clientRef, cacheRef, setStatus, setResult, setError, setProgress, setReconstructProgress, stopGraphPaint,
  }), [runRef, clientRef, cacheRef, setStatus, setResult, stopGraphPaint]);
  const evaluate = useEvaluateAction(io, prefsRef, engineOverrideRef, setResultTag, setStopped);

  const stop = useStop(cancel, resultRef, resultTagRef, statusRef, setStopped);

  const markStale = useCallback(() => {
    if (statusRef.current === 'done') setStatus('stale');
  }, [setStatus]);

  const reset = useCallback(() => {
    cancel();
    setStatus('idle');
    setResult(null);
    setError(null);
    setStopped(null);
  }, [cancel, setStatus, setResult]);

  return {
    status, result, resultTag, progress, error, reconstructProgress, stopped,
    evaluate, cancel, stop, markStale, reset,
  };
}
