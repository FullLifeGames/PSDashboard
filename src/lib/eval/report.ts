import { REGRET_THRESHOLD, type TurnAnalysis } from './analysis';
import { labelPhrase, signedValue } from './summary';

/**
 * Multi-turn root-cause analysis over a completed graph sweep: where the
 * game tipped for good, which decisions seeded the loss, and how much of
 * the result was play vs luck. Pure — no sim imports, main-bundle safe.
 */

/** A key moment needs at least this much swing (matches the blunder rings). */
export const KEY_MOMENT_SWING = 0.25;
/** How many key moments the report keeps. */
export const REPORT_KEY_MOMENTS = 4;
/** Below this summed regret a player's game counts as clean. */
export const CLEAN_PLAY_TOTAL = 0.2;

export interface GameReport {
  winner: 'p1' | 'p2' | null;
  /** The turn whose play made the winner's advantage permanent (null = wire-to-wire or unknown). */
  turningPoint: number | null;
  /** The biggest non-quiet swings, in turn order. */
  keyMoments: TurnAnalysis[];
  /** Summed regret per player across the analyzed game. */
  decisionTotals: { p1: number; p2: number };
  /** Net chance contribution across the game (p1 perspective). */
  chanceTotal: number;
  summary: string;
}

/**
 * Score series by turn: s[t] = score at the start of turn t, plus one final
 * entry after the last analyzed turn. Unknown turns stay undefined.
 */
function scoreSeries(analyses: (TurnAnalysis | null)[]): (number | undefined)[] {
  const series: (number | undefined)[] = new Array(analyses.length + 2).fill(undefined);
  for (const analysis of analyses) {
    if (!analysis) continue;
    series[analysis.turn] = analysis.scoreBefore;
    if (analysis.scoreAfter !== null) series[analysis.turn + 1] = analysis.scoreAfter;
  }
  return series;
}

function findTurningPoint(analyses: (TurnAnalysis | null)[], winner: 'p1' | 'p2'): number | null {
  const series = scoreSeries(analyses);
  const favors = (score: number) => (winner === 'p1' ? score > 0 : score < 0);
  // Earliest turn from which every known score favors the winner.
  let earliest: number | null = null;
  for (let turn = series.length - 1; turn >= 1; turn--) {
    const score = series[turn];
    if (score === undefined) continue;
    if (!favors(score)) break;
    earliest = turn;
  }
  if (earliest === null) return null;
  // The play that produced that score happened on the turn before.
  return earliest > 1 ? earliest - 1 : null;
}

export function buildGameReport(
  analyses: (TurnAnalysis | null)[],
  playerNames: [string, string],
  winner: 'p1' | 'p2' | null,
  /** False = played actions unavailable (doubles): no seeds, no clean-play claim. */
  playedTracking = true,
): GameReport {
  const known = analyses.filter((entry): entry is TurnAnalysis => entry !== null);

  const keyMoments = known
    .filter(analysis => analysis.attribution !== 'quiet' && analysis.swing !== null && Math.abs(analysis.swing) >= KEY_MOMENT_SWING)
    .sort((a, b) => Math.abs(b.swing!) - Math.abs(a.swing!))
    .slice(0, REPORT_KEY_MOMENTS)
    .sort((a, b) => a.turn - b.turn);

  const decisionTotals = {
    p1: known.reduce((sum, analysis) => sum + (analysis.p1.regret ?? 0), 0),
    p2: known.reduce((sum, analysis) => sum + (analysis.p2.regret ?? 0), 0),
  };
  const chanceTotal = known.reduce((sum, analysis) => sum + (analysis.chanceDelta ?? 0), 0);

  const turningPoint = winner ? findTurningPoint(analyses, winner) : null;

  const sentences: string[] = [];
  if (winner) {
    sentences.push(`${playerNames[winner === 'p1' ? 0 : 1]} won.`);
    sentences.push(turningPoint !== null
      ? `The game tipped for good on turn ${turningPoint}.`
      : `${playerNames[winner === 'p1' ? 0 : 1]} led from start to finish.`);

    const loser = winner === 'p1' ? 'p2' : 'p1';
    const loserName = playerNames[loser === 'p1' ? 0 : 1];
    const seeds = !playedTracking ? [] : known
      .filter(analysis => (turningPoint === null || analysis.turn <= turningPoint) &&
        (analysis[loser].regret ?? 0) >= REGRET_THRESHOLD && analysis[loser].played && analysis[loser].best)
      .sort((a, b) => (b[loser].regret ?? 0) - (a[loser].regret ?? 0))
      .slice(0, 2)
      .sort((a, b) => a.turn - b.turn);
    if (seeds.length > 0) {
      const parts = seeds.map(analysis => {
        const side = analysis[loser];
        return `turn ${analysis.turn} (${labelPhrase(side.played!.label)}, ` +
          `−${(side.regret ?? 0).toFixed(2)} — safer was ${labelPhrase(side.best!.label)})`;
      });
      sentences.push(`The seeds of the loss: ${parts.join(' and ')}.`);
    } else if (playedTracking && decisionTotals[loser] < CLEAN_PLAY_TOTAL) {
      sentences.push(`${loserName}'s play was clean — the loss came from matchup and variance, not blunders.`);
    }
  } else if (known.length > 0) {
    sentences.push('No winner recorded — the game may be unfinished.');
  }

  if (Math.abs(chanceTotal) >= 0.25) {
    sentences.push(`Luck ran ${chanceTotal > 0 ? 'for' : 'against'} ${playerNames[0]} overall (${signedValue(chanceTotal)}).`);
  }

  return { winner, turningPoint, keyMoments, decisionTotals, chanceTotal, summary: sentences.join(' ') };
}
