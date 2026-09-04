import type { Battle } from '@pkmn/sim';
import { endgameScope } from '../endgame/solver.ts';
import { proveForcedWin } from '../endgame/prover.ts';
import { createMatchupCache } from '../eval-function.ts';
import { positionBattle, type SimPosition } from '../forward-model.ts';
import { lastPairRace } from '../score/last-pair.ts';
import { MIN_FORCED_MASS, type ForcedWinInput, type ForcedWinOutcome } from '../types.ts';

type Side = 'p1' | 'p2';

/**
 * Where the prover runs (round 35): small endgames (at most three living
 * bodies), the last pair, and any board the decided sweep or the near
 * stage names. The favored side first (the profile's side, else the
 * score's sign); the other side only in the endgame scope, where a failed
 * attempt is cheap.
 */
export function forcedWinSides(battle: Battle, input: ForcedWinInput): Side[] {
  if (battle.ended) return [];
  const named = input.unanswered?.decided?.side ?? input.unanswered?.nearDecided?.side;
  const endgame = endgameScope(battle);
  const pair = !endgame && lastPairRace(battle, createMatchupCache()) !== null;
  if (!endgame && !pair && !named) return [];
  const favored: Side = named ?? (input.score >= 0 ? 'p1' : 'p2');
  const other: Side = favored === 'p1' ? 'p2' : 'p1';
  return endgame ? [favored, other] : [favored];
}

/** The proof for the first side that reaches the threshold, or null; the states spent carry over between attempts. */
export function forcedWinFor(root: SimPosition, input: ForcedWinInput): ForcedWinOutcome | null {
  const battle = positionBattle(root);
  let spent = 0;
  for (const side of forcedWinSides(battle, input)) {
    const proof = proveForcedWin(root, {
      side, rootOrder: input.rootOrder[side], tera: input.tera, sleepClause: input.sleepClause, spent,
    });
    if (proof.mass >= MIN_FORCED_MASS) return { side, proof };
    spent = proof.states;
  }
  return null;
}
