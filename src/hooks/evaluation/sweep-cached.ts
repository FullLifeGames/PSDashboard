import type { TurnSensitivity, TurnVerification } from '../../lib/eval/analysis';
import { EvalWorkerClient } from '../../lib/eval/worker-client';
import { perfSpan } from '../../lib/eval/perf-trace';
import { saveStoredEval } from '../../lib/eval-cache-store';
import { aborted, isCancelled, matchOrPhantom, type SweepEnv, type TurnStageArgs } from './sweep-types';
import { probeSensitivity, verifyFlagged } from './sweep-verify';

/**
 * Entries written by single evaluations never computed the
 * played-pair expectation (undefined ≠ null = tried, unmatched) —
 * fill it in so the analysis gets its decision/chance split.
 */
async function backfillPlayedOutcome(
  env: SweepEnv, args: TurnStageArgs,
): Promise<'abort' | { value: number | null }> {
  const { hit, key, storeKey, turn, turnPlayed, engine } = args;
  const { depth, samples, mode } = engine;
  let outcome: number | null | undefined = hit.playedOutcome;
  if (outcome === undefined) {
    outcome = null;
    const p1Choice = matchOrPhantom(hit.result, 'p1', turnPlayed);
    const p2Choice = matchOrPhantom(hit.result, 'p2', turnPlayed);
    if (p1Choice && p2Choice) {
      try {
        const serialized = await env.positionFor(turn);
        if (aborted(env)) return 'abort';
        env.clientRef.current ??= new EvalWorkerClient();
        const client = env.clientRef.current;
        outcome = await perfSpan('played-pair', () =>
          client.evalPair(serialized, p1Choice.choice, p2Choice.choice, { depth, samples, mode, tera: env.params.tera, sleepClause: env.params.sleepClause }));
      } catch (err) {
        if (aborted(env)) return 'abort';
        if (isCancelled(err)) return 'abort';
      }
      if (aborted(env)) return 'abort';
    }
    env.cacheRef.current.set(key, { ...hit, playedOutcome: outcome });
    void saveStoredEval({
      key: storeKey, result: hit.result, depth, samples, mode: mode, tera: env.params.tera,
      playedOutcome: outcome, savedAt: Date.now(),
    });
  }
  return { value: outcome };
}

/** Verification backfill: cached entries from before the pass (or
 *  written by single evaluations) never verified their flags. */
async function backfillVerification(
  env: SweepEnv, args: TurnStageArgs, outcome: number | null, verify: boolean,
): Promise<'abort' | { value: TurnVerification | null | undefined }> {
  const { hit, key, storeKey, turn, turnPlayed, engine, resolvedSettings } = args;
  const { depth, samples, mode } = engine;
  let turnVerified: TurnVerification | null | undefined = hit.verified;
  if (verify && turnVerified === undefined) {
    turnVerified = null;
    try {
      turnVerified = await perfSpan('verify', () => verifyFlagged(env, () => env.positionFor(turn), hit.result, turnPlayed, resolvedSettings));
    } catch (err) {
      if (aborted(env)) return 'abort';
      if (isCancelled(err)) return 'abort';
    }
    if (aborted(env)) return 'abort';
    env.cacheRef.current.set(key, { ...env.cacheRef.current.get(key) ?? hit, verified: turnVerified });
    void saveStoredEval({
      key: storeKey, result: hit.result, depth, samples, mode: mode, tera: env.params.tera,
      playedOutcome: outcome ?? null, verified: turnVerified, savedAt: Date.now(),
    });
  }
  return { value: turnVerified };
}

/** Sensitivity backfill, same shape as the verification backfill. */
async function backfillSensitivity(
  env: SweepEnv, args: TurnStageArgs, outcome: number | null,
  turnVerified: TurnVerification | null | undefined, verify: boolean,
): Promise<'abort' | { value: TurnSensitivity | null | undefined }> {
  const { hit, key, storeKey, turn, turnPlayed, engine, resolvedSettings } = args;
  const { depth, samples, mode } = engine;
  let turnSensitivity: TurnSensitivity | null | undefined = hit.sensitivity;
  if (verify && turnSensitivity === undefined) {
    turnSensitivity = null;
    try {
      turnSensitivity = await perfSpan('sensitivity', () => probeSensitivity(env, () => env.positionFor(turn), hit.result, turnPlayed, resolvedSettings, turnVerified ?? null));
    } catch (err) {
      if (aborted(env)) return 'abort';
      if (isCancelled(err)) return 'abort';
    }
    if (aborted(env)) return 'abort';
    env.cacheRef.current.set(key, { ...env.cacheRef.current.get(key) ?? hit, sensitivity: turnSensitivity });
    void saveStoredEval({
      key: storeKey, result: hit.result, depth, samples, mode: mode, tera: env.params.tera,
      playedOutcome: outcome ?? null, verified: turnVerified ?? null,
      sensitivity: turnSensitivity, savedAt: Date.now(),
    });
  }
  return { value: turnSensitivity };
}

/** Install a cache/store hit into the graph arrays, backfilling what the entry never computed. */
export async function installCachedTurn(env: SweepEnv, args: TurnStageArgs, verify: boolean): Promise<boolean> {
  const { hit, turn, engine } = args;
  const { data } = env;
  data.scores[turn - 1] = hit.result.score;
  data.evalErrors[turn - 1] = null;
  data.results[turn - 1] = hit.result;
  data.turnSettings[turn - 1] = { depth: engine.depth, samples: engine.samples, mode: engine.mode };
  const outcomeStage = await backfillPlayedOutcome(env, args);
  if (outcomeStage === 'abort') return false;
  data.playedOutcome[turn - 1] = outcomeStage.value;
  const verifiedStage = await backfillVerification(env, args, outcomeStage.value, verify);
  if (verifiedStage === 'abort') return false;
  if (verifiedStage.value !== undefined) data.verified[turn - 1] = verifiedStage.value;
  const sensitivityStage = await backfillSensitivity(env, args, outcomeStage.value, verifiedStage.value, verify);
  if (sensitivityStage === 'abort') return false;
  if (sensitivityStage.value !== undefined) data.sensitivity[turn - 1] = sensitivityStage.value;
  return true;
}

