import { MCTS_TREES, mergeMctsTrees, starvedSupportCells } from './mcts-merge';
import { perfAdd, perfCount, perfSync } from './perf-trace';
import { cellKey } from './rank';
import { searchOrchestrated, type SearchExecutor } from './orchestrator';
import type {
  EvalCellValue, EvalResult, EvalSettings, EvalWorkerRequest, EvalWorkerResponse, MctsTreeStats, SearchProgress,
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

/**
 * Sub-search settings that value a played pair with the same machinery the
 * sweep's own cells get: depth-1 matrix cells are static evals already
 * (null = use the plain cell path); deeper searches deepen their cells with
 * a depth-(d−1) sub-search, so the played pair gets exactly that. MCTS has
 * no fixed-depth equivalent — a depth-1 sub-search is the approximation.
 */
export function playedOutcomeSettings(settings: EvalSettings): EvalSettings | null {
  const mode = settings.mode ?? 'matrix';
  if (mode !== 'mcts' && settings.depth <= 1) return null;
  const depth = (mode === 'mcts' ? 1 : Math.min(settings.depth - 1, 2)) as 1 | 2;
  return { depth, samples: 1, tera: settings.tera, mode: 'matrix' };
}

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
 * at a time; cancellation terminates the BUSY workers — a worker's
 * synchronous search never yields to onmessage, so termination is the only
 * reliable stop — while idle workers stay warm across evaluations, and
 * ensureWorkers() refills whatever termination took.
 */
export class EvalWorkerClient {
  private workers: WorkerHandle[] = [];
  private nextId = 1;
  private generation = 0;

  private ensureWorkers(): WorkerHandle[] {
    while (this.workers.length < poolSize()) {
      perfCount('workerSpawn');
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
        // A crashed worker leaves the pool — the pool outlives single
        // evaluations now, and a dead worker would swallow the next RPC
        // without ever answering it.
        handle.worker.terminate();
        this.workers = this.workers.filter(other => other !== handle);
      };
      this.workers.push(handle);
    }
    return this.workers;
  }

  /**
   * Least-loaded worker (ties keep the lowest index). Placement never
   * affects results — every job is a pure function of its message — only
   * queueing: pinning to worker 0 serialized the pair-eval phases and
   * stacked concurrent turns' trees onto the same few workers.
   */
  private pickWorker(): WorkerHandle {
    const workers = this.ensureWorkers();
    let best = workers[0];
    for (const handle of workers) {
      if (handle.pending.size < best.pending.size) best = handle;
    }
    return best;
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
      choices: async (tera, keepPlayed, sleepClause) => {
        const response = await this.rpc(this.pickWorker(), { type: 'choices', serializedBattle, tera, keepPlayed, sleepClause });
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

  evaluate(
    serializedBattle: string,
    settings: EvalSettings,
    handlers?: EvalRunHandlers,
    opts?: { exclusive?: boolean },
  ): Promise<EvalResult> {
    // Exclusive (the default): a fresh evaluation supersedes whatever is
    // running — the single-result panel's semantics. The graph sweep
    // passes exclusive: false and pipelines several independent turns
    // through the shared pool; they all die together on the next real
    // cancel(), whose generation bump invalidates every live() below.
    if (opts?.exclusive !== false) this.cancel();
    const generation = this.generation;
    const live = () => generation === this.generation;

    if (settings.mode === 'mcts') return this.evaluateMcts(serializedBattle, settings, handlers, live);

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

  /**
   * Root parallelization: a FIXED number of independent trees (seed
   * offsets 0..N−1) spread across the pool and merged by summed root
   * statistics. The count never follows the pool size — results must
   * not vary by machine; small pools just run trees in rounds.
   */
  private evaluateMcts(
    serializedBattle: string,
    settings: EvalSettings,
    handlers: EvalRunHandlers | undefined,
    live: () => boolean,
  ): Promise<EvalResult> {
    const doneByTree = new Array(MCTS_TREES).fill(0);
    let totalPerTree = 1;
    const completed: MctsTreeStats[] = [];
    const trees = Array.from({ length: MCTS_TREES }, (_, offset) => this.runTree(
      serializedBattle, settings, offset, live,
      progress => {
        doneByTree[offset] = progress.done;
        totalPerTree = progress.total;
        handlers?.onProgress?.({
          done: doneByTree.reduce((sum, done) => sum + done, 0),
          total: MCTS_TREES * totalPerTree,
          depth: progress.depth,
        });
      },
      tree => {
        if (live()) {
          completed.push(tree);
          handlers?.onPartial?.(perfSync('main:mcts-merge', () => mergeMctsTrees([...completed])));
        }
      },
    ));
    return Promise.all(trees).then(allTrees => this.verifiedMerge(serializedBattle, allTrees, handlers, live));
  }

  /** Posts one MCTS tree to the least-loaded worker; progress streams while the evaluation is live. */
  private runTree(
    serializedBattle: string,
    settings: EvalSettings,
    offset: number,
    live: () => boolean,
    onProgress: (progress: SearchProgress) => void,
    onDone: (tree: MctsTreeStats) => void,
  ): Promise<MctsTreeStats> {
    const handle = this.pickWorker();
    const id = this.nextId++;
    const postedAt = Date.now();
    return new Promise<MctsTreeStats>((resolve, reject) => {
      handle.pending.set(id, {
        resolve: response => {
          if (response.type === 'mctsTreeResult') resolve(response.tree);
          else reject(new Error('unexpected worker response'));
        },
        reject,
        onStream: response => {
          if (!live() || response.type !== 'progress') return;
          onProgress(response.progress);
        },
      });
      handle.worker.postMessage({ type: 'mctstree', id, serializedBattle, settings, seedOffset: offset });
    }).then(tree => {
      perfAdd('tree-wall', Date.now() - postedAt);
      onDone(tree);
      return tree;
    });
  }

  /**
   * Starved-support verification: cells the merged equilibrium leans on
   * with too few pooled visits carry ONE chance outcome per tree — re-price
   * them with the matrix-grade multi-seed sampler before the verdict stands
   * (draft t56: a lucky Draco Meteor miss promoted a sack). The score is
   * visit-mean either way; only rankings sharpen.
   */
  private async verifiedMerge(
    serializedBattle: string,
    allTrees: MctsTreeStats[],
    handlers: EvalRunHandlers | undefined,
    live: () => boolean,
  ): Promise<EvalResult> {
    const merged = perfSync('main:mcts-merge', () => mergeMctsTrees(allTrees));
    if (!live()) return merged;
    const jobs = perfSync('main:starved-cells', () => starvedSupportCells(allTrees, merged));
    if (jobs.length === 0) return merged;
    handlers?.onPartial?.(merged);
    try {
      const values = await this.createPooledExecutor(serializedBattle).evalCells(jobs);
      if (!live()) return merged;
      return perfSync('main:mcts-merge', () =>
        mergeMctsTrees(allTrees, new Map(values.map(value => [cellKey(value.i, value.j), value]))));
    } catch {
      // Verification is a refinement — a failed round degrades to the
      // unverified merge instead of failing the whole search.
      return merged;
    }
  }

  /**
   * Engine expectation of one specific joint choice pair, valued at the
   * SAME depth as the surrounding sweep (see playedOutcomeSettings) — a
   * shallow static value against deep before/after scores would leak
   * estimator disagreement into the decision/chance decomposition.
   */
  async evalPair(serializedBattle: string, p1Choice: string, p2Choice: string, settings: EvalSettings): Promise<number> {
    const handle = this.pickWorker();
    const subSettings = playedOutcomeSettings(settings);
    if (subSettings) {
      const response = await this.rpc(handle, {
        type: 'subsearch',
        serializedBattle,
        job: { i: 0, j: 0, p1Choice, p2Choice, settings: subSettings },
      });
      if (response.type !== 'result') throw new Error('unexpected worker response');
      return response.result.score;
    }
    const response = await this.rpc(handle, {
      type: 'cells',
      serializedBattle,
      jobs: [{ i: 0, j: 0, p1Choice, p2Choice, samples: 1 }],
    });
    if (response.type !== 'cellsResult' || response.values.length === 0) {
      throw new Error('unexpected worker response');
    }
    return response.values[0].value;
  }

  cancel(): void {
    this.generation += 1;
    if (this.workers.length === 0) return;
    const cancelled = new Error('cancelled');
    // Only BUSY workers are terminated: a synchronous search never yields
    // to onmessage, so termination is the only reliable stop for those.
    // Idle workers (no pending RPC) have nothing to stop and stay warm —
    // the routine turn-to-turn path of a sweep, which used to pay a fresh
    // worker spawn (bundle parse and all) per turn per worker.
    this.workers = this.workers.filter(handle => {
      if (handle.pending.size === 0) return true;
      handle.worker.terminate();
      for (const entry of handle.pending.values()) entry.reject(cancelled);
      handle.pending.clear();
      return false;
    });
  }

  dispose(): void {
    this.cancel();
    for (const handle of this.workers) handle.worker.terminate();
    this.workers = [];
  }
}
