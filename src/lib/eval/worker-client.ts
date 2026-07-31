import type { EvalResult, EvalSettings, EvalWorkerResponse, SearchProgress } from './types';

export interface EvalRunHandlers {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
}

/**
 * One search at a time. Cancellation terminates the worker outright — a
 * synchronous search never yields to onmessage, so termination is the only
 * reliable stop — and the next evaluate() builds a fresh one.
 */
export class EvalWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; reject(error: Error): void } | null = null;

  private ensureWorker(): Worker {
    this.worker ??= new Worker(new URL('../../workers/eval-worker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }

  evaluate(serializedBattle: string, settings: EvalSettings, handlers?: EvalRunHandlers): Promise<EvalResult> {
    this.cancel();
    const worker = this.ensureWorker();
    const id = this.nextId++;

    return new Promise<EvalResult>((resolve, reject) => {
      this.pending = { id, reject };
      worker.onmessage = (event: MessageEvent<EvalWorkerResponse>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === 'progress') handlers?.onProgress?.(message.progress);
        else if (message.type === 'partial') handlers?.onPartial?.(message.result);
        else if (message.type === 'result') { this.pending = null; resolve(message.result); }
        else if (message.type === 'error') { this.pending = null; reject(new Error(message.message)); }
      };
      worker.onerror = event => {
        this.pending = null;
        reject(new Error(event.message || 'evaluation worker crashed'));
      };
      worker.postMessage({ type: 'search', id, serializedBattle, settings });
    });
  }

  cancel(): void {
    if (!this.pending) return;
    this.worker?.terminate();
    this.worker = null;
    const pending = this.pending;
    this.pending = null;
    pending.reject(new Error('cancelled'));
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
