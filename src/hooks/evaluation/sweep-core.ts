import {
  type TurnSensitivity, type TurnVerification, type PlayedTurn, perfSpan, type EvalResult,
  teraKey, type TeraAllowance,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
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
import { playedCellValue } from './played-cell';

/** Turns the sweep evaluates concurrently (half the pool): one turn's serial sections leave workers idle. Turns are independent
 *  (own position, fixed seeds, slots and cache keys), so lanes change wall-clock, never results. */
const TURN_LANES = lanesForPool(evalPoolSize());

/** Resolves 'auto' to the turn's concrete engine before any cache or store-key work (stored results carry concrete modes only);
 *  the fainted fraction comes from the serialized position the engine evaluates, and a cached fraction skips the position. */
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
        return 'gap';
      }
      if (aborted(env)) return 'abort';
      env.data.faintedFractions[turn - 1] = fraction;
    }
    ({ depth, samples, mode } = resolveAutoTurnSettings(fraction, env.params.doubles));
  }
  return { depth, samples, mode, ...(settings.prove === false ? { prove: false } : {}) };
}

/** A cached result serves a request unless it is a sketch (no prover) and the request is not. */
const proveMatches = (hit: { prove?: boolean }, engine: TurnEngine): boolean => hit.prove !== false || engine.prove === false;
/** The sketch marker (no prover) of a cache entry or a settings object. */
const sketchFields = (engine: { prove?: boolean }): { prove?: false } => (engine.prove === false ? { prove: false } : {});
const memoryHitMatches = (hit: CachedEval | undefined, engine: TurnEngine, tera: TeraAllowance): hit is CachedEval =>
  hit !== undefined && hit.depth === engine.depth && hit.samples === engine.samples && hit.mode === engine.mode
  && teraKey(hit.tera) === teraKey(tera) && proveMatches(hit, engine);

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

/** The engine's expectation of the real choices: the decision part of the coming swing (chance is the rest). */
async function computeFreshPlayedOutcome(
  env: SweepEnv, client: EvalWorkerClient, serialized: string, result: EvalResult,
  turnPlayed: PlayedTurn | null, engine: TurnEngine,
): Promise<'abort' | { value: number | null }> {
  const { depth, samples, mode } = engine;
  let outcome: number | null = null;
  const p1Choice = matchOrPhantom(result, 'p1', turnPlayed, env.params.rules);
  const p2Choice = matchOrPhantom(result, 'p2', turnPlayed, env.params.rules);
  // A tree turn prices the pair with the root's own cell; the sub-search stays where the pair is no cell.
  const cell = p1Choice && p2Choice && mode === 'mcts' ? playedCellValue(result, p1Choice.choice, p2Choice.choice) : null;
  if (cell !== null) return { value: cell };
  if (p1Choice && p2Choice) {
    const paired = await guardedStage(env, () => perfSpan('played-pair', () =>
      client.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: env.params.tera, sleepClause: env.params.sleepClause, ruleset: env.params.ruleset })));
    if (paired === 'abort') return 'abort';
    outcome = paired;
  }
  return { value: outcome };
}

/** Verification and sensitivity of a fresh turn (final-verdict passes only). */
async function verifyAndProbeFresh(
  env: SweepEnv, serialized: string, result: EvalResult, turnPlayed: PlayedTurn | null,
  resolvedSettings: AppEvalSettings, turn: number,
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

/** The played turn the search keeps: any doubles slot or singles action (the verify step joins its row and column). */
export const keptPlayed = (turnPlayed: PlayedTurn | null) =>
  (turnPlayed?.p1Slots || turnPlayed?.p2Slots || turnPlayed?.p1 || turnPlayed?.p2 ? turnPlayed : undefined);

async function runFreshEvaluation(
  env: SweepEnv, serialized: string, args: Omit<TurnStageArgs, 'hit'>, verify: boolean,
): Promise<boolean> {
  const { key, storeKey, turn, turnPlayed, engine, resolvedSettings } = args;
  const { depth, samples, mode } = engine;
  const { data } = env;
  if (aborted(env)) return false;
  env.clientRef.current ??= new EvalWorkerClient();
  const client = env.clientRef.current;
  const keepPlayed = keptPlayed(turnPlayed);
  const result = await perfSpan(`evaluate[${mode}-d${depth}s${samples}]`, () =>
    // exclusive: false, because pipelined turns share the pool and must not cancel each other.
    client.evaluate(serialized, {
      depth, samples, mode, tera: env.params.tera, keepPlayed, sleepClause: env.params.sleepClause, ruleset: env.params.ruleset, ...sketchFields(engine),
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

async function evaluateFreshTurn(
  env: SweepEnv, args: Omit<TurnStageArgs, 'hit'>, verify: boolean,
): Promise<boolean> {
  // A failed acquisition belongs to the coverage notice; only a throwing eval on a live position is an eval-layer gap.
  let acquired: string | null = null;
  try {
    acquired = await env.positionFor(args.turn);
  } catch (err) {
    if (aborted(env)) return false;
    if (isCancelled(err)) return false;
    // Reconstruction failed: the gap stays.
  }
  if (acquired !== null) {
    try {
      if (!(await runFreshEvaluation(env, acquired, args, verify))) return false;
    } catch (err) {
      if (aborted(env)) return false;
      if (isCancelled(err)) return false;
      recordEvalError(env.data.evalErrors, env.data.scores, args.turn, err);
    }
  }
  return true;
}

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
  const resolvedSettings: AppEvalSettings = {
    depth, samples, mode, tera: env.params.tera, sleepClause: env.params.sleepClause, ruleset: env.params.ruleset, ...sketchFields(engine),
  };

  // Monotone merge: skip the turn when the graph already holds a result this pass must not replace (a deeper one, an explicit
  // deepen, or the configured engine's result when this pass carries the other).
  if (!supersedesStored(env.data.turnSettings[turn - 1], { depth, samples, mode }, env.configuredMode, env.data.faintedFractions[turn - 1], env.params.doubles)) {
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

/** One pass over `turnList` at `settings`; false = cancelled. `verify` runs the depth+1 misplay verification: final-verdict passes
 *  only, never the fast shaping pass (its results are provisional). */
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
