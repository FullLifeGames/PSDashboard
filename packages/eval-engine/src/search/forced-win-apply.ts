import {
  ENDGAME_MAX_BODIES, MIN_FORCED_MASS, PROVER_SCORE_FLOOR, type EvalResult, type EvalSettings, type ForcedWinInput, type ForcedWinOutcome,
  type RankedChoice,
} from '../types.ts';

/** Score units within which ranked rows are one near tie; inside it the prover's root order goes by label. */
export const PROVER_NEAR_TIE = 0.02;

function proverRootOrder(rows: RankedChoice[]): string[] {
  const order: string[] = [];
  let group: RankedChoice[] = [];
  const flush = () => {
    order.push(...group.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)).map(row => row.choice));
    group = [];
  };
  for (const row of rows) {
    if (group.length > 0 && group[0].ev - row.ev > PROVER_NEAR_TIE) flush();
    group.push(row);
  }
  flush();
  return order;
}

/** The prover's input from a finished search; sim-free, so the main thread can build it for the pool path. */
export function forcedWinInput(result: EvalResult, settings: EvalSettings): ForcedWinInput {
  return {
    score: result.score,
    ...(result.unanswered ? { unanswered: result.unanswered } : {}),
    rootOrder: { p1: proverRootOrder(result.perSide.p1), p2: proverRootOrder(result.perSide.p2) },
    ...(settings.tera !== undefined ? { tera: settings.tera } : {}),
    ...(settings.sleepClause !== undefined ? { sleepClause: settings.sleepClause } : {}),
    ...(settings.ruleset !== undefined ? { ruleset: settings.ruleset } : {}),
  };
}

interface SerializedBodies { ended?: boolean; sides?: { pokemon?: { fainted?: boolean }[] }[] }

/** Sim-free mirror of the prover's trigger: false only where a worker round trip would return nothing. */
export function forcedWinPossible(serializedBattle: string, input: ForcedWinInput): boolean {
  const named = Boolean(input.unanswered?.decided || input.unanswered?.nearDecided);
  if (named && Math.abs(input.score) >= PROVER_SCORE_FLOOR) return true;
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

/** Moves the score by the proof; a proof at exactly MIN_FORCED_MASS (a coin flip) moves none. */
export function applyForcedWin(result: EvalResult, outcome: ForcedWinOutcome | null): void {
  if (!outcome || outcome.proof.mass < MIN_FORCED_MASS) return;
  const { side, proof } = outcome;
  const sign = side === 'p1' ? 1 : -1;
  const openValue = proof.openValue ?? result.score;
  result.forcedWin = {
    side, turns: proof.turns, mass: proof.mass, caveat: proof.caveat,
    ...(proof.delay ? { delay: proof.delay } : {}),
    ...(proof.choice ? { choice: proof.choice } : {}),
    ...(proof.delayName ? { delayName: proof.delayName } : {}),
    ...(proof.choiceNames ? { choiceNames: proof.choiceNames } : {}),
    ...(proof.open ? { open: proof.open } : {}),
    engineScore: result.score, states: proof.states,
  };
  if (proof.mass > MIN_FORCED_MASS) result.score = proof.mass * sign + (1 - proof.mass) * openValue;
}
