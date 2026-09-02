import { useCallback, useEffect, useRef } from 'react';
import { EvalWorkerClient } from '../lib/eval/worker-client';
import type { EvalPreferences } from '@fulllifegames/eval-engine';
import { usePrefsState } from './evaluation/prefs';
import { useSingleEval, type CachedEval } from './evaluation/single-eval';
import { useGraphState, useGraphSweepRunner } from './evaluation/graph-sweep';

export {
  needsSettingsUpgrade, resolveAutoTurnSettings, serializedFaintedFraction, supersedesStored,
} from './evaluation/prefs';
export type { TurnEvalSettings } from './evaluation/prefs';
export type { EvalStatus } from './evaluation/single-eval';
export { verificationDeepSettings } from './evaluation/sweep-verify';
export { recordEvalError } from './evaluation/sweep-types';
export { coverageNotice, withEvalGapNotice } from './evaluation/graph-sweep';
export type { EvalGraphState } from './evaluation/graph-sweep';

/**
 * The evaluation surface: panel preferences, the single-position evaluate
 * path, and the whole-game graph sweep — composed over one shared worker
 * client, one in-memory result cache, and one run counter (bumping it is
 * how any path cancels whatever else was running).
 */
export function useEvaluation() {
  const { prefs, prefsRef, persistPrefs } = usePrefsState();
  const { graph, setGraph, graphDataRef, stopGraphPaint, clearGraph } = useGraphState();

  const clientRef = useRef<EvalWorkerClient | null>(null);
  const cacheRef = useRef(new Map<string, CachedEval>());
  const runRef = useRef(0);

  useEffect(() => () => {
    runRef.current += 1;
    clientRef.current?.dispose();
    clientRef.current = null;
  }, []);

  const {
    status, result, resultTag, progress, error, reconstructProgress,
    evaluate, cancel, markStale, reset,
  } = useSingleEval({ runRef, clientRef, cacheRef, prefsRef, stopGraphPaint });

  const setPrefs = useCallback((next: EvalPreferences) => {
    if (persistPrefs(next)) markStale();
  }, [persistPrefs, markStale]);

  const runGraphSweep = useGraphSweepRunner({ runRef, clientRef, cacheRef, prefsRef, cancel, setGraph, graphDataRef });

  return {
    prefs, setPrefs,
    status, result, resultTag, progress, error, reconstructProgress,
    evaluate, markStale, reset, cancel,
    graph, runGraphSweep, clearGraph,
  };
}
