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

/** The copy's result under the copy's key, in memory and in the store. */
function remember(env: SweepEnv, engine: TurnEvalSettings, key: string, storeKey: string, result: EvalResult): void {
  env.cacheRef.current.set(key, { result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false });
  void saveStoredEval({
    key: storeKey, result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false,
    savedAt: Date.now(),
  });
}

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
    remember(env, engine, key, storeKey, result);
    return result;
  } catch (err) {
    if (aborted(env) || isCancelled(err)) return 'abort';
    return null;
  }
}

/**
 * The copy of the roll's turn: the turn's start position through the worker. The pool of the sweep gives its workers back first: a long
 * game ends its sweep with twelve of them and the replay worker alive (573756: about 6.2 GB in the renderer), and the copy's worker as
 * one more took the whole page down, so the feedback test hung for 40 minutes. The evaluation after it refills the pool.
 */
async function copyOf(env: SweepEnv, params: RolledCopyParams, roll: BiggestRoll): Promise<'abort' | RolledCopyOutcome | null> {
  try {
    // A run that took over owns the pool now: only the run that still holds it gives it back.
    if (aborted(env)) return 'abort';
    env.clientRef.current?.dispose();
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
  if (copy.stage === 'ended' && copy.terminal !== null) {
    // Round 88 (T326, #62): the end's score is cached too (a result with no search behind it: interval 0, depth 0, no ranked choices), so a
    // second sweep of a game that ends in its biggest roll plays no copy and rebuilds no position.
    remember(env, engine, key, storeKey, { score: copy.terminal, interval: 0, depthCompleted: 0, perSide: { p1: [], p2: [] } });
    return { turn: roll.turn, score: copy.terminal };
  }
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
