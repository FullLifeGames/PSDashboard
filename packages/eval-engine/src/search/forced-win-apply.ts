import { MIN_FORCED_MASS, type EvalResult, type EvalSettings, type ForcedWinInput, type ForcedWinOutcome } from '../types.ts';

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
