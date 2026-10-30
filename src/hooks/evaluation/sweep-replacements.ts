import { perfSpan, teraKey, type EvalResult, type ReplacementEvalData, type ReplacementRound } from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { evalStoreKey, loadStoredEval, saveStoredEval } from '../../lib/eval-cache-store';
import type { TurnEvalSettings } from './prefs';
import { aborted, isCancelled, type SweepEnv } from './sweep-types';

/**
 * Round 79 (T290): the sweep's last stage, after the lead. Every request round the protocol shows (a knockout and the replacement
 * the player picked) is priced once, at the position the reconstruction held when the request opened, with the engine the turn
 * that follows ran. The record lands under that turn's card. Nothing here grades, and a round without a position, a search or a
 * card is a silent gap: the turns, the report and the verdicts never read this stage.
 */

/** The in-memory entry, else the persisted one (the run's prefetch, or one read when no prefetch could run). */
async function loadReplacementResult(
  env: SweepEnv, engine: TurnEvalSettings, key: string, storeKey: string,
): Promise<'abort' | EvalResult | null> {
  const memory = env.cacheRef.current.get(key);
  if (memory && memory.depth === engine.depth && memory.samples === engine.samples && memory.mode === engine.mode
    && teraKey(memory.tera) === teraKey(env.params.tera)) return memory.result;
  const stored = env.prefetched ? (env.prefetched.get(storeKey) ?? null) : await loadStoredEval(storeKey);
  if (aborted(env)) return 'abort';
  if (!stored) return null;
  env.cacheRef.current.set(key, { result: stored.result, depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera, prove: false });
  return stored.result;
}

/** Search the open request (no forced-win proof: nothing is graded) and persist the result. */
async function searchReplacement(
  env: SweepEnv, round: ReplacementRound, engine: TurnEvalSettings, key: string, storeKey: string,
): Promise<'abort' | EvalResult | null> {
  try {
    const serialized = await env.replacementPositionFor?.(round.turn, round.ordinal);
    if (aborted(env)) return 'abort';
    if (!serialized) return null;
    env.clientRef.current ??= new EvalWorkerClient();
    const settings: AppEvalSettings = {
      depth: engine.depth, samples: engine.samples, mode: engine.mode, tera: env.params.tera,
      sleepClause: env.params.sleepClause, ruleset: env.params.ruleset, prove: false,
    };
    const result = await perfSpan('replacement', () => env.clientRef.current!.evaluate(serialized, settings));
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

/** One round: from the cache, else searched. 'abort' = the run changed hands. */
async function replacementOf(env: SweepEnv, round: ReplacementRound): Promise<'abort' | ReplacementEvalData | null> {
  const { replacementKeyFor } = env.params;
  // The card of turn t + 1 sits at index t; the engine is the one that card's turn ran.
  const engine = env.data.turnSettings[round.turn];
  if (!replacementKeyFor || !engine || round.turn >= env.params.turns) return null;
  const key = replacementKeyFor(round.turn, round.ordinal);
  const storeKey = evalStoreKey(key, engine.depth, engine.samples, engine.mode, env.params.tera);
  const cached = await loadReplacementResult(env, engine, key, storeKey);
  if (cached === 'abort') return 'abort';
  const result = cached ?? await searchReplacement(env, round, engine, key, storeKey);
  if (result === 'abort') return 'abort';
  if (!result) return null;
  return { turn: round.turn, ordinal: round.ordinal, result, forced: round.slots, played: round.species };
}

/** false = aborted (the caller must skip the finalize, as after the lead). */
export async function evaluateReplacements(env: SweepEnv, paintFinal: (running: boolean) => void): Promise<boolean> {
  const rounds = env.params.replacementRounds;
  if (!rounds?.length || aborted(env)) return true;
  for (const round of rounds) {
    const data = await replacementOf(env, round);
    if (data === 'abort') return false;
    if (!data) continue;
    const records = [...(env.data.replacements[data.turn] ?? []).filter(entry => entry.ordinal !== data.ordinal), data];
    env.data.replacements[data.turn] = records.sort((a, b) => a.ordinal - b.ordinal);
    paintFinal(true);
  }
  return true;
}
