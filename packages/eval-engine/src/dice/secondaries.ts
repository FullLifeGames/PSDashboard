import { secondaryEffectId } from './recognize.ts';
import type { SecondaryEntry } from './types.ts';

/**
 * Round 82 (forced dice), step A6: what the log reader (`loggedDice`) takes from the Dex. The effect ids (the words of
 * `secondaryEffectId`) of the entries of a move's secondaries that carry a chance below 100, from the Dex of the game's own rule
 * set (`battle.dex` or `rulesDex`). With them a secondary the log shows nothing of is a logged no.
 */
export function secondariesIn(dex: { moves: { get(id: string): unknown } }): (moveId: string) => string[] {
  return moveId => {
    const move = dex.moves.get(moveId) as { secondaries?: SecondaryEntry[] | null; secondary?: SecondaryEntry | null };
    const entries = move.secondaries ?? (move.secondary ? [move.secondary] : []);
    return entries.filter(entry => entry.chance !== undefined && entry.chance < 100).map(entry => secondaryEffectId(entry));
  };
}
