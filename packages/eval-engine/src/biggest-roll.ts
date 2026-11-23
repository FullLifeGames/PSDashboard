import type { TurnAnalysis } from './analysis.ts';
import { deniedEndFor, sureKillRoll } from './denied-end.ts';
import { percentBelowSure } from './prose/phrases.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { CHANCE_THRESHOLD } from './turn-analysis/types.ts';
import { winPercent } from './winprob.ts';

/**
 * The game's biggest roll against the eventual winner: the largest chance of a turn whose dice went toward the loser, at least
 * CHANCE_THRESHOLD, named only when the winner's played move provably carried it. Pure: no sim imports, main-bundle safe.
 */

type Side = 'p1' | 'p2';

/** What the copy (branch/rolled-copy.ts) hands back: the engine's score (p1 view) of the next root with the die turned over. */
export interface RollFlip {
  turn: number;
  score: number;
}

/** The game's biggest roll against the winner, with both chances of the side that rolled. */
export interface BiggestRoll {
  turn: number;
  /** The side the roll helped: the game's loser. */
  side: Side;
  /** The side that rolled: the game's winner, whose played move carried the roll. */
  winner: Side;
  /** The chance part of the turn, toward the loser (a score delta). */
  amount: number;
  /** The winner's played move, which provably carried the roll. */
  move: string;
  accuracy: number;
  /** Doubles: the odds' label names the click's target body, and the slot of the attacker that makes the odds (0 or 1). */
  target?: string;
  slot?: number;
  /** The actual next root: its score (p1 view) and fainted share, the map both chances print at. */
  after: { score: number; faintedFraction?: number | null };
  /** The copy's next root; absent until the copy ran, or where it found no such die. */
  hit?: RollFlip;
}

const toward = (side: Side, delta: number): number => (side === 'p1' ? delta : -delta);

/** The played move that provably carried the roll: the sure kill of singles, or a doubles click whose label names the move and its target. */
function carriedRoll(analysis: TurnAnalysis, winner: Side): Pick<BiggestRoll, 'move' | 'accuracy' | 'target' | 'slot'> | undefined {
  const plain = sureKillRoll(analysis, winner);
  if (plain) return { move: plain.label, accuracy: plain.accuracy };
  const ko = analysis[winner].played?.koOdds;
  if (!ko?.label || ko.killFraction < 1 || ko.accuracy >= 1) return undefined;
  const [move, target] = ko.label.split('→');
  if (!move || !target) return undefined;
  return { move, accuracy: ko.accuracy, target, ...(ko.attacker ? { slot: ko.attacker.slot } : {}) };
}

/** The biggest roll against the winner, without the copy. `deniedTurn` is the turn the denied-end sentence already speaks, which the roll leaves alone. */
function candidateRoll(known: TurnAnalysis[], winner: Side | null, deniedTurn: number | undefined): BiggestRoll | null {
  if (!winner) return null;
  const loser: Side = winner === 'p1' ? 'p2' : 'p1';
  let best: { analysis: TurnAnalysis; amount: number } | null = null;
  for (const analysis of known) {
    if (analysis.chanceDelta === null || !chanceRolled(analysis)) continue;
    const amount = toward(loser, analysis.chanceDelta);
    if (amount < CHANCE_THRESHOLD || (best && amount <= best.amount)) continue;
    best = { analysis, amount };
  }
  if (!best || best.analysis.turn === deniedTurn || best.analysis.scoreAfter === null) return null;
  const carried = carriedRoll(best.analysis, winner);
  if (!carried) return null;
  const { analysis, amount } = best;
  return {
    turn: analysis.turn, side: loser, winner, amount, ...carried,
    after: { score: analysis.scoreAfter!, faintedFraction: analysis.faintedFractionAfter },
  };
}

/** The roll the copy plays the other way: the same pick as the sentence's, before the copy ran. */
export function rollToCopy(known: TurnAnalysis[], winner: Side | null, diceTurns: ReadonlySet<number> | null): BiggestRoll | null {
  return candidateRoll(known, winner, deniedEndFor(known, diceTurns)?.turn);
}

/** The roll the sentence speaks. A doubles click waits for the copy: its odds label may belong to the partner slot, and only the copy finds the die in the log. */
export function biggestRollFor(known: TurnAnalysis[], winner: Side | null, hit: RollFlip | null = null, deniedTurn?: number): BiggestRoll | null {
  const roll = candidateRoll(known, winner, deniedTurn);
  if (!roll) return null;
  const copy = hit && hit.turn === roll.turn ? hit : undefined;
  if (roll.target !== undefined && !copy) return null;
  return copy ? { ...roll, hit: copy } : roll;
}

/** The percent of the side that rolled, for a p1-view score, at the fainted-share map of the actual next root. */
const percentFor = (winner: Side, score: number, faintedFraction: number | null | undefined): number =>
  winPercent(winner === 'p1' ? score : -score, faintedFraction);

/** The report's sentence for the roll: the miss, and where the winner stood after it, with the hit's percent when the copy ran. */
export function biggestRollSentence(roll: BiggestRoll, winnerName: string): string {
  const aim = roll.target ? ` ${roll.target}` : '';
  const head = `The game's biggest roll came on turn ${roll.turn}: ${roll.move} (${percentBelowSure(roll.accuracy)}%) missed${aim}.`;
  const { score, faintedFraction } = roll.after;
  const after = percentFor(roll.winner, score, faintedFraction);
  if (!roll.hit) return `${head} After the miss ${winnerName} stood at ${after}%.`;
  return `${head} A hit would have left ${winnerName} ${percentFor(roll.winner, roll.hit.score, faintedFraction)}% to win; after the miss ${winnerName} stood at ${after}%.`;
}
