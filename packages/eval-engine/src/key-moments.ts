import type { TurnAnalysis } from './analysis.ts';
import { KEY_TURN_SWING } from './graph.ts';
import { inStandoff, type Standoff } from './standoff.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { momentScore } from './win-reason.ts';

/** The swing one component (net swing or chance share alone) needs for a key moment; the same constant selects the sweep's deepening turns (graph.ts). */
export const KEY_MOMENT_SWING = KEY_TURN_SWING;
/** How many key moments the report keeps by rank. */
const REPORT_KEY_MOMENTS = 4;

type Winner = 'p1' | 'p2' | null;

/**
 * Selection by the biggest component (momentScore, win-reason.ts); resolution turns stay excluded. The top REPORT_KEY_MOMENTS stay,
 * and every other qualifying dice turn whose chance went against the winner joins them (a missed 95 % Fire Fang ranked eighth). A
 * dice turn is a turn whose own rolls ran in its residual's direction (chanceRolled) or, without the turn's rolls, one that carries
 * a protocol-visible dice event. Without a winner or dice info no turn joins. The selection runs over the whole game, then a turn
 * inside a standoff drops out unless it is a graded decision (a decision attribution): its shift, roll or read is the HP and PP
 * cycle of one position. The slot of a dropped turn stays empty.
 */
export function keyMomentsFor(
  known: TurnAnalysis[],
  resolution: Set<number>,
  winner: Winner,
  diceTurns: ReadonlySet<number> | null,
  standoffs: readonly Standoff[] = [],
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
  const speaks = (analysis: TurnAnalysis): boolean =>
    !inStandoff(standoffs, analysis.turn) || analysis.attribution.endsWith('-decision');
  return [...kept].filter(speaks).sort((a, b) => a.turn - b.turn);
}
