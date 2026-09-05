import { vi } from 'vitest';
import type { EvalWorkerRequest, EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { ReplayWorkerClient, type WorkerLike } from '../../src/lib/replay-jobs/client';
import type { ReplayJobRequest, ReplayJobResponse } from '../../src/lib/replay-jobs/types';

type EvalScript = (request: EvalWorkerRequest) => EvalWorkerResponse[];

/**
 * The evaluation pool's Worker, scripted: `FakeWorker.answer` maps every
 * request to the responses the worker posts back (in order, one microtask
 * apart). The pool creates one instance per worker slot; `instances` lets a
 * test count spawns and terminations.
 */
export class FakeWorker {
  static instances: FakeWorker[] = [];
  static answer: EvalScript = () => [];
  static requests: EvalWorkerRequest[] = [];
  onmessage: ((event: MessageEvent<EvalWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly url: URL | string;
  readonly options: WorkerOptions | undefined;

  constructor(url: URL | string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  postMessage(request: EvalWorkerRequest): void {
    FakeWorker.requests.push(request);
    for (const response of FakeWorker.answer(request)) {
      queueMicrotask(() => {
        if (!this.terminated) this.onmessage?.({ data: { ...response, id: request.id } } as MessageEvent<EvalWorkerResponse>);
      });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  static reset(): void {
    FakeWorker.instances = [];
    FakeWorker.requests = [];
    FakeWorker.answer = () => [];
  }
}

/** Installs the fake as the global Worker for the current test and returns the class for scripting. */
export function installFakeWorker(answer?: EvalScript): typeof FakeWorker {
  FakeWorker.reset();
  if (answer) FakeWorker.answer = answer;
  vi.stubGlobal('Worker', FakeWorker);
  return FakeWorker;
}

type ReplayScript = (request: ReplayJobRequest) => ReplayJobResponse[];

/**
 * A replay worker client over a scripted WorkerLike: every job request is
 * answered with the responses the script returns (ids filled in). The
 * client's own queueing, cancellation, and respawn logic stays real.
 */
export function fakeReplayWorkerClient(script: ReplayScript) {
  const requests: ReplayJobRequest[] = [];
  let spawns = 0;
  const spawn = (): WorkerLike => {
    spawns += 1;
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(request) {
        requests.push(request);
        for (const response of script(request)) {
          queueMicrotask(() => worker.onmessage?.({ data: { ...response, id: request.id } }));
        }
      },
      terminate() {},
    };
    return worker;
  };
  const client = new ReplayWorkerClient(spawn);
  return { client, requests, spawnCount: () => spawns };
}
