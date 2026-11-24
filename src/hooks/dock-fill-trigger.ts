import { useCallback, useRef } from 'react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import type { useEvaluation } from './useEvaluation';

type Evaluation = ReturnType<typeof useEvaluation>;

/** The fill key of a user's stop, with the history length so a replacement's request is its own position. */
export function useStoppedKey(evaluation: Pick<Evaluation, 'stopped'>, evalViewKey: string) {
  const seen = useRef<{ mark: Evaluation['stopped']; key: string | null }>({ mark: null, key: null });
  return useCallback((key: string): boolean => {
    const mark = evaluation.stopped;
    if (seen.current.mark !== mark) seen.current = { mark, key: mark && mark.tag === evalViewKey ? key : null };
    return seen.current.key === key;
  }, [evaluation.stopped, evalViewKey]);
}

/** The run's answer: a finished or stopped partial result the position did not already have (`before`); else null. */
export function fillAnswer(status: Evaluation['status'], stopped: boolean, result: EvalResult | null, attempted: boolean, before: EvalResult | null): EvalResult | null {
  const finished = status === 'done' || (status === 'stale' && stopped);
  return finished && attempted && result !== before ? result : null;
}

/** The result standing at the position's start; `foreign`: a run then under way, answering the request before. */
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
