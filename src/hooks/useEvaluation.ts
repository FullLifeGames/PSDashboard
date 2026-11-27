import { useCallback, useEffect, useRef } from 'react';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { usePrefsState, type TurnEvalSettings } from './evaluation/prefs';
import { useSingleEval, type CachedEval } from './evaluation/single-eval';
import { useGraphState, useGraphSweepRunner } from './evaluation/graph-sweep';
import { useEarlyLinesIO } from './evaluation/early-lines-io';

export { resolveAutoTurnSettings, serializedFaintedFraction, supersedesStored } from './evaluation/prefs';
export type { TurnEvalSettings } from './evaluation/prefs';
export type { EvalStatus, StoppedRun } from './evaluation/single-eval';
export { verificationDeepSettings } from './evaluation/sweep-verify';
export { recordEvalError } from './evaluation/sweep-types';
export { coverageNotice, withEvalGapNotice } from './evaluation/graph-sweep';
export type { EvalGraphState } from './evaluation/graph-sweep';

/** Preferences, single evaluation and game sweep on one client; bumping the run counter cancels whatever else ran. */
export function useEvaluation() {
  const { prefs, prefsRef, persistPrefs } = usePrefsState();
  const { graph, setGraph, graphDataRef, stopGraphPaint, clearGraph, dropGraphFrom } = useGraphState();

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const cacheRef = useRef(new Map<string, CachedEval>());
  const runRef = useRef(0);
  // Pinned over the prefs for single evaluations: a ref, never stored, never shown as the panel's setting.
  const engineOverrideRef = useRef<TurnEvalSettings | null>(null);
  const setEngineOverride = useCallback((override: TurnEvalSettings | null) => {
    engineOverrideRef.current = override;
  }, []);

  useEffect(() => () => {
    runRef.current += 1;
    clientRef.current?.dispose();
    clientRef.current = null;
  }, []);

  const {
    status, result, resultTag, resultReplacement, progress, error, reconstructProgress, stopped,
    evaluate, cancel, stop, markStale, reset,
  } = useSingleEval({ runRef, clientRef, cacheRef, prefsRef, engineOverrideRef, stopGraphPaint });

  const setPrefs = useCallback((next: EvalPreferences) => {
    if (persistPrefs(next)) markStale();
  }, [persistPrefs, markStale]);

  const runGraphSweep = useGraphSweepRunner({ runRef, clientRef, cacheRef, prefsRef, cancel, setGraph, graphDataRef });

  const { searchLines, attachLines } = useEarlyLinesIO({ clientRef, cacheRef, graphDataRef, setGraph });

  return {
    prefs, setPrefs, setEngineOverride, searchLines, attachLines,
    status, result, resultTag, resultReplacement, progress, error, reconstructProgress, stopped,
    evaluate, markStale, reset, cancel, stop,
    graph, runGraphSweep, clearGraph, dropGraphFrom,
  };
}
