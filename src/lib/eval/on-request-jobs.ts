import type { EvalWorkerRequest, EvalWorkerResponse, StaticRuleset, WinPaths, WinPathsRequest, WinStep } from '@fulllifegames/eval-engine';
import { searchBudgetStamp } from './search-budget-setting';
import { simFastLevers } from './sim-fast-setting';
import { spawnWorker, type WorkerHandle } from './worker-handle';

/** What a caller of the win-paths job may hand in: a callback for each step and a signal that ends the job. */
export interface WinPathsHandlers {
  onStep?(step: WinStep): void;
  signal?: AbortSignal;
}

/** The finished answers kept for the next open of the same question (the newest few). */
const MEMO_SIZE = 16;

/**
 * Round 89 (#130, G8a): the jobs the user asks for, each on a worker of its own, outside the evaluation pool. A job never queues behind
 * a sweep's search (a pool worker is busy until its search ends), a sweep's `cancel` never ends it, and ending it never touches a sweep.
 * Its worker lives for the job: a job that ends, fails or is cancelled terminates it. The message is the generic `job` of the worker
 * (`kind` names the job), so another on-request search shares this class: a new method over `run`, not a new protocol.
 *
 * A finished answer is kept for the same question (position, rule set and request) and replays its steps at once; a failed or cancelled
 * job keeps nothing. No job writes into an `EvalResult`.
 */
export class OnRequestJobs {
  private nextId = 1;
  private running = new Set<WorkerHandle>();
  private memo = new Map<string, WinPaths>();

  /** Win paths: steps arrive through `onStep` as they are done; the promise settles with the whole answer, or rejects with "cancelled". */
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

  /** Ends every running job (their promises reject with "cancelled"). */
  dispose(): void {
    for (const handle of this.running) {
      handle.worker.terminate();
      for (const entry of handle.pending.values()) entry.reject(new Error('cancelled'));
      handle.pending.clear();
    }
    this.running.clear();
  }
}
