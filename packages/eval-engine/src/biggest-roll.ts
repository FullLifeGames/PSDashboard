import type { TurnAnalysis } from './analysis.ts';
import { deniedEndFor, sureKillRoll } from './denied-end.ts';
import { percentBelowSure } from './prose/phrases.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { CHANCE_THRESHOLD } from './turn-analysis/types.ts';
import { winPercent } from './winprob.ts';

// Pure: no sim imports, main-bundle safe.

type Side = 'p1' | 'p2';

/** What the copy (branch/rolled-copy.ts) hands back: the next root's score (p1 view) with the die turned over. */
export interface RollFlip {
  turn: number;
  score: number;
}

export interface BiggestRoll {
  turn: number;
  /** The side the roll helped: the game's loser. */
  side: Side;
  /** The side that rolled: the game's winner. */
  winner: Side;
  /** The chance part of the turn, toward the loser (a score delta). */
  amount: number;
  move: string;
  accuracy: number;
  /** Doubles: the odds' label names the click's target body; `slot` is the attacker's (0 or 1). */
  target?: string;
  slot?: number;
  /** The actual next root: its score (p1 view) and fainted share. */
  after: { score: number; faintedFraction?: number | null };
  /** The copy's next root; absent until the copy ran, or where it found no such die. */
  hit?: RollFlip;
}

const toward = (side: Side, delta: number): number => (side === 'p1' ? delta : -delta);

function carriedRoll(analysis: TurnAnalysis, winner: Side): Pick<BiggestRoll, 'move' | 'accuracy' | 'target' | 'slot'> | undefined {
  const plain = sureKillRoll(analysis, winner);
  if (plain) return { move: plain.label, accuracy: plain.accuracy };
  const ko = analysis[winner].played?.koOdds;
  if (!ko?.label || ko.killFraction < 1 || ko.accuracy >= 1) return undefined;
  const [move, target] = ko.label.split('→');
  if (!move || !target) return undefined;
  return { move, accuracy: ko.accuracy, target, ...(ko.attacker ? { slot: ko.attacker.slot } : {}) };
}

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

/** The roll the sentence speaks; a doubles click waits for the copy, which finds the die in the log. */
export function biggestRollFor(known: TurnAnalysis[], winner: Side | null, hit: RollFlip | null = null, deniedTurn?: number): BiggestRoll | null {
  const roll = candidateRoll(known, winner, deniedTurn);
  if (!roll) return null;
  const copy = hit && hit.turn === roll.turn ? hit : undefined;
  if (roll.target !== undefined && !copy) return null;
  return copy ? { ...roll, hit: copy } : roll;
}

const percentFor = (winner: Side, score: number, faintedFraction: number | null | undefined): number =>
  winPercent(winner === 'p1' ? score : -score, faintedFraction);

export function biggestRollSentence(roll: BiggestRoll, winnerName: string): string {
  const aim = roll.target ? ` ${roll.target}` : '';
  const head = `The game's biggest roll came on turn ${roll.turn}: ${roll.move} (${percentBelowSure(roll.accuracy)}%) missed${aim}.`;
  const { score, faintedFraction } = roll.after;
  const after = percentFor(roll.winner, score, faintedFraction);
  if (!roll.hit) return `${head} After the miss ${winnerName} stood at ${after}%.`;
  return `${head} A hit would have left ${winnerName} ${percentFor(roll.winner, roll.hit.score, faintedFraction)}% to win; after the miss ${winnerName} stood at ${after}%.`;
}
