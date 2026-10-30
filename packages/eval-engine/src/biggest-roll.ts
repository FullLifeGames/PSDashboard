import type { TurnAnalysis } from './analysis.ts';
import { sureKillRoll } from './denied-end.ts';
import { percentBelowSure } from './prose/phrases.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { CHANCE_THRESHOLD } from './turn-analysis/types.ts';
import { winDeltaText } from './winprob.ts';

/**
 * Round 79 (T284): the game's biggest roll against the eventual winner. 573756 t73 was the largest roll of the game (a 95 %
 * Fire Fang missed, +0.269 for the side that lost) and the report spoke of another turn. The roll is the largest chance
 * of a turn whose dice went in the chance's own direction, toward the loser, and at least a mistake (CHANCE_THRESHOLD).
 * Pure — no sim imports, main-bundle safe.
 */

type Side = 'p1' | 'p2';

export interface BiggestRoll {
  turn: number;
  /** The side the roll helped: the game's loser. */
  side: Side;
  /** The chance part of the turn, toward that side (a score delta). */
  amount: number;
  /** The winner's played move, named only when it provably carried the roll. */
  move?: string;
  accuracy?: number;
}

const toward = (side: Side, delta: number): number => (side === 'p1' ? delta : -delta);

export function biggestRollFor(known: TurnAnalysis[], winner: Side): BiggestRoll | null {
  const loser: Side = winner === 'p1' ? 'p2' : 'p1';
  let best: BiggestRoll | null = null;
  for (const analysis of known) {
    if (analysis.chanceDelta === null || !chanceRolled(analysis)) continue;
    const amount = toward(loser, analysis.chanceDelta);
    if (amount < CHANCE_THRESHOLD || (best && amount <= best.amount)) continue;
    const carried = sureKillRoll(analysis, winner);
    best = { turn: analysis.turn, side: loser, amount, ...(carried ? { move: carried.label, accuracy: carried.accuracy } : {}) };
  }
  return best;
}

/** "The game's biggest roll came on turn 73: Fire Fang (95%) missed, worth +13% to SOULWIND." */
export function biggestRollSentence(roll: BiggestRoll, loserName: string): string {
  const worth = `worth ${winDeltaText(roll.amount)} to ${loserName}`;
  return roll.move !== undefined
    ? `The game's biggest roll came on turn ${roll.turn}: ${roll.move} (${percentBelowSure(roll.accuracy!)}%) missed, ${worth}.`
    : `The game's biggest roll came on turn ${roll.turn}, ${worth}.`;
}
