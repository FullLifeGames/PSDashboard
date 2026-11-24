import { vi } from 'vitest';
import type { EvalWorkerRequest, EvalWorkerResponse } from '@fulllifegames/eval-engine';
import { ReplayWorkerClient, type WorkerLike } from '../../../src/lib/replay-jobs/client';
import type { ReplayJobRequest, ReplayJobResponse } from '../../../src/lib/replay-jobs/types';

type EvalScript = (request: EvalWorkerRequest) => EvalWorkerResponse[];

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

export function installFakeWorker(answer?: EvalScript): typeof FakeWorker {
  FakeWorker.reset();
  if (answer) FakeWorker.answer = answer;
  vi.stubGlobal('Worker', FakeWorker);
  return FakeWorker;
}

type ReplayScript = (request: ReplayJobRequest) => ReplayJobResponse[] | Promise<ReplayJobResponse[]>;

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
        void Promise.resolve(script(request)).then(responses => {
          for (const response of responses) {
            queueMicrotask(() => worker.onmessage?.({ data: { ...response, id: request.id } }));
          }
        });
      },
      terminate() {},
    };
    return worker;
  };
  const client = new ReplayWorkerClient(spawn);
  return { client, requests, spawnCount: () => spawns };
}

export function realReplayWorkerClient() {
  const requests: ReplayJobRequest[] = [];
  const spawn = (): WorkerLike => {
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(request) {
        requests.push(request);
        void import('../../../src/lib/replay-jobs/handlers').then(({ handleReplayJob }) =>
          handleReplayJob(request, response => worker.onmessage?.({ data: response })));
      },
      terminate() {},
    };
    return worker;
  };
  return { client: new ReplayWorkerClient(spawn), requests };
}
