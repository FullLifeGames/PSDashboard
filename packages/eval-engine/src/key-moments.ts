import type { TurnAnalysis } from './analysis.ts';
import { KEY_TURN_SWING } from './graph.ts';
import { inStandoff, type Standoff } from './standoff.ts';
import { chanceRolled } from './turn-analysis/luck.ts';
import { momentScore } from './win-reason.ts';

/** The swing one component (net swing or chance share alone) needs for a key moment; also picks deepening turns. */
export const KEY_MOMENT_SWING = KEY_TURN_SWING;
const REPORT_KEY_MOMENTS = 4;

type Winner = 'p1' | 'p2' | null;

/** The report's key moments, by the biggest component (`momentScore`); resolution and standoff turns drop out. */
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
