import { useCallback } from 'react';
import type { EvalLine, EvalResult } from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { evalStoreKey, saveStoredEval } from '../../lib/eval-cache-store';
import type { EvalGraphState, GraphData } from './graph-sweep';
import type { CachedEval } from './single-eval';

/**
 * Round 89 (#104), step G13: the two calls of the early-lines stage (`useEarlyLines`) on the evaluation's own pieces. A tree search
 * for the lines of a graded matrix turn runs on the shared pool without cancelling anything (`exclusive: false`), and its lines
 * are written into that turn's stored result: the graph, the memory cache and the store entry, so a reload reads them back.
 */
export function useEarlyLinesIO(env: {
  clientRef: React.RefObject<EvalWorkerClient | null>;
  cacheRef: React.RefObject<Map<string, CachedEval>>;
  graphDataRef: React.RefObject<GraphData | null>;
  setGraph: React.Dispatch<React.SetStateAction<EvalGraphState>>;
}) {
  const { clientRef, cacheRef, graphDataRef, setGraph } = env;

  const searchLines = useCallback(async (serialized: string, settings: AppEvalSettings): Promise<EvalLine[]> => {
    clientRef.current ??= new EvalWorkerClient();
    const result = await clientRef.current.evaluate(serialized, settings, undefined, { exclusive: false });
    return result.lines ?? [];
  }, [clientRef]);

  /** Writes `lines` into the result `base` of `turn`; false (nothing written) when the turn's result is no longer `base`. */
  const attachLines = useCallback((turn: number, base: EvalResult, lines: EvalLine[], cacheKey: string): boolean => {
    const data = graphDataRef.current;
    if (!data || data.results[turn - 1] !== base) return false;
    const withLines: EvalResult = { ...base, lines };
    const replaced = (results: (EvalResult | null)[]) => results.map((result, index) => (index === turn - 1 ? withLines : result));
    graphDataRef.current = { ...data, results: replaced(data.results) };
    setGraph(previous => (previous.results[turn - 1] === base ? { ...previous, results: replaced(previous.results) } : previous));
    const hit = cacheRef.current.get(cacheKey);
    if (hit && hit.result === base) {
      cacheRef.current.set(cacheKey, { ...hit, result: withLines });
      void saveStoredEval({
        key: evalStoreKey(cacheKey, hit.depth, hit.samples, hit.mode, hit.tera), result: withLines,
        depth: hit.depth, samples: hit.samples, mode: hit.mode, tera: hit.tera,
        ...(hit.prove === false ? { prove: false } : {}),
        ...(hit.playedOutcome !== undefined ? { playedOutcome: hit.playedOutcome } : {}),
        ...(hit.verified !== undefined ? { verified: hit.verified } : {}),
        ...(hit.sensitivity !== undefined ? { sensitivity: hit.sensitivity } : {}),
        savedAt: Date.now(),
      });
    }
    return true;
  }, [cacheRef, graphDataRef, setGraph]);

  return { searchLines, attachLines };
}
