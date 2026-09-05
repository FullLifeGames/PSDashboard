import {
  ENDGAME_MAX_BODIES, MIN_FORCED_MASS, type EvalResult, type EvalSettings, type ForcedWinInput, type ForcedWinOutcome,
} from '../types.ts';

/**
 * The prover's contract with a finished search (round 35), sim-free so the
 * main thread can build the input and apply the bar for the pool path.
 */
export function forcedWinInput(result: EvalResult, settings: EvalSettings): ForcedWinInput {
  return {
    score: result.score,
    ...(result.unanswered ? { unanswered: result.unanswered } : {}),
    rootOrder: { p1: result.perSide.p1.map(row => row.choice), p2: result.perSide.p2.map(row => row.choice) },
    ...(settings.tera !== undefined ? { tera: settings.tera } : {}),
    ...(settings.sleepClause !== undefined ? { sleepClause: settings.sleepClause } : {}),
  };
}

interface SerializedBodies { ended?: boolean; sides?: { pokemon?: { fainted?: boolean }[] }[] }

/**
 * Sim-free mirror of the prover's trigger, for the main thread: a named
 * decided or near side, at most ENDGAME_MAX_BODIES living bodies, or the
 * last pair. Conservative: true wherever the sim-side check could fire,
 * false only where a worker round trip would certainly return nothing.
 */
export function forcedWinPossible(serializedBattle: string, input: ForcedWinInput): boolean {
  if (input.unanswered?.decided || input.unanswered?.nearDecided) return true;
  let battle: SerializedBodies;
  try {
    battle = JSON.parse(serializedBattle) as SerializedBodies;
  } catch {
    return true;
  }
  if (battle.ended) return false;
  const living = (battle.sides ?? []).map(side => (side.pokemon ?? []).filter(mon => !mon.fainted).length);
  if (living.length !== 2) return true;
  return living[0] + living[1] <= ENDGAME_MAX_BODIES || (living[0] === 1 && living[1] === 1);
}

/** The bar: mass toward the proven side, the rest at the open branch's static; matrix and ranking untouched. */
export function applyForcedWin(result: EvalResult, outcome: ForcedWinOutcome | null): void {
  if (!outcome || outcome.proof.mass < MIN_FORCED_MASS) return;
  const { side, proof } = outcome;
  const sign = side === 'p1' ? 1 : -1;
  const openValue = proof.openValue ?? result.score;
  result.forcedWin = {
    side, turns: proof.turns, mass: proof.mass, caveat: proof.caveat,
    ...(proof.open ? { open: proof.open } : {}),
    engineScore: result.score, states: proof.states,
  };
  result.score = proof.mass * sign + (1 - proof.mass) * openValue;
}
