import type { TurnAnalysis } from './analysis.ts';
import { rollText } from './prose/phrases.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { TIER_THRESHOLDS } from './turn-analysis/types.ts';

/** The denied early end: a side stood one near-decided roll from finishing the game, the roll failed and the game ran on long after. Pure, main-bundle safe. */

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

/** A played move that provably carried a roll: a full kill behind a sub-certain accuracy. Doubles odds may be the partner slot's: no name from them. */
export function sureKillRoll(analysis: TurnAnalysis, side: Side): { label: string; accuracy: number } | undefined {
  const ko = analysis[side].played?.koOdds;
  if (!ko || ko.label || ko.killFraction < 1 || ko.accuracy >= 1) return undefined;
  return { label: analysis[side].played!.label, accuracy: ko.accuracy };
}

/** The played move is named only when its odds are the near-decided roll, so "X missed" is never said about a roll X did not take. */
function carriedMove(analysis: TurnAnalysis, side: Side, odds: number): string | undefined {
  const roll = sureKillRoll(analysis, side);
  return roll && Math.abs(roll.accuracy - odds) < 1e-6 ? roll.label : undefined;
}

/**
 * The played choice made the near stage's click. The stage reads the side's first active, whose action leads the played choice (the
 * simulator skips a fainted or empty slot); a spread move writes no target. Scene: Wave Crash stood at 94%, the user switched out, and
 * the turn's only rolls were Matcha Gotcha's burns, so "the roll failed" told of a roll nobody took.
 */
function clickPlayed(analysis: TurnAnalysis, side: Side, click: { move: string; target?: number } | undefined): boolean {
  const lead = analysis[side].played?.choice.split(', ')[0];
  if (!click || !lead) return false;
  const [kind, move, ...rest] = lead.split(' ');
  const target = rest.find(token => /^-?\d+$/.test(token));
  return kind === 'move' && move === click.move && (target === undefined || click.target === undefined || Number(target) === click.target);
}

/**
 * The first turn where a one-roll sweep visibly failed and the game ran on: nearDecided on the side, its click played, a protocol dice
 * event on the turn, the turn's chance against the side, and at least DENIED_MIN_REMAINDER analyzed turns still to come. Fails closed
 * without dice info. With the turn's rolls known, the roll must have gone against the side.
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
      if (!near || !clickPlayed(analysis, side, near.click) || !(chanceRolled(analysis) ?? diceTurns.has(analysis.turn))) continue;
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

export function deniedEndSentence(denied: DeniedEnd, winner: Side, loserName: string): string {
  const roll = `${denied.species} stood one ${rollText(denied.odds)} from clearing the rest`;
  // A sure KO has no roll that could fail; it never came.
  const fail = denied.move !== undefined ? `${denied.move} missed` : denied.odds >= 1 ? 'the KO never came' : 'the roll failed';
  return denied.side === winner
    ? `Turn ${denied.turn} nearly ended it far earlier: ${roll}, but ${fail}, and ` +
      `the win waited another ${denied.turnsRemaining} turns.`
    : `Turn ${denied.turn} nearly ended it the other way: ${roll}, but ${fail}, and ` +
      `${loserName} went on to lose.`;
}
