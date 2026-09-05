import type { SpreadCandidate } from '@fulllifegames/replay-core';
import type {
  ReconstructJob, ReconstructOutcome, ReplayJobRequest, ReplayJobResponse, SolveSpreadsJob,
} from './types';

/** The slice of the Worker interface the client uses — a test hands in a fake. */
export interface WorkerLike {
  postMessage(message: ReplayJobRequest): void;
  terminate(): void;
  onmessage: ((event: { data: ReplayJobResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface ReconstructHandlers {
  onProgress?(turn: number, target: number): void;
  onPosition?(turn: number, serialized: string): void;
}

interface Pending {
  request: ReplayJobRequest;
  handlers: ReconstructHandlers;
  resolve(response: ReplayJobResponse): void;
  reject(error: Error): void;
}

const CANCELLED = 'cancelled';

const spawnWorker = (): WorkerLike =>
  new Worker(new URL('../../workers/eval-worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

/**
 * One worker for the replay jobs (spread solve, reconstruction), separate
 * from the evaluation pool so an evaluation's cancel never terminates a
 * reconstruction in flight. Jobs run one after another; cancelling the
 * running job terminates the worker (a synchronous run never yields to
 * onmessage), and the next job spawns a fresh one. The worker script is
 * the pool's — one bundle, cached by the browser.
 */
export class ReplayWorkerClient {
  private readonly spawn: () => WorkerLike;
  private worker: WorkerLike | null = null;
  private queue: Pending[] = [];
  private active: Pending | null = null;
  private nextId = 1;

  constructor(spawn: () => WorkerLike = spawnWorker) {
    this.spawn = spawn;
  }

  async reconstruct(job: ReconstructJob, handlers: ReconstructHandlers = {}, signal?: AbortSignal): Promise<ReconstructOutcome> {
    const response = await this.run({ type: 'reconstruct', id: this.nextId++, job }, handlers, signal);
    if (response.type !== 'reconstructResult') throw new Error('unexpected replay worker response');
    return response.outcome;
  }

  async solveSpreads(job: SolveSpreadsJob, signal?: AbortSignal): Promise<Map<string, SpreadCandidate>> {
    const response = await this.run({ type: 'solveSpreads', id: this.nextId++, job }, {}, signal);
    if (response.type !== 'solveSpreadsResult') throw new Error('unexpected replay worker response');
    return new Map(response.entries);
  }

  /** Terminates the worker and rejects every job; a later job spawns anew. */
  dispose(): void {
    const cancelled = new Error(CANCELLED);
    for (const pending of this.queue) pending.reject(cancelled);
    this.queue = [];
    this.terminateWorker();
    if (this.active) {
      this.active.reject(cancelled);
      this.active = null;
    }
  }

  private run(request: ReplayJobRequest, handlers: ReconstructHandlers, signal?: AbortSignal): Promise<ReplayJobResponse> {
    return new Promise<ReplayJobResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(CANCELLED));
        return;
      }
      const pending: Pending = { request, handlers, resolve, reject };
      signal?.addEventListener('abort', () => this.cancel(pending), { once: true });
      this.queue.push(pending);
      this.pump();
    });
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    this.ensureWorker().postMessage(next.request);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.spawn();
    worker.onmessage = event => this.receive(event.data);
    worker.onerror = event => {
      // A crashed worker takes its job with it; the next job gets a fresh one.
      const error = new Error(event.message || 'replay worker crashed');
      this.terminateWorker();
      this.settle(pending => pending.reject(error));
    };
    this.worker = worker;
    return worker;
  }

  private receive(response: ReplayJobResponse): void {
    const active = this.active;
    if (!active || response.id !== active.request.id) return;
    if (response.type === 'replayProgress') {
      active.handlers.onProgress?.(response.turn, response.target);
    } else if (response.type === 'replayPosition') {
      active.handlers.onPosition?.(response.turn, response.serialized);
    } else if (response.type === 'replayError') {
      this.settle(pending => pending.reject(new Error(response.message)));
    } else {
      this.settle(pending => pending.resolve(response));
    }
  }

  /** Finishes the active job and starts the next one. */
  private settle(finish: (pending: Pending) => void): void {
    const active = this.active;
    this.active = null;
    if (active) finish(active);
    this.pump();
  }

  private cancel(pending: Pending): void {
    const cancelled = new Error(CANCELLED);
    if (this.active === pending) {
      this.terminateWorker();
      this.settle(entry => entry.reject(cancelled));
      return;
    }
    const index = this.queue.indexOf(pending);
    if (index < 0) return;
    this.queue.splice(index, 1);
    pending.reject(cancelled);
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
