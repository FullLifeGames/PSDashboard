import {
  blendValues, blendWorlds, searchOrchestrated, searchTreesOrchestrated, forcedWinPossible,
  type SearchExecutor, type TreeExecutor, type EvalCellValue, type EvalResult, type EvalSettings, type EvalWorkerRequest,
  type EvalWorkerResponse, type MctsTreeStats, type SearchProgress, type StaticRuleset, type WinPaths, type WinPathsRequest,
} from '@fulllifegames/eval-engine';
import { evalPoolSize } from './pool-size';
import { selectedEngine } from './engine-setting';
import { searchBudgetStamp } from './search-budget-setting';
import { simFastLevers } from './sim-fast-setting';
import { OnRequestJobs, type WinPathsHandlers } from './on-request-jobs';
import { spawnWorker, type WorkerHandle } from './worker-handle';
import { worldPositionsOf, type WorldPosition } from './world-positions';

// Loads with the first evaluation another engine answers: a static import would put the simulator's Pokemon class into the start load.
const engineEvaluate = () => import('./engine-evaluate');

export interface EvalRunHandlers {
  onProgress?(progress: SearchProgress): void;
  onPartial?(result: EvalResult): void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// A caller without a rule set is refused before any message instead of priced with the standard table (the worker refuses too).
const MISSING_RULESET = 'evaluation without a rule set';

export type AppEvalSettings = EvalSettings & { ruleset: StaticRuleset };

/**
 * Sub-search settings that value a played pair like the sweep's own cells: depth-1 matrix cells are static evals already
 * (null = use the plain cell path); deeper searches deepen their cells with a depth-(d-1) sub-search. MCTS has no
 * fixed-depth equivalent, so a depth-1 sub-search approximates it. The Sleep Clause rides along because serialization
 * strips a custom game's clause from the rule table the sub-search would fall back on.
 */
export function playedOutcomeSettings(settings: EvalSettings): EvalSettings | null {
  const mode = settings.mode ?? 'matrix';
  if (mode !== 'mcts' && settings.depth <= 1) return null;
  const depth = (mode === 'mcts' ? 1 : Math.min(settings.depth - 1, 2)) as 1 | 2;
  return { depth, samples: 1, tera: settings.tera, mode: 'matrix', sleepClause: settings.sleepClause, ruleset: settings.ruleset };
}

/** Orchestrates the evaluation on the main thread (no sim) and fans the sim work out to a pool of workers; one search at a time. */
export class EvalWorkerClient {
  private workers: WorkerHandle[] = [];
  private nextId = 1;
  private generation = 0;
  private jobs = new OnRequestJobs();

  private ensureWorkers(): WorkerHandle[] {
    while (this.workers.length < evalPoolSize()) {
      this.workers.push(spawnWorker(crashed => { this.workers = this.workers.filter(other => other !== crashed); }));
    }
    return this.workers;
  }

  /**
   * Least-loaded worker (ties keep the lowest index). Placement must never affect results: every job is a pure function of
   * its message, which holds only while every engine memo is a function of its key. It affects only queueing.
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
      handle.worker.postMessage({ ...request, id, simFast: simFastLevers(), searchBudget: searchBudgetStamp() });
    });
  }

  private createPooledExecutor(serializedBattle: string, ruleset: StaticRuleset): SearchExecutor {
    let roundRobin = 0;
    return {
      choices: async (tera, keepPlayed, sleepClause) => {
        const response = await this.rpc(this.pickWorker(), { type: 'choices', serializedBattle, tera, keepPlayed, sleepClause, ruleset });
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
            const response = await this.rpc(handle, { type: 'cells', serializedBattle, jobs: chunk, ruleset });
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
        const response = await this.rpc(handle, { type: 'subsearch', serializedBattle, job, ruleset });
        if (response.type !== 'result') throw new Error('unexpected worker response');
        return response.result;
      },
      prove: async input => {
        if (!forcedWinPossible(serializedBattle, input)) return null;
        const response = await this.rpc(this.pickWorker(), { type: 'prove', serializedBattle, input, ruleset });
        if (response.type !== 'proveResult') throw new Error('unexpected worker response');
        return response.outcome;
      },
      lines: async input => {
        const response = await this.rpc(this.pickWorker(), { type: 'lines', serializedBattle, input, ruleset });
        if (response.type !== 'linesResult') throw new Error('unexpected worker response');
        return response.lines;
      },
    };
  }

  /**
   * A position the world registry knows (a short-side game's heaviest world) runs once per world and comes back blended by usage.
   * The first world takes the caller's `exclusive` and streams its partials; the rest never cancel it. Another engine over HTTP
   * reads the heaviest world alone.
   */
  evaluate(
    serializedBattle: string,
    settings: AppEvalSettings,
    handlers?: EvalRunHandlers,
    opts?: { exclusive?: boolean },
  ): Promise<EvalResult> {
    const worlds = selectedEngine() ? null : worldPositionsOf(serializedBattle);
    if (!worlds) return this.evaluateOne(serializedBattle, settings, handlers, opts);
    return this.evaluateWorlds(worlds, settings, handlers, opts);
  }

  private async evaluateWorlds(
    worlds: readonly WorldPosition[],
    settings: AppEvalSettings,
    handlers: EvalRunHandlers | undefined,
    opts: { exclusive?: boolean } | undefined,
  ): Promise<EvalResult> {
    // The first world's evaluation bumps the generation when it is exclusive, so the loop reads it right after that call.
    const first = this.evaluateOne(worlds[0].position, settings, handlers && { ...handlers, onProgress: this.worldProgress(handlers, 0, worlds.length) }, opts);
    const generation = this.generation;
    const results = [await first];
    const weights = [worlds[0].weight];
    for (let index = 1; index < worlds.length; index += 1) {
      if (generation !== this.generation) throw new Error('cancelled');
      try {
        const progress = handlers?.onProgress && { onProgress: this.worldProgress(handlers, index, worlds.length) };
        results.push(await this.evaluateOne(worlds[index].position, settings, progress, { exclusive: false }));
        weights.push(worlds[index].weight);
      } catch (error) {
        // A lighter world that cannot answer leaves the blend; a cancel ends the loop.
        if (generation !== this.generation) throw error;
      }
    }
    return blendWorlds(results, weights);
  }

  private worldProgress(handlers: EvalRunHandlers, index: number, count: number): EvalRunHandlers['onProgress'] {
    const { onProgress } = handlers;
    if (!onProgress) return undefined;
    return progress => onProgress({ ...progress, done: progress.done + index * progress.total, total: progress.total * count });
  }

  private evaluateOne(
    serializedBattle: string,
    settings: AppEvalSettings,
    handlers?: EvalRunHandlers,
    opts?: { exclusive?: boolean },
  ): Promise<EvalResult> {
    const ruleset = settings.ruleset;
    if (!ruleset) return Promise.reject(new Error(MISSING_RULESET));
    // Exclusive (the default): a fresh evaluation supersedes whatever is running. The graph sweep passes exclusive: false and
    // pipelines several turns through the shared pool; they all die together on the next real cancel().
    if (opts?.exclusive !== false) this.cancel();
    const generation = this.generation;
    const live = () => generation === this.generation;

    const callbacks = {
      onProgress: (progress: SearchProgress) => {
        if (live()) handlers?.onProgress?.(progress);
      },
      // A listener is what makes tree 0 compute its interim result; the game analysis and the play-out pass none.
      ...(handlers?.onPartial && { onPartial: (partial: EvalResult) => { if (live()) handlers.onPartial?.(partial); } }),
      shouldStop: () => !live(),
    };
    // Another engine answers over HTTP; the pool still lists the options it ranks.
    const engine = selectedEngine();
    if (engine) {
      return engineEvaluate().then(({ evaluateWithEngine }) =>
        evaluateWithEngine(engine, serializedBattle, this.createPooledExecutor(serializedBattle, ruleset), settings, live));
    }
    if (settings.mode === 'mcts') {
      return searchTreesOrchestrated(this.createPooledTreeExecutor(serializedBattle, live, ruleset), settings, callbacks);
    }
    return searchOrchestrated(this.createPooledExecutor(serializedBattle, ruleset), settings, callbacks);
  }

  private runTree(
    serializedBattle: string,
    settings: EvalSettings,
    offset: number,
    live: () => boolean,
    onProgress: (progress: SearchProgress) => void,
    onPartial?: (result: EvalResult) => void,
  ): Promise<MctsTreeStats> {
    const handle = this.pickWorker();
    const id = this.nextId++;
    return new Promise<MctsTreeStats>((resolve, reject) => {
      handle.pending.set(id, {
        resolve: response => {
          if (response.type === 'mctsTreeResult') resolve(response.tree);
          else reject(new Error('unexpected worker response'));
        },
        reject,
        onStream: response => {
          if (!live()) return;
          if (response.type === 'progress') onProgress(response.progress);
          else if (response.type === 'partial') onPartial?.(response.result);
        },
      });
      handle.worker.postMessage({
        type: 'mctstree', id, serializedBattle, settings, seedOffset: offset, simFast: simFastLevers(), searchBudget: searchBudgetStamp(),
        ...(onPartial && { partials: true as const }),
      });
    });
  }

  private createPooledTreeExecutor(serializedBattle: string, live: () => boolean, ruleset: StaticRuleset): TreeExecutor {
    return {
      ...this.createPooledExecutor(serializedBattle, ruleset),
      tree: (settings, seedOffset, onProgress, onPartial) =>
        this.runTree(serializedBattle, settings, seedOffset, live, onProgress ?? (() => undefined), onPartial),
    };
  }

  /**
   * Engine expectation of one joint choice pair, valued at the same depth as the surrounding sweep (see playedOutcomeSettings):
   * a shallow static value against deep before/after scores would leak estimator disagreement into the decision/chance split.
   */
  async evalPair(serializedBattle: string, p1Choice: string, p2Choice: string, settings: AppEvalSettings): Promise<number> {
    const worlds = selectedEngine() ? null : worldPositionsOf(serializedBattle);
    if (!worlds) return this.evalPairOne(serializedBattle, p1Choice, p2Choice, settings);
    const generation = this.generation;
    const values: number[] = [];
    const weights: number[] = [];
    for (const [index, world] of worlds.entries()) {
      if (generation !== this.generation) throw new Error('cancelled');
      try {
        values.push(await this.evalPairOne(world.position, p1Choice, p2Choice, settings));
        weights.push(world.weight);
      } catch (error) {
        // The heaviest world must answer; a lighter one that cannot leaves the blend, and a cancel ends the loop.
        if (index === 0 || generation !== this.generation) throw error;
      }
    }
    return blendValues(values, weights);
  }

  private async evalPairOne(serializedBattle: string, p1Choice: string, p2Choice: string, settings: AppEvalSettings): Promise<number> {
    const ruleset = settings.ruleset;
    if (!ruleset) throw new Error(MISSING_RULESET);
    const engine = selectedEngine();
    if (engine) {
      const generation = this.generation;
      const { evalPairWithEngine } = await engineEvaluate();
      return evalPairWithEngine(engine, serializedBattle, p1Choice, p2Choice, () => generation === this.generation);
    }
    const handle = this.pickWorker();
    const subSettings = playedOutcomeSettings(settings);
    if (subSettings) {
      const response = await this.rpc(handle, {
        type: 'subsearch',
        serializedBattle,
        job: { i: 0, j: 0, p1Choice, p2Choice, settings: subSettings },
        ruleset,
      });
      if (response.type !== 'result') throw new Error('unexpected worker response');
      return response.result.score;
    }
    const response = await this.rpc(handle, {
      type: 'cells',
      serializedBattle,
      jobs: [{ i: 0, j: 0, p1Choice, p2Choice, samples: 1 }],
      ruleset,
    });
    if (response.type !== 'cellsResult' || response.values.length === 0) {
      throw new Error('unexpected worker response');
    }
    return response.values[0].value;
  }

  /** Runs on a worker of its own (see `OnRequestJobs`): a sweep's `cancel` leaves it, and its `signal` leaves the sweep. */
  winPaths(serializedBattle: string, request: WinPathsRequest, ruleset: StaticRuleset, handlers?: WinPathsHandlers): Promise<WinPaths> {
    return this.jobs.winPaths(serializedBattle, request, ruleset, handlers);
  }

  cancel(): void {
    this.generation += 1;
    if (this.workers.length === 0) return;
    const cancelled = new Error('cancelled');
    // Only busy workers are terminated: a synchronous search never yields to onmessage, so termination is the only reliable
    // stop. Idle workers stay warm across turns; ensureWorkers() refills what termination took.
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
    this.jobs.dispose();
  }
}
