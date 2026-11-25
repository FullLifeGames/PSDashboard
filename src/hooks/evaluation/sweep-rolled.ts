import { perfSpan, type BiggestRoll, type EvalResult, type RollFlip } from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { evalStoreKey, saveStoredEval } from '../../lib/eval-cache-store';
import type { RolledCopyOutcome } from '../../lib/replay-jobs/types';
import type { TurnEvalSettings } from './prefs';
import type { RolledCopyParams } from '../../lib/rolled-copy-stage';
import { loadCachedResult } from './sweep-replacements';
import { aborted, isCancelled, type SweepEnv } from './sweep-types';


function remember(env: SweepEnv, engine: TurnEvalSettings, key: string, storeKey: string, result: EvalResult): void {
  env.cacheRef.current.set(key, { result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false });
  void saveStoredEval({
    key: storeKey, result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false,
    savedAt: Date.now(),
  });
}

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

// Runs after the pool gives its workers back: twelve alive plus the replay worker, and one more took the page down.
async function copyOf(env: SweepEnv, params: RolledCopyParams, roll: BiggestRoll): Promise<'abort' | RolledCopyOutcome | null> {
  try {
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
    remember(env, engine, key, storeKey, { score: copy.terminal, interval: 0, depthCompleted: 0, perSide: { p1: [], p2: [] } });
    return { turn: roll.turn, score: copy.terminal };
  }
  const result = await searchCopy(env, copy.serialized, engine, key, storeKey);
  if (result === 'abort' || result === null) return result;
  return { turn: roll.turn, score: result.score };
}

/** false = aborted: the caller must skip the finalize. */
export async function evaluateRolledCopy(env: SweepEnv): Promise<boolean> {
  const params = env.params.rolledCopy;
  if (!params || aborted(env)) return true;
  const roll = params.namedRoll(env.data);
  const flip = roll ? await flipOf(env, params, roll) : null;
  if (flip === 'abort') return false;
  env.data.rollFlip = flip;
  return true;
}
