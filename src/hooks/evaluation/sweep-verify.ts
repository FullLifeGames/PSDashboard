import {
  REGRET_THRESHOLD, type SensitivityProbe, type TurnSensitivity, type TurnVerification, patchSerializedItem,
  selectProbeCombos, type PlayedTurn, type EvalResult, type RankedChoice,
} from '@fulllifegames/eval-engine';
import { EvalWorkerClient, type AppEvalSettings } from '../../lib/eval/worker-client';
import { registerPatchedWorlds } from '../../lib/eval/world-positions';
import { matchOrPhantom, type SweepEnv } from './sweep-types';

/** The tier a flagged turn re-adjudicates at: matrix pairs one depth up; null when the ladder (cap 3) is spent. */
export function verificationDeepSettings(settings: AppEvalSettings): AppEvalSettings | null {
  if ((settings.mode ?? 'matrix') === 'mcts') {
    return { ...settings, depth: 2, mode: 'matrix', keepPlayed: undefined };
  }
  if (settings.depth > 2) return null;
  return { ...settings, depth: (settings.depth + 1) as 2 | 3, mode: 'matrix', keepPlayed: undefined };
}

/** Deep re-search before a misplay verdict sticks; the position is acquired only when a flag needs it. */
export async function verifyFlagged(
  env: SweepEnv,
  getSerialized: () => Promise<string>,
  result: EvalResult,
  turnPlayed: PlayedTurn | null,
  settings: AppEvalSettings,
): Promise<TurnVerification | null> {
  const deep = verificationDeepSettings(settings);
  if (!deep) return null;
  const p1Choice = matchOrPhantom(result, 'p1', turnPlayed, env.params.rules);
  const p2Choice = matchOrPhantom(result, 'p2', turnPlayed, env.params.rules);
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
  probeSettings: AppEvalSettings;
}): Promise<SensitivityProbe[]> {
  const { combos, serialized, side, sign, p1Choice, p2Choice, best, probeSettings } = args;
  const opposing = side === 'p1' ? 'p2' : 'p1';
  const probes: SensitivityProbe[] = [];
  for (const combo of combos) {
    const patched = patchSerializedItem(serialized, opposing, combo.species, combo.item);
    if (!patched) continue;
    // The edited item is valued in every world of a short-side position; a world without the body leaves the blend.
    registerPatchedWorlds(serialized, patched, world => patchSerializedItem(world, opposing, combo.species, combo.item));
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
  probeSettings: AppEvalSettings;
  turnVerified: TurnVerification | null;
}): Promise<SensitivityProbe[] | null> {
  const { side, getSerialized, result, p1Choice, p2Choice, probeSettings, turnVerified } = args;
  const chosen = side === 'p1' ? p1Choice : p2Choice;
  const best = result.perSide[side][0];
  if (!best || best.ev - chosen.ev < REGRET_THRESHOLD) return null;
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

/** Item-sensitivity probes for still-flagged sides, at most 2 combos per side; downstream they only acquit. */
export async function probeSensitivity(
  env: SweepEnv,
  getSerialized: () => Promise<string>,
  result: EvalResult,
  turnPlayed: PlayedTurn | null,
  settings: AppEvalSettings,
  turnVerified: TurnVerification | null,
): Promise<TurnSensitivity | null> {
  if (!env.params.sensitivityTargetsFor) return null;
  const p1Choice = matchOrPhantom(result, 'p1', turnPlayed, env.params.rules);
  const p2Choice = matchOrPhantom(result, 'p2', turnPlayed, env.params.rules);
  if (!p1Choice || !p2Choice) return null;
  const probeSettings: AppEvalSettings = { ...settings, keepPlayed: undefined };
  const out: TurnSensitivity = {};
  for (const side of ['p1', 'p2'] as const) {
    const probes = await probeSide(env, { side, getSerialized, result, p1Choice, p2Choice, probeSettings, turnVerified });
    if (probes) out[side] = probes;
  }
  return out.p1 || out.p2 ? out : null;
}
