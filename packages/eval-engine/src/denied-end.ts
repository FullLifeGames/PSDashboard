import type { TurnAnalysis } from './analysis.ts';
import { TIER_THRESHOLDS } from './turn-analysis/types.ts';

/**
 * The denied early end: a side stood one near-decided roll from finishing
 * the game (unanswered.ts), the protocol shows the turn was rolled, the
 * chance ledger ran against them, and the game ran on long after — the
 * report owes that moment a sentence even when the turn's NET swing reads
 * quiet (573756 t73: the 95% Fire Fang miss in front of a 4-vs-2 lead,
 * 66 turns before the win it delayed). Pure — no sim imports,
 * main-bundle safe.
 */

type Side = 'p1' | 'p2';

/** A failed roll that stood one event from ending the game much earlier. */
export interface DeniedEnd {
  turn: number;
  side: Side;
  species: string;
  /** The mon the roll would have removed (the sweep's one blocker). */
  removes: string;
  odds: number;
  /** The played move, named only when it provably carried the roll. */
  move?: string;
  /** Analyzed turns between the failed roll and the last analyzed turn. */
  turnsRemaining: number;
}

/** Chance against the near-decided side must reach an inaccuracy before the roll reads as visibly failed. */
const DENIED_MIN_CHANCE = TIER_THRESHOLDS.inaccuracy;
/** How many further analyzed turns make the missing end an "early" one. */
const DENIED_MIN_REMAINDER = 8;

const toward = (side: Side, delta: number): number => (side === 'p1' ? delta : -delta);

/**
 * The played move is named only when its analytic odds ARE the near-decided
 * roll — a full kill behind a sub-certain accuracy. Anything else (a
 * switch, a different move, a damage-roll gate) keeps the generic verb, so
 * "X missed" is never said about a roll X did not take.
 */
function carriedMove(analysis: TurnAnalysis, side: Side, odds: number): string | undefined {
  const ko = analysis[side].played?.koOdds;
  if (!ko || ko.killFraction < 1 || ko.accuracy >= 1) return undefined;
  return Math.abs(ko.accuracy - odds) < 1e-6 ? analysis[side].played!.label : undefined;
}

/**
 * The first turn where a one-roll sweep visibly failed and the game ran on:
 * nearDecided on the side, a protocol dice event on the turn, the turn's
 * chance against the side, and at least DENIED_MIN_REMAINDER analyzed
 * turns still to come. Fails closed without dice info.
 */
export function deniedEndFor(
  known: TurnAnalysis[],
  diceTurns: ReadonlySet<number> | null,
): DeniedEnd | null {
  if (diceTurns === null || known.length === 0) return null;
  const lastTurn = known[known.length - 1].turn;
  for (const analysis of known) {
    for (const side of ['p1', 'p2'] as const) {
      const near = analysis[side].nearDecided;
      if (!near || !diceTurns.has(analysis.turn)) continue;
      if (toward(side, analysis.chanceDelta ?? 0) > -DENIED_MIN_CHANCE) continue;
      const turnsRemaining = lastTurn - analysis.turn;
      if (turnsRemaining < DENIED_MIN_REMAINDER) continue;
      const move = carriedMove(analysis, side, near.odds);
      return {
        turn: analysis.turn, side, species: near.species, removes: near.removes,
        odds: near.odds, ...(move !== undefined ? { move } : {}), turnsRemaining,
      };
    }
  }
  return null;
}

/** The denied end spoken: for the eventual winner the delayed win, for the loser the turnaround. */
export function deniedEndSentence(denied: DeniedEnd, winner: Side, loserName: string): string {
  const roll = `${denied.species} stood one ${Math.round(denied.odds * 100)}% roll from clearing the rest`;
  const fail = denied.move !== undefined ? `${denied.move} missed` : 'the roll failed';
  return denied.side === winner
    ? `Turn ${denied.turn} nearly ended it far earlier: ${roll}, but ${fail} — ` +
      `the win waited another ${denied.turnsRemaining} turns.`
    : `Turn ${denied.turn} nearly ended it the other way: ${roll}, but ${fail} — ` +
      `${loserName} went on to lose.`;
}
