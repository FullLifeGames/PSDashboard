import {
  type TurnSensitivity, type TurnVerification, type PlayedTurn, perfSpan, type EvalResult, type EvalSettings,
  teraKey, type TeraAllowance,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient } from '../../lib/eval/worker-client';
import { runInLanes } from '../../lib/eval/lanes';
import { evalPoolSize, lanesForPool } from '../../lib/eval/pool-size';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../../lib/eval-cache-store';
import { resolveAutoTurnSettings, serializedFaintedFraction, supersedesStored, type EngineMode } from './prefs';
import type { CachedEval } from './single-eval';
import {
  guardedStage,
  aborted, isCancelled, matchOrPhantom, recordEvalError,
  type SweepEnv, type SweepSettings, type TurnEngine, type TurnStageArgs,
} from './sweep-types';
import { probeSensitivity, verifyFlagged } from './sweep-verify';
import { installCachedTurn } from './sweep-cached';

/**
 * Turns the graph sweep evaluates concurrently. One turn's search already
 * fans out to the worker pool, but its serial sections (the choices RPC,
 * the four fixed MCTS trees, the played-pair/verify/sensitivity pair evals)
 * leave workers idle; a short pipeline keeps the pool fed. Half the pool
 * (pool-size.ts), so a bigger pool also pipelines more turns. Turns are
 * mutually independent (own position, fixed seeds, own per-turn slots and
 * cache keys), so lanes change wall-clock, never results.
 */
const TURN_LANES = lanesForPool(evalPoolSize());

/**
 * Resolve 'auto' to this turn's concrete engine BEFORE any cache or
 * store-key work — stored results only ever carry concrete modes.
 * The fainted fraction comes from the same serialized position the
 * engine will evaluate (the app-side mirror of the harness rule).
 */
async function resolveTurnEngine(
  env: SweepEnv, turn: number, settings: SweepSettings,
): Promise<'abort' | 'gap' | TurnEngine> {
  let { depth, samples } = settings;
  let mode: EngineMode = settings.mode === 'auto' ? 'matrix' : (settings.mode ?? 'matrix');
  if (settings.mode === 'auto') {
    let fraction = env.data.faintedFractions[turn - 1];
    if (fraction === null) {
      try {
        fraction = serializedFaintedFraction(await env.positionFor(turn));
      } catch (err) {
        if (aborted(env)) return 'abort';
        if (isCancelled(err)) return 'abort';
        // Reconstruction failed — leave the gap, as the eval path would.
        return 'gap';
      }
      if (aborted(env)) return 'abort';
      env.data.faintedFractions[turn - 1] = fraction;
    }
    ({ depth, samples, mode } = resolveAutoTurnSettings(fraction));
  }
  return { depth, samples, mode, ...(settings.prove === false ? { prove: false } : {}) };
}

/** A cached result serves a request unless it is a sketch (no prover) and the request is not. */
const proveMatches = (hit: { prove?: boolean }, engine: TurnEngine): boolean => hit.prove !== false || engine.prove === false;
/** The sketch marker a cache entry or a settings object carries (round 35). */
const sketchFields = (engine: { prove?: boolean }): { prove?: false } => (engine.prove === false ? { prove: false } : {});
/** The in-memory hit serves when engine, tera, and the sketch marker agree. */
const memoryHitMatches = (hit: CachedEval | undefined, engine: TurnEngine, tera: TeraAllowance): hit is CachedEval =>
  hit !== undefined && hit.depth === engine.depth && hit.samples === engine.samples && hit.mode === engine.mode
  && teraKey(hit.tera) === teraKey(tera) && proveMatches(hit, engine);

/** The two cache layers: the in-memory hit, then the run's prefetched store (one store read when no prefetch could run). */
async function loadTurnHit(
  env: SweepEnv, key: string, storeKey: string, engine: TurnEngine,
): Promise<'abort' | CachedEval | undefined> {
  const { depth, samples, mode } = engine;
  let hit = env.cacheRef.current.get(key);
  if (!memoryHitMatches(hit, engine, env.params.tera)) {
    let stored = env.prefetched
      ? (env.prefetched.get(storeKey) ?? null)
      : await perfSpan('cache-load', () => loadStoredEval(storeKey));
    if (aborted(env)) return 'abort';
    if (stored && !proveMatches(stored, engine)) stored = null;
    hit = stored ? {
      result: stored.result, depth, samples, mode: mode, tera: env.params.tera,
      ...sketchFields(stored),
      ...(stored.playedOutcome !== undefined ? { playedOutcome: stored.playedOutcome } : {}),
      ...(stored.verified !== undefined ? { verified: stored.verified } : {}),
      ...(stored.sensitivity !== undefined ? { sensitivity: stored.sensitivity } : {}),
    } : undefined;
    if (hit) env.cacheRef.current.set(key, hit);
  }
  return hit;
}

/** The engine's expectation of the real choices — the decision
 *  part of the coming swing (chance is the rest). */
async function computeFreshPlayedOutcome(
  env: SweepEnv, client: EvalWorkerClient, serialized: string, result: EvalResult,
  turnPlayed: PlayedTurn | null, engine: TurnEngine,
): Promise<'abort' | { value: number | null }> {
  const { depth, samples, mode } = engine;
  let outcome: number | null = null;
  const p1Choice = matchOrPhantom(result, 'p1', turnPlayed);
  const p2Choice = matchOrPhantom(result, 'p2', turnPlayed);
  if (p1Choice && p2Choice) {
    const paired = await guardedStage(env, () => perfSpan('played-pair', () =>
      client.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: env.params.tera, sleepClause: env.params.sleepClause })));
    if (paired === 'abort') return 'abort';
    outcome = paired;
  }
  return { value: outcome };
}

/** Verification and sensitivity on a freshly evaluated turn (final-verdict passes only). */
async function verifyAndProbeFresh(
  env: SweepEnv, serialized: string, result: EvalResult, turnPlayed: PlayedTurn | null,
  resolvedSettings: EvalSettings, turn: number,
): Promise<'abort' | { turnVerified: TurnVerification | null; turnSensitivity: TurnSensitivity | null }> {
  const turnVerified = await guardedStage(env, () =>
    perfSpan('verify', () => verifyFlagged(env, () => Promise.resolve(serialized), result, turnPlayed, resolvedSettings)));
  if (turnVerified === 'abort') return 'abort';
  env.data.verified[turn - 1] = turnVerified;
  const turnSensitivity = await guardedStage(env, () =>
    perfSpan('sensitivity', () => probeSensitivity(env, () => Promise.resolve(serialized), result, turnPlayed, resolvedSettings, turnVerified ?? null)));
  if (turnSensitivity === 'abort') return 'abort';
  env.data.sensitivity[turn - 1] = turnSensitivity;
  return { turnVerified, turnSensitivity };
}

/** Search a turn that no cache layer covered, then install and persist everything it produced. */
async function runFreshEvaluation(
  env: SweepEnv, serialized: string, args: Omit<TurnStageArgs, 'hit'>, verify: boolean,
): Promise<boolean> {
  const { key, storeKey, turn, turnPlayed, engine, resolvedSettings } = args;
  const { depth, samples, mode } = engine;
  const { data } = env;
  if (aborted(env)) return false;
  env.clientRef.current ??= new EvalWorkerClient();
  const client = env.clientRef.current;
  const keepPlayed = turnPlayed?.p1Slots || turnPlayed?.p2Slots ? turnPlayed : undefined;
  const result = await perfSpan(`evaluate[${mode}-d${depth}s${samples}]`, () =>
    // exclusive: false — pipelined turns share the pool and
    // must not cancel each other; the run's own cancel path
    // still kills them all at once.
    client.evaluate(serialized, {
      depth, samples, mode, tera: env.params.tera, keepPlayed, sleepClause: env.params.sleepClause, ...sketchFields(engine),
    }, undefined, { exclusive: false }));
  if (aborted(env)) return false;
  data.scores[turn - 1] = result.score;
  data.evalErrors[turn - 1] = null;
  data.results[turn - 1] = result;
  data.turnSettings[turn - 1] = { depth, samples, mode };

  const outcomeStage = await computeFreshPlayedOutcome(env, client, serialized, result, turnPlayed, engine);
  if (outcomeStage === 'abort') return false;
  data.playedOutcome[turn - 1] = outcomeStage.value;

  let turnVerified: TurnVerification | null | undefined;
  let turnSensitivity: TurnSensitivity | null | undefined;
  if (verify) {
    const stage = await verifyAndProbeFresh(env, serialized, result, turnPlayed, resolvedSettings, turn);
    if (stage === 'abort') return false;
    ({ turnVerified, turnSensitivity } = stage);
  }
  env.cacheRef.current.set(key, {
    result, depth, samples, mode: mode, tera: env.params.tera, ...sketchFields(engine),
    playedOutcome: outcomeStage.value,
    ...(turnVerified !== undefined ? { verified: turnVerified } : {}),
    ...(turnSensitivity !== undefined ? { sensitivity: turnSensitivity } : {}),
  });
  void saveStoredEval({
    key: storeKey, result, depth, samples, mode: mode, tera: env.params.tera, ...sketchFields(engine),
    playedOutcome: outcomeStage.value,
    ...(turnVerified !== undefined ? { verified: turnVerified } : {}),
    ...(turnSensitivity !== undefined ? { sensitivity: turnSensitivity } : {}),
    savedAt: Date.now(),
  });
  return true;
}

/** The no-hit path: acquire the position (gaps stay gaps) and run the fresh evaluation. */
async function evaluateFreshTurn(
  env: SweepEnv, args: Omit<TurnStageArgs, 'hit'>, verify: boolean,
): Promise<boolean> {
  // Acquisition failure = the coverage notice's story; only a
  // THROWING EVAL on a live position is an eval-layer gap.
  let acquired: string | null = null;
  try {
    acquired = await env.positionFor(args.turn);
  } catch (err) {
    if (aborted(env)) return false;
    if (isCancelled(err)) return false;
    // Reconstruction failed — leave the gap, as before.
  }
  if (acquired !== null) {
    try {
      if (!(await runFreshEvaluation(env, acquired, args, verify))) return false;
    } catch (err) {
      if (aborted(env)) return false;
      if (isCancelled(err)) return false;
      // Eval-layer failure on a live position — keep the reason.
      recordEvalError(env.data.evalErrors, env.data.scores, args.turn, err);
    }
  }
  return true;
}

/** One turn of one pass: engine resolution, monotone merge, cache layers, then install or search. */
async function evalTurn(
  env: SweepEnv, turn: number, settings: SweepSettings, verify: boolean, finishTurn: () => void,
): Promise<boolean> {
  if (aborted(env)) return false;
  const resolution = await resolveTurnEngine(env, turn, settings);
  if (resolution === 'abort') return false;
  if (resolution === 'gap') {
    finishTurn();
    return true;
  }
  const { depth, samples, mode, prove } = resolution;
  const key = env.params.cacheKeyFor(turn);
  const storeKey = evalStoreKey(key, depth, samples, mode, env.params.tera);
  const turnPlayed = env.params.playedFor(turn);
  env.data.played[turn - 1] = turnPlayed;
  const engine: TurnEngine = { depth, samples, mode, ...sketchFields({ prove }) };
  const resolvedSettings: EvalSettings = {
    depth, samples, mode, tera: env.params.tera, sleepClause: env.params.sleepClause, ...sketchFields(engine),
  };

  // Monotone merge: the graph already holds a deeper result for this
  // turn (an explicit deepen, a deeper prior sweep) — every stored
  // field stands and this pass skips the turn entirely.
  if (!supersedesStored(env.data.turnSettings[turn - 1], { depth, samples, mode }, env.configuredMode, env.data.faintedFractions[turn - 1])) {
    finishTurn();
    return true;
  }

  const hit = await loadTurnHit(env, key, storeKey, engine);
  if (hit === 'abort') return false;
  const stageArgs = { key, storeKey, turn, turnPlayed, engine, resolvedSettings };
  if (hit) {
    if (!(await installCachedTurn(env, { ...stageArgs, hit }, verify))) return false;
  } else if (!(await evaluateFreshTurn(env, stageArgs, verify))) {
    return false;
  }
  finishTurn();
  return true;
}

/**
 * One pass over `turnList` at `settings`; false = cancelled. Turns run
 * through a short pipeline (TURN_LANES lanes) — each turn is fully
 * independent, so lanes only change wall-clock, never results; a
 * turn's own verification/sensitivity chain stays inside its turn.
 * `verify` runs the depth+1 misplay verification — final-verdict passes
 * only, never the fast shaping pass (its results are provisional).
 */
export async function sweepTurns(
  env: SweepEnv, turnList: number[], settings: SweepSettings, verify: boolean,
): Promise<boolean> {
  let completed = 0;
  const finishTurn = () => {
    completed += 1;
    env.paint({ done: completed, total: turnList.length });
  };
  if (!(await runInLanes(TURN_LANES, turnList.length, index => evalTurn(env, turnList[index], settings, verify, finishTurn)))) return false;
  env.paint({ done: turnList.length, total: turnList.length }, true);
  return true;
}
