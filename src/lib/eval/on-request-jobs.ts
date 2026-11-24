import type { EvalWorkerRequest, EvalWorkerResponse, StaticRuleset, WinPaths, WinPathsRequest, WinStep } from '@fulllifegames/eval-engine';
import { searchBudgetStamp } from './search-budget-setting';
import { simFastLevers } from './sim-fast-setting';
import { spawnWorker, type WorkerHandle } from './worker-handle';

export interface WinPathsHandlers {
  onStep?(step: WinStep): void;
  signal?: AbortSignal;
}

const MEMO_SIZE = 16;

/** The user's on-request jobs, each on a worker of its own outside the pool: a sweep's `cancel` never ends one. */
// A finished answer is kept per question (position, rule set, request) and replays at once; a failed job keeps nothing.
export class OnRequestJobs {
  private nextId = 1;
  private running = new Set<WorkerHandle>();
  private memo = new Map<string, WinPaths>();

  /** Steps arrive through `onStep`; the promise settles with the whole answer or rejects with "cancelled". */
  async winPaths(serializedBattle: string, request: WinPathsRequest, ruleset: StaticRuleset, handlers: WinPathsHandlers = {}): Promise<WinPaths> {
    const { onStep, signal } = handlers;
    if (signal?.aborted) throw new Error('cancelled');
    const key = JSON.stringify([ruleset, serializedBattle, request]);
    const kept = this.memo.get(key);
    if (kept) {
      await Promise.resolve();
      if (signal?.aborted) throw new Error('cancelled');
      for (const step of kept.steps) onStep?.(step);
      return kept;
    }
    const paths = await this.run<WinPaths>(
      { type: 'job', serializedBattle, job: { kind: 'winPaths', request }, ruleset },
      response => (response.type === 'jobResult' ? response.result.paths : null),
      response => { if (response.type === 'jobStep') onStep?.(response.step.step); },
      signal,
    );
    this.memo.set(key, paths);
    if (this.memo.size > MEMO_SIZE) this.memo.delete(this.memo.keys().next().value!);
    return paths;
  }

  private run<T>(
    message: Omit<Extract<EvalWorkerRequest, { type: 'job' }>, 'id'>,
    answer: (response: EvalWorkerResponse) => T | null,
    onStream: (response: EvalWorkerResponse) => void,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const handle = spawnWorker(crashed => { this.running.delete(crashed); });
    this.running.add(handle);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      let open = true;
      const close = (settle: () => void) => {
        if (!open) return;
        open = false;
        signal?.removeEventListener('abort', onAbort);
        handle.pending.clear();
        handle.worker.terminate();
        this.running.delete(handle);
        settle();
      };
      const onAbort = () => close(() => reject(new Error('cancelled')));
      signal?.addEventListener('abort', onAbort);
      handle.pending.set(id, {
        resolve: response => close(() => {
          const result = answer(response);
          if (result === null) reject(new Error('unexpected worker response'));
          else resolve(result);
        }),
        reject: error => close(() => reject(error)),
        onStream: response => { if (open) onStream(response); },
      });
      handle.worker.postMessage({ ...message, id, simFast: simFastLevers(), searchBudget: searchBudgetStamp() } satisfies EvalWorkerRequest);
    });
  }

  dispose(): void {
    for (const handle of this.running) {
      handle.worker.terminate();
      for (const entry of handle.pending.values()) entry.reject(new Error('cancelled'));
      handle.pending.clear();
    }
    this.running.clear();
  }
}
