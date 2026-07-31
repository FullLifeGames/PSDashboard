import { searchOrchestrated, type SearchExecutor } from './orchestrator';
import type {
  EvalCellValue, EvalResult, EvalSettings, EvalWorkerRequest, EvalWorkerResponse, SearchProgress,
} from './types';

export interface EvalRunHandlers {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
}

interface PendingEntry {
  resolve(response: EvalWorkerResponse): void;
  reject(error: Error): void;
  /** Streaming responses (progress/partial) that must not settle the RPC. */
  onStream?(response: EvalWorkerResponse): void;
}

interface WorkerHandle {
  worker: Worker;
  pending: Map<number, PendingEntry>;
}

/** Omit that distributes over a discriminated union (plain Omit collapses it). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function poolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  const size = Math.max(1, Math.min(cores - 2, 6));
  try {
    // Optional cap (used by the e2e suite, where many pages run in parallel).
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ps-replay-interceptor:eval-pool') : null;
    const cap = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(cap) && cap >= 1) return Math.min(cap, size);
  } catch {
    // Storage unavailable — use the computed size.
  }
  return size;
}

/**
 * Coordinates the evaluation on the main thread (pure orchestrator + rank
 * math — no sim) and fans the sim work out to a pool of workers. One search
 * at a time; cancellation terminates the whole pool — a worker's synchronous
 * search never yields to onmessage, so termination is the only reliable stop
 * — and the next evaluate() rebuilds it.
 */
export class EvalWorkerClient {
  private workers: WorkerHandle[] = [];
  private nextId = 1;
  private generation = 0;

  private ensureWorkers(): WorkerHandle[] {
    while (this.workers.length < poolSize()) {
      const worker = new Worker(new URL('../../workers/eval-worker.ts', import.meta.url), { type: 'module' });
      const handle: WorkerHandle = { worker, pending: new Map() };
      worker.onmessage = (event: MessageEvent<EvalWorkerResponse>) => {
        const response = event.data;
        const entry = handle.pending.get(response.id);
        if (!entry) return;
        if ((response.type === 'progress' || response.type === 'partial') && entry.onStream) {
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
      };
      this.workers.push(handle);
    }
    return this.workers;
  }

  private rpc(handle: WorkerHandle, request: DistributiveOmit<EvalWorkerRequest, 'id'>): Promise<EvalWorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      handle.pending.set(id, { resolve, reject });
      handle.worker.postMessage({ ...request, id });
    });
  }

  private createPooledExecutor(serializedBattle: string): SearchExecutor {
    let roundRobin = 0;
    return {
      choices: async tera => {
        const response = await this.rpc(this.ensureWorkers()[0], { type: 'choices', serializedBattle, tera });
        if (response.type !== 'choicesResult') throw new Error('unexpected worker response');
        return response.info;
      },
      evalCells: async (jobs, onDone) => {
        const workers = this.ensureWorkers();
        const chunkSize = Math.max(1, Math.ceil(jobs.length / (workers.length * 3)));
        const chunks: typeof jobs[] = [];
        for (let start = 0; start < jobs.length; start += chunkSize) {
          chunks.push(jobs.slice(start, start + chunkSize));
        }
        const values: EvalCellValue[] = [];
        let completed = 0;
        let next = 0;
        await Promise.all(workers.map(async handle => {
          while (next < chunks.length) {
            const chunk = chunks[next++];
            const response = await this.rpc(handle, { type: 'cells', serializedBattle, jobs: chunk });
            if (response.type !== 'cellsResult') throw new Error('unexpected worker response');
            values.push(...response.values);
            completed += chunk.length;
            onDone?.(completed);
          }
        }));
        return values;
      },
      subSearch: async job => {
        const workers = this.ensureWorkers();
        const handle = workers[roundRobin++ % workers.length];
        const response = await this.rpc(handle, { type: 'subsearch', serializedBattle, job });
        if (response.type !== 'result') throw new Error('unexpected worker response');
        return response.result;
      },
    };
  }

  evaluate(serializedBattle: string, settings: EvalSettings, handlers?: EvalRunHandlers): Promise<EvalResult> {
    this.cancel();
    const generation = ++this.generation;
    const live = () => generation === this.generation;

    if (settings.mode === 'mcts') {
      // The tree search is inherently sequential — one worker, streaming.
      const handle = this.ensureWorkers()[0];
      const id = this.nextId++;
      return new Promise<EvalResult>((resolve, reject) => {
        handle.pending.set(id, {
          resolve: response => {
            if (response.type === 'result') resolve(response.result);
            else reject(new Error('unexpected worker response'));
          },
          reject,
          onStream: response => {
            if (!live()) return;
            if (response.type === 'progress') handlers?.onProgress?.(response.progress);
            else if (response.type === 'partial') handlers?.onPartial?.(response.result);
          },
        });
        handle.worker.postMessage({ type: 'search', id, serializedBattle, settings });
      });
    }

    const executor = this.createPooledExecutor(serializedBattle);
    return searchOrchestrated(executor, settings, {
      onProgress: progress => {
        if (live()) handlers?.onProgress?.(progress);
      },
      onPartial: partial => {
        if (live()) handlers?.onPartial?.(partial);
      },
      shouldStop: () => !live(),
    });
  }

  cancel(): void {
    this.generation += 1;
    if (this.workers.length === 0) return;
    const cancelled = new Error('cancelled');
    for (const handle of this.workers) {
      handle.worker.terminate();
      for (const entry of handle.pending.values()) entry.reject(cancelled);
      handle.pending.clear();
    }
    this.workers = [];
  }

  dispose(): void {
    this.cancel();
  }
}
