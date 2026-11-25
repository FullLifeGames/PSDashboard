import type { TurnAnalysis } from './analysis.ts';
import { rollText } from './prose/phrases.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { TIER_THRESHOLDS } from './turn-analysis/types.ts';

// Pure, main-bundle safe.

type Side = 'p1' | 'p2';

/** A failed roll that stood one event from ending the game much earlier. */
export interface DeniedEnd {
  turn: number;
  side: Side;
  species: string;
  removes: string;
  odds: number;
  /** The played move, named only when it provably carried the roll. */
  move?: string;
  turnsRemaining: number;
}

const DENIED_MIN_CHANCE = TIER_THRESHOLDS.inaccuracy;
const DENIED_MIN_REMAINDER = 8;

const toward = (side: Side, delta: number): number => (side === 'p1' ? delta : -delta);

/** A full kill behind a sub-certain accuracy; Doubles odds may be the partner slot's, so they name no move. */
export function sureKillRoll(analysis: TurnAnalysis, side: Side): { label: string; accuracy: number } | undefined {
  const ko = analysis[side].played?.koOdds;
  if (!ko || ko.label || ko.killFraction < 1 || ko.accuracy >= 1) return undefined;
  return { label: analysis[side].played!.label, accuracy: ko.accuracy };
}

// Names the move only when its odds are the near-decided roll, so "X missed" is never said of a roll X did not take.
function carriedMove(analysis: TurnAnalysis, side: Side, odds: number): string | undefined {
  const roll = sureKillRoll(analysis, side);
  return roll && Math.abs(roll.accuracy - odds) < 1e-6 ? roll.label : undefined;
}

// The stage reads the side's first active, whose action leads the played choice (the simulator skips an empty slot).
function clickPlayed(analysis: TurnAnalysis, side: Side, click: { move: string; target?: number } | undefined): boolean {
  const lead = analysis[side].played?.choice.split(', ')[0];
  if (!click || !lead) return false;
  const [kind, move, ...rest] = lead.split(' ');
  const target = rest.find(token => /^-?\d+$/.test(token));
  return kind === 'move' && move === click.move && (target === undefined || click.target === undefined || Number(target) === click.target);
}

/** Fails closed without dice info; with the turn's rolls known, the roll must have gone against the side. */
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
  const fail = denied.move !== undefined ? `${denied.move} missed` : denied.odds >= 1 ? 'the KO never came' : 'the roll failed';
  return denied.side === winner
    ? `Turn ${denied.turn} nearly ended it far earlier: ${roll}, but ${fail}, and ` +
      `the win waited another ${denied.turnsRemaining} turns.`
    : `Turn ${denied.turn} nearly ended it the other way: ${roll}, but ${fail}, and ` +
      `${loserName} went on to lose.`;
}
