import { perfSpan, type BiggestRoll, type EvalResult, type RollFlip } from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { evalStoreKey, saveStoredEval } from '../../lib/eval-cache-store';
import type { RolledCopyOutcome } from '../../lib/replay-jobs/types';
import type { TurnEvalSettings } from './prefs';
import type { RolledCopyParams } from '../../lib/rolled-copy-stage';
import { loadCachedResult } from './sweep-replacements';
import { aborted, isCancelled, type SweepEnv } from './sweep-types';

/**
 * Round 86 (T304): the sweep's last stage, after the replacement points. The report names the game's biggest roll (a missed sure kill of the
 * winner) and says what a hit would have left. The roll comes from the report's own walk over the swept graph, the replay worker plays
 * the turn again with the die turned over, and the engine evaluates the copy's next root once, at the engine the actual next root ran
 * (the card of the turn that follows, as the replacement round prices its request). A game with no named roll costs nothing. The result
 * rides in the graph (`rollFlip`), so the report is complete when `graph.running` turns false. A copy the log cannot give, a worker
 * that fails and an evaluation that fails are silent: the sentence then speaks without the number.
 */

/** Search the copy's next root (no forced-win proof: nothing is graded) and persist the result. */
async function searchCopy(
  env: SweepEnv, serialized: string, engine: TurnEvalSettings, key: string, storeKey: string,
): Promise<'abort' | EvalResult | null> {
  try {
    env.clientRef.current ??= new EvalWorkerClient();
    const settings: AppEvalSettings = {
      depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera,
      sleepClause: env.params.sleepClause, ruleset: env.params.ruleset, prove: false,
    };
    const result = await perfSpan('rolled-copy', () => env.clientRef.current!.evaluate(serialized, settings));
    if (aborted(env)) return 'abort';
    env.cacheRef.current.set(key, { result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false });
    void saveStoredEval({
      key: storeKey, result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false,
      savedAt: Date.now(),
    });
    return result;
  } catch (err) {
    if (aborted(env) || isCancelled(err)) return 'abort';
    return null;
  }
}

/** The copy of the roll's turn: the turn's start position through the worker. */
async function copyOf(env: SweepEnv, params: RolledCopyParams, roll: BiggestRoll): Promise<'abort' | RolledCopyOutcome | null> {
  try {
    const position = await env.positionFor(roll.turn);
    if (aborted(env)) return 'abort';
    const copy = await params.playCopy(roll, position);
    return aborted(env) ? 'abort' : copy;
  } catch (err) {
    return aborted(env) || isCancelled(err) ? 'abort' : null;
  }
}

/** The score of the copy's next root: from the cache, else played and searched. A game that ends in the copy needs no search. */
async function flipOf(env: SweepEnv, params: RolledCopyParams, roll: BiggestRoll): Promise<'abort' | RollFlip | null> {
  // The card of turn t + 1 sits at index t; the engine is the one that card's turn ran.
  const engine = env.data.turnSettings[roll.turn];
  if (!engine) return null;
  const key = params.keyFor(roll.turn);
  const storeKey = evalStoreKey(key, engine.depth, engine.samples, engine.mode, env.params.tera);
  const cached = await loadCachedResult(env, engine, key, storeKey);
  if (cached === 'abort') return 'abort';
  if (cached) return { turn: roll.turn, score: cached.score };
  const copy = await copyOf(env, params, roll);
  if (copy === 'abort' || copy === null) return copy;
  if (copy.stage === 'ended' && copy.terminal !== null) return { turn: roll.turn, score: copy.terminal };
  const result = await searchCopy(env, copy.serialized, engine, key, storeKey);
  if (result === 'abort' || result === null) return result;
  return { turn: roll.turn, score: result.score };
}

/** false = aborted (the caller must skip the finalize, as after the replacement points). */
export async function evaluateRolledCopy(env: SweepEnv): Promise<boolean> {
  const params = env.params.rolledCopy;
  if (!params || aborted(env)) return true;
  const roll = params.namedRoll(env.data);
  const flip = roll ? await flipOf(env, params, roll) : null;
  if (flip === 'abort') return false;
  env.data.rollFlip = flip;
  return true;
}
