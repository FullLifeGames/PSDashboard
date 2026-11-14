import { perfCount, type EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { recordSimFastReport } from './sim-fast-setting';

export interface PendingEntry {
  resolve(response: EvalWorkerResponse): void;
  reject(error: Error): void;
  /** Streaming responses (progress, partial, a job's step) that must not settle the RPC. */
  onStream?(response: EvalWorkerResponse): void;
}

export interface WorkerHandle {
  worker: Worker;
  pending: Map<number, PendingEntry>;
}

/** One eval worker with its message handling; `forget` drops it from whichever list holds it once it has crashed. */
export function spawnWorker(forget: (handle: WorkerHandle) => void): WorkerHandle {
  perfCount('workerSpawn');
  const worker = new Worker(new URL('../../workers/eval-worker.ts', import.meta.url), { type: 'module' });
  const handle: WorkerHandle = { worker, pending: new Map() };
  worker.onmessage = (event: MessageEvent<EvalWorkerResponse>) => {
    const response = event.data;
    if (response.simFast) recordSimFastReport(response.simFast);
    const entry = handle.pending.get(response.id);
    if (!entry) return;
    if ((response.type === 'progress' || response.type === 'partial' || response.type === 'jobStep') && entry.onStream) {
      entry.onStream(response);
      return;
    }
    handle.pending.delete(response.id);
    if (response.type === 'error') entry.reject(new Error(response.message));
    else entry.resolve(response);
  };
  worker.onerror = event => {
    const error = new Error(event.message || 'evaluation worker crashed');
    for (const entry of handle.pending.values()) entry.reject(error);
    handle.pending.clear();
    // A crashed worker leaves the pool: the pool outlives single evaluations now, and a dead worker would swallow the next RPC
    // without ever answering it.
    handle.worker.terminate();
    forget(handle);
  };
  return handle;
}
