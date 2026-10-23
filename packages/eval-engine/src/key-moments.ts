import type { TurnAnalysis } from './analysis.ts';
import { KEY_TURN_SWING } from './graph.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { momentScore } from './win-reason.ts';

/** A key moment needs at least this much swing in one COMPONENT (net swing
 * or the chance share alone — a roll a decision partially cancelled still
 * swung the game, 573756 t73) — the same constant that selects the sweep's
 * deepening turns (graph.ts): whatever the report names ran at the
 * configured settings. */
export const KEY_MOMENT_SWING = KEY_TURN_SWING;
/** How many key moments the report keeps by rank. */
const REPORT_KEY_MOMENTS = 4;

type Winner = 'p1' | 'p2' | null;

/**
 * Selection by the biggest component (momentScore, win-reason.ts); resolution turns stay excluded.
 * Round 76 (T264): the top REPORT_KEY_MOMENTS stay, and every other qualifying dice turn whose
 * chance went against the winner joins them (573756 t73: a missed 95 % Fire Fang ranked eighth).
 * A dice turn is a turn whose own rolls ran in its residual's direction (chanceRolled) or, without
 * the turn's rolls, one that carries a protocol-visible dice event. Without a winner or dice info
 * no turn joins.
 */
export function keyMomentsFor(
  known: TurnAnalysis[],
  resolution: Set<number>,
  winner: Winner,
  diceTurns: ReadonlySet<number> | null,
): TurnAnalysis[] {
  const ranked = known
    .filter(analysis => analysis.attribution !== 'quiet' && analysis.swing !== null &&
      momentScore(analysis) >= KEY_MOMENT_SWING && !resolution.has(analysis.turn))
    .sort((a, b) => momentScore(b) - momentScore(a));
  const againstWinner = (analysis: TurnAnalysis): boolean => {
    if (winner === null || analysis.chanceDelta === null) return false;
    const wentAgainst = winner === 'p1' ? analysis.chanceDelta < 0 : analysis.chanceDelta > 0;
    return wentAgainst && (chanceRolled(analysis) ?? diceTurns?.has(analysis.turn) ?? false);
  };
  const kept = new Set([...ranked.slice(0, REPORT_KEY_MOMENTS), ...ranked.slice(REPORT_KEY_MOMENTS).filter(againstWinner)]);
  return [...kept].sort((a, b) => a.turn - b.turn);
}
