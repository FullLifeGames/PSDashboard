import type { TurnAnalysis } from './analysis.ts';
import { deniedEndFor, sureKillRoll } from './denied-end.ts';
import { percentBelowSure } from './prose/phrases.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { CHANCE_THRESHOLD } from './turn-analysis/types.ts';
import { winPercent } from './winprob.ts';

/**
 * Round 79 (T284): the game's biggest roll against the eventual winner. 573756 t73 was the largest roll of the game (a 95 %
 * Fire Fang missed, +0.269 for the side that lost) and the report spoke of another turn. The roll is the largest chance
 * of a turn whose dice went in the chance's own direction, toward the loser, and at least a mistake (CHANCE_THRESHOLD).
 * User gate 30.10.2026 ("2a"): the report names it only when the winner's played move provably carried it; a biggest roll
 * with no named event says nothing, and a smaller proven roll never stands in for it.
 * Round 86 (T304, spec gate 2a): the sentence names both chances of the side that rolled. The hit is the engine's score of the next
 * root of the copy that plays the turn with the die turned over (branch/rolled-copy.ts, played where the simulator is loaded); the
 * miss is the actual next root, which the turn's analysis already holds. A doubles click carries its move and target in the odds'
 * label, so the roll is named there too, but only once the copy found the die in the log: the odds may belong to the partner slot.
 * Pure — no sim imports, main-bundle safe.
 */

type Side = 'p1' | 'p2';

/** What the copy hands back: the engine's score (p1 view) of the next root with the die turned over. */
export interface RollFlip {
  turn: number;
  score: number;
}

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

/**
 * The biggest roll against the winner, without the copy: what the app plays the other way. `deniedTurn` is the turn the denied-end
 * sentence already speaks (report.ts), which the roll leaves alone.
 */
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

/** The roll the app plays the other way, for the game's report: the same pick as the sentence's, with no copy yet. */
export function rollToCopy(known: TurnAnalysis[], winner: Side | null, diceTurns: ReadonlySet<number> | null): BiggestRoll | null {
  return candidateRoll(known, winner, deniedEndFor(known, diceTurns)?.turn);
}

/**
 * The roll the sentence speaks. With the copy of its turn the sentence holds both chances. Singles speak without it (the miss and where
 * the winner stood after it); a doubles click waits for the copy, since the copy is what finds the die in the log.
 */
export function biggestRollFor(known: TurnAnalysis[], winner: Side | null, hit: RollFlip | null = null, deniedTurn?: number): BiggestRoll | null {
  const roll = candidateRoll(known, winner, deniedTurn);
  if (!roll) return null;
  const copy = hit && hit.turn === roll.turn ? hit : undefined;
  if (roll.target !== undefined && !copy) return null;
  return copy ? { ...roll, hit: copy } : roll;
}

/** The percent of the side that rolled, for a score in p1's view, at the map of the actual next root (both chances read on one scale). */
const percentFor = (winner: Side, score: number, faintedFraction: number | null | undefined): number =>
  winPercent(winner === 'p1' ? score : -score, faintedFraction);

/**
 * "The game's biggest roll came on turn 73: Fire Fang (95%) missed. A hit would have left LordEnz 81% to win; after the miss LordEnz
 * stood at 38%." The name is the side that rolled; a doubles click names the body it aimed at.
 */
export function biggestRollSentence(roll: BiggestRoll, winnerName: string): string {
  const aim = roll.target ? ` ${roll.target}` : '';
  const head = `The game's biggest roll came on turn ${roll.turn}: ${roll.move} (${percentBelowSure(roll.accuracy)}%) missed${aim}.`;
  const { score, faintedFraction } = roll.after;
  const after = percentFor(roll.winner, score, faintedFraction);
  if (!roll.hit) return `${head} After the miss ${winnerName} stood at ${after}%.`;
  return `${head} A hit would have left ${winnerName} ${percentFor(roll.winner, roll.hit.score, faintedFraction)}% to win; after the miss ${winnerName} stood at ${after}%.`;
}
