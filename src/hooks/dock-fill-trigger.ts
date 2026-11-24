import { useCallback, useRef } from 'react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import type { useEvaluation } from './useEvaluation';

type Evaluation = ReturnType<typeof useEvaluation>;

/**
 * Helpers of the dock fill's trigger (`useDockFill.ts`): the fill key a user's stop belongs to. A stop marks its position by the view's tag;
 * the fill key also carries the history length, so the next request of the same turn (a replacement answered) is a position of its own. The key
 * is read when the mark first shows, which is the commit of the stop itself.
 */
export function useStoppedKey(evaluation: Pick<Evaluation, 'stopped'>, evalViewKey: string) {
  const seen = useRef<{ mark: Evaluation['stopped']; key: string | null }>({ mark: null, key: null });
  return useCallback((key: string): boolean => {
    const mark = evaluation.stopped;
    if (seen.current.mark !== mark) seen.current = { mark, key: mark && mark.tag === evalViewKey ? key : null };
    return seen.current.key === key;
  }, [evaluation.stopped, evalViewKey]);
}

/**
 * The result the run for the position answered with, or null: a finished result, or the partial result of a run the user stopped; and a result
 * the position did not already have (`before`).
 */
export function fillAnswer(status: Evaluation['status'], stopped: boolean, result: EvalResult | null, attempted: boolean, before: EvalResult | null): EvalResult | null {
  const finished = status === 'done' || (status === 'stale' && stopped);
  return finished && attempted && result !== before ? result : null;
}

/**
 * The result that stood when the position began: only a newer one belongs to it. `foreign` marks a run that was under way when the position
 * began (the replacement's run, when a forced replacement was just sent: the next request of the turn has the same `evalViewKey`, so the tag
 * cannot tell the two apart). Its result belongs to the request before; once it is over, whatever stands is its result and the new base.
 */
export interface FillBase { key: string; result: EvalResult | null; foreign: boolean }

export function useFillBase(key: string, result: EvalResult | null, running: boolean) {
  const ref = useRef<FillBase>({ key, result, foreign: running });
  const update = useCallback((nextKey: string, nextResult: EvalResult | null, nextRunning: boolean): FillBase => {
    if (ref.current.key !== nextKey) ref.current = { key: nextKey, result: nextResult, foreign: nextRunning };
    else if (ref.current.foreign && !nextRunning) ref.current = { key: nextKey, result: nextResult, foreign: false };
    return ref.current;
  }, []);
  return update;
}
