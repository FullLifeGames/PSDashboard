import {
  REGRET_THRESHOLD,
  type SensitivityProbe, type TurnSensitivity, type TurnVerification,
} from '../../lib/eval/analysis';
import { patchSerializedItem, selectProbeCombos } from '../../lib/eval/sensitivity';
import type { PlayedTurn } from '../../lib/eval/played';
import { EvalWorkerClient } from '../../lib/eval/worker-client';
import type { EvalResult, EvalSettings, RankedChoice } from '../../lib/eval/types';
import { matchOrPhantom, type SweepEnv } from './sweep-types';

/**
 * The tier a flagged turn re-adjudicates at: matrix pairs one depth up.
 * ENGINE-INDEPENDENT — an MCTS-line flag verifies at the same matrix-d2
 * tier the d1 matrix line gets. Sound because the verdict statistic
 * (bestDeep − playedDeep vs the threshold) is internal to the deep pass,
 * and pair valuation under any settings already runs as matrix subsearches
 * (playedOutcomeSettings). null = no tier left (the ladder caps at the
 * engine's depth 3).
 */
export function verificationDeepSettings(settings: EvalSettings): EvalSettings | null {
  if ((settings.mode ?? 'matrix') === 'mcts') {
    return { ...settings, depth: 2, mode: 'matrix', keepPlayed: undefined };
  }
  if (settings.depth > 2) return null;
  return { ...settings, depth: (settings.depth + 1) as 2 | 3, mode: 'matrix', keepPlayed: undefined };
}

/**
 * Deep re-search before a misplay verdict sticks (chess.com's sacrifice
 * verification): for each side whose played choice trails the best by
 * the regret threshold, value the played and best pairs at the matrix
 * verification tier (verificationDeepSettings — the line engine that
 * raised the flag is irrelevant to the deep verdict). Flag checks are
 * pure — the position is only acquired when needed.
 */
export async function verifyFlagged(
  env: SweepEnv,
  getSerialized: () => Promise<string>,
  result: EvalResult,
  turnPlayed: PlayedTurn | null,
  settings: EvalSettings,
): Promise<TurnVerification | null> {
  const deep = verificationDeepSettings(settings);
  if (!deep) return null;
  const p1Choice = matchOrPhantom(result, 'p1', turnPlayed);
  const p2Choice = matchOrPhantom(result, 'p2', turnPlayed);
  if (!p1Choice || !p2Choice) return null;
  const flaggedBest = (side: 'p1' | 'p2', chosen: RankedChoice): RankedChoice | null => {
    const best = result.perSide[side][0];
    return best && best.ev - chosen.ev >= REGRET_THRESHOLD ? best : null;
  };
  const p1Best = flaggedBest('p1', p1Choice);
  const p2Best = flaggedBest('p2', p2Choice);
  if (!p1Best && !p2Best) return null;
  const serialized = await getSerialized();
  env.clientRef.current ??= new EvalWorkerClient();
  const playedDeep = await env.clientRef.current.evalPair(serialized, p1Choice.choice, p2Choice.choice, deep);
  const verification: TurnVerification = {};
  if (p1Best) {
    verification.p1 = {
      playedDeep,
      bestDeep: await env.clientRef.current.evalPair(serialized, p1Best.choice, p2Choice.choice, deep),
    };
  }
  if (p2Best) {
    verification.p2 = {
      playedDeep,
      bestDeep: await env.clientRef.current.evalPair(serialized, p1Choice.choice, p2Best.choice, deep),
    };
  }
  return verification;
}

async function runProbeCombos(env: SweepEnv, args: {
  combos: ReturnType<typeof selectProbeCombos>;
  serialized: string;
  side: 'p1' | 'p2';
  sign: number;
  p1Choice: RankedChoice;
  p2Choice: RankedChoice;
  best: RankedChoice;
  probeSettings: EvalSettings;
}): Promise<SensitivityProbe[]> {
  const { combos, serialized, side, sign, p1Choice, p2Choice, best, probeSettings } = args;
  const opposing = side === 'p1' ? 'p2' : 'p1';
  const probes: SensitivityProbe[] = [];
  for (const combo of combos) {
    const patched = patchSerializedItem(serialized, opposing, combo.species, combo.item);
    if (!patched) continue;
    env.clientRef.current ??= new EvalWorkerClient();
    const playedEv = await env.clientRef.current.evalPair(patched, p1Choice.choice, p2Choice.choice, probeSettings);
    const bestEv = side === 'p1'
      ? await env.clientRef.current.evalPair(patched, best.choice, p2Choice.choice, probeSettings)
      : await env.clientRef.current.evalPair(patched, p1Choice.choice, best.choice, probeSettings);
    probes.push({ species: combo.species, item: combo.item, playedEv: sign * playedEv, bestEv: sign * bestEv });
  }
  return probes;
}

async function probeSide(env: SweepEnv, args: {
  side: 'p1' | 'p2';
  getSerialized: () => Promise<string>;
  result: EvalResult;
  p1Choice: RankedChoice;
  p2Choice: RankedChoice;
  probeSettings: EvalSettings;
  turnVerified: TurnVerification | null;
}): Promise<SensitivityProbe[] | null> {
  const { side, getSerialized, result, p1Choice, p2Choice, probeSettings, turnVerified } = args;
  const chosen = side === 'p1' ? p1Choice : p2Choice;
  const best = result.perSide[side][0];
  if (!best || best.ev - chosen.ev < REGRET_THRESHOLD) return null;
  // The deep pass already acquitted this side — nothing left to soften.
  const sign = side === 'p1' ? 1 : -1;
  const deepSide = turnVerified?.[side];
  if (deepSide && Math.max(0, sign * (deepSide.bestDeep - deepSide.playedDeep)) < REGRET_THRESHOLD) return null;
  const opposing = side === 'p1' ? 'p2' : 'p1';
  const targets = env.params.sensitivityTargetsFor!(opposing);
  if (targets.length === 0) return null;
  const serialized = await getSerialized();
  const opposingPlayed = side === 'p1' ? p2Choice : p1Choice;
  const opposingLabels = [opposingPlayed.label, ...(result.perSide[opposing][0] ? [result.perSide[opposing][0].label] : [])];
  const combos = selectProbeCombos(serialized, opposing, targets, opposingLabels);
  const probes = await runProbeCombos(env, { combos, serialized, side, sign, p1Choice, p2Choice, best, probeSettings });
  return probes.length > 0 ? probes : null;
}

/**
 * Item-sensitivity probes for sides still flagged AFTER verification:
 * re-evaluate the played and best pairs with an opposing guessed item
 * swapped for its next usage candidates (≤2 combos per side = ≤4 extra
 * pair-evals). Probes run at the sweep's own settings; pair valuation is
 * engine-independent (an MCTS line's pairs value as matrix subsearches),
 * and the acquit statistic compares only probe EVs with each other.
 * Acquit-only downstream (analyzeTurn) — this only gathers evidence.
 */
export async function probeSensitivity(
  env: SweepEnv,
  getSerialized: () => Promise<string>,
  result: EvalResult,
  turnPlayed: PlayedTurn | null,
  settings: EvalSettings,
  turnVerified: TurnVerification | null,
): Promise<TurnSensitivity | null> {
  if (!env.params.sensitivityTargetsFor) return null;
  const p1Choice = matchOrPhantom(result, 'p1', turnPlayed);
  const p2Choice = matchOrPhantom(result, 'p2', turnPlayed);
  if (!p1Choice || !p2Choice) return null;
  const probeSettings: EvalSettings = { ...settings, keepPlayed: undefined };
  const out: TurnSensitivity = {};
  for (const side of ['p1', 'p2'] as const) {
    const probes = await probeSide(env, { side, getSerialized, result, p1Choice, p2Choice, probeSettings, turnVerified });
    if (probes) out[side] = probes;
  }
  return out.p1 || out.p2 ? out : null;
}
