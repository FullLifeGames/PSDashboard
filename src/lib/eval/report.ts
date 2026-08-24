import { playedSetupMove, type SideAnalysis, type TurnAnalysis, type VerdictTier } from './analysis';
import { KEY_TURN_SWING } from './graph';
import { koPhrase, labelPhrase } from './summary';
import { winDeltaText, winPercent } from './winprob';

/**
 * Multi-turn root-cause analysis over a completed graph sweep: where the
 * game tipped for good, which decisions seeded the loss, and how much of
 * the result was play vs luck. Pure — no sim imports, main-bundle safe.
 */

/** A key moment needs at least this much swing — the same constant that
 * selects the sweep's deepening turns (graph.ts): whatever the report
 * names ran at the configured settings. */
export const KEY_MOMENT_SWING = KEY_TURN_SWING;
/** How many key moments the report keeps. */
export const REPORT_KEY_MOMENTS = 4;
/** How many misplays the report lists per player. */
export const REPORT_MISPLAYS_PER_SIDE = 2;
/** How many paid-off reads the report lists per player. */
export const REPORT_READS_PER_SIDE = 2;

/** One risk whose read won value, ready for display. */
export interface GameRead {
  turn: number;
  side: 'p1' | 'p2';
  played: string;
  /** Own-perspective value won over the safe line's guarantee. */
  payoff: number;
}
/** Below this summed regret a player's game counts as clean. */
export const CLEAN_PLAY_TOTAL = 0.2;

/** One regretted decision, ready for display. */
export interface GameMisplay {
  turn: number;
  side: 'p1' | 'p2';
  regret: number;
  played: string;
  better: string;
  /** Verdict band (mistake or blunder — inaccuracies stay out of the list). */
  tier?: VerdictTier;
  /** The punishing reply never came — a read that came true, not a punished misplay. */
  riskUnpunished?: boolean;
  /** A nearly-dead Pokémon was deliberately fed — rendered neutrally as a sack. */
  sacrifice?: boolean;
}

export interface GameReport {
  winner: 'p1' | 'p2' | null;
  /** The turn whose play made the winner's advantage permanent (null = wire-to-wire or unknown). */
  turningPoint: number | null;
  /** The biggest non-quiet swings, in turn order. */
  keyMoments: TurnAnalysis[];
  /** Each side's biggest regrets, in turn order. */
  misplays: GameMisplay[];
  /** Each side's biggest paid-off reads, in turn order. */
  reads: GameRead[];
  /** False when played actions were unavailable — an empty misplay list then means "unknown", not "clean". */
  tracked: boolean;
  /**
   * Lichess-style game accuracy per player (0–100): win-probability loss per
   * graded turn through the accuracy curve, aggregated as the mean of the
   * harmonic and volatility-weighted means. Null under 5 graded turns.
   */
  accuracy?: { p1: number | null; p2: number | null };
  /** Summed regret per player across the analyzed game. */
  decisionTotals: { p1: number; p2: number };
  /** Net chance contribution across the game (p1 perspective). */
  chanceTotal: number;
  /**
   * Chance booked past the favor boundary toward the winner — the decided
   * game RESOLVING (the static bar's horizon gap on a locked endgame), not
   * luck. Kept out of `chanceTotal` and the key moments (573756 t138).
   */
  resolutionTotal: number;
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

/** Minimum graded turns before an accuracy number is honest. */
const ACCURACY_MIN_TURNS = 5;

/**
 * Per-player game accuracy: each graded turn's win-probability loss runs
 * through Lichess's accuracy curve; the game aggregates as the mean of the
 * harmonic mean (single blunders drag hard — right for short games) and the
 * volatility-weighted mean (sharp phases count more).
 */
function accuracyFor(
  known: TurnAnalysis[],
  side: 'p1' | 'p2',
  series: (number | undefined)[],
): number | null {
  const graded = known.filter(analysis => {
    const sideAnalysis = analysis[side];
    return sideAnalysis.played && sideAnalysis.best && (sideAnalysis.choiceCount ?? 2) > 1;
  });
  if (graded.length < ACCURACY_MIN_TURNS) return null;

  const entries = graded.map(analysis => {
    const sideAnalysis = analysis[side];
    // Scores and EVs are wp-units: winPercent owns the calibrated
    // score→probability conversion, so accuracy loss is priced in the same
    // honest probability space the user sees.
    const toWin = (value: number) => winPercent(value) / 100;
    const deltaWin = Math.max(0, toWin(sideAnalysis.best!.ev) - toWin(sideAnalysis.played!.ev));
    const accuracy = Math.max(0, Math.min(100,
      103.1668 * Math.exp(-0.04354 * (100 * deltaWin)) - 3.1669));
    const window = [series[analysis.turn - 1], series[analysis.turn], series[analysis.turn + 1]]
      .filter((value): value is number => value !== undefined)
      .map(toWin);
    const mean = window.reduce((sum, value) => sum + value, 0) / Math.max(window.length, 1);
    const volatility = window.length > 1
      ? Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length)
      : 0;
    return { accuracy, weight: Math.max(0.05, volatility) };
  });

  const harmonic = entries.length /
    entries.reduce((sum, entry) => sum + 1 / Math.max(entry.accuracy, 1), 0);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const weighted = entries.reduce((sum, entry) => sum + entry.accuracy * entry.weight, 0) / totalWeight;
  return (harmonic + weighted) / 2;
}

/**
 * Earliest turn from which every known score favors the winner — the game's
 * decided region. Feeds both the turning point and resolution detection.
 */
function favorBoundary(series: (number | undefined)[], winner: 'p1' | 'p2'): number | null {
  const favors = (score: number) => (winner === 'p1' ? score > 0 : score < 0);
  let earliest: number | null = null;
  for (let turn = series.length - 1; turn >= 1; turn--) {
    const score = series[turn];
    if (score === undefined) continue;
    if (!favors(score)) break;
    earliest = turn;
  }
  return earliest;
}

export function buildGameReport(
  analyses: (TurnAnalysis | null)[],
  playerNames: [string, string],
  winner: 'p1' | 'p2' | null,
  /** False = played actions unavailable (doubles): no seeds, no clean-play claim. */
  playedTracking = true,
): GameReport {
  const known = analyses.filter((entry): entry is TurnAnalysis => entry !== null);

  const series = scoreSeries(analyses);
  const boundary = winner ? favorBoundary(series, winner) : null;
  // Chance booked inside the decided region TOWARD the winner is the game
  // resolving: past the favor boundary the static bar underprices a locked
  // endgame, so its terminal convergence "surprises" the model by the
  // horizon gap (573756 t138: chanceDelta −1.02 on the final KO of a game
  // decided at t71). Those turns leave the key moments and the luck ledger;
  // chance AGAINST the winner stays genuine luck wherever it lands.
  const towardWinner = (delta: number) => (winner === 'p1' ? delta > 0 : delta < 0);
  const resolution = new Set(boundary === null ? [] : known
    .filter(analysis => analysis.turn >= boundary && analysis.attribution === 'chance' &&
      analysis.chanceDelta !== null && towardWinner(analysis.chanceDelta))
    .map(analysis => analysis.turn));

  const keyMoments = known
    .filter(analysis => analysis.attribution !== 'quiet' && analysis.swing !== null && Math.abs(analysis.swing) >= KEY_MOMENT_SWING &&
      !resolution.has(analysis.turn))
    .sort((a, b) => Math.abs(b.swing!) - Math.abs(a.swing!))
    .slice(0, REPORT_KEY_MOMENTS)
    .sort((a, b) => a.turn - b.turn);

  // Selected PER SIDE — a global top list lets one player's numbers (often
  // a winner's unpunished risks) crowd the other's out entirely.
  const badTier = (side: SideAnalysis) => side.tier === 'mistake' || side.tier === 'blunder';
  const misplaysFor = (side: 'p1' | 'p2'): GameMisplay[] => known
    .filter(analysis => badTier(analysis[side]) &&
      analysis[side].played && analysis[side].best && !analysis[side].riskPaidOff)
    .map(analysis => ({
      turn: analysis.turn,
      side,
      regret: analysis[side].regret ?? 0,
      played: analysis[side].played!.label,
      // A mechanically null best displays as its co-optimal alternative —
      // same swap the turn summary makes (grading untouched).
      better: analysis[side].bestNull?.alternative?.label ?? analysis[side].best!.label,
      ...(analysis[side].tier ? { tier: analysis[side].tier } : {}),
      ...(analysis[side].riskUnpunished ? { riskUnpunished: true } : {}),
      ...(analysis[side].sacrifice ? { sacrifice: true } : {}),
    }))
    .sort((a, b) => b.regret - a.regret)
    .slice(0, REPORT_MISPLAYS_PER_SIDE);
  const misplays = !playedTracking ? [] : [...misplaysFor('p1'), ...misplaysFor('p2')]
    .sort((a, b) => a.turn - b.turn || a.side.localeCompare(b.side));

  const readsFor = (side: 'p1' | 'p2'): GameRead[] => known
    .filter(analysis => analysis[side].riskPaidOff && analysis[side].played)
    .map(analysis => ({
      turn: analysis.turn,
      side,
      played: analysis[side].played!.label,
      payoff: analysis[side].riskPayoff ?? 0,
    }))
    .sort((a, b) => b.payoff - a.payoff)
    .slice(0, REPORT_READS_PER_SIDE);
  const reads = !playedTracking ? [] : [...readsFor('p1'), ...readsFor('p2')]
    .sort((a, b) => a.turn - b.turn || a.side.localeCompare(b.side));

  // Paid-off reads are not decision errors — they stay out of the totals.
  const regretOf = (side: SideAnalysis) => (side.riskPaidOff ? 0 : side.regret ?? 0);
  const decisionTotals = {
    p1: known.reduce((sum, analysis) => sum + regretOf(analysis.p1), 0),
    p2: known.reduce((sum, analysis) => sum + regretOf(analysis.p2), 0),
  };
  const chanceTotal = known.reduce((sum, analysis) =>
    sum + (resolution.has(analysis.turn) ? 0 : analysis.chanceDelta ?? 0), 0);
  const resolutionTotal = known.reduce((sum, analysis) =>
    sum + (resolution.has(analysis.turn) ? analysis.chanceDelta ?? 0 : 0), 0);

  const accuracy = playedTracking
    ? { p1: accuracyFor(known, 'p1', series), p2: accuracyFor(known, 'p2', series) }
    : { p1: null, p2: null };

  // The play that produced the boundary score happened on the turn before.
  const turningPoint = boundary !== null && boundary > 1 ? boundary - 1 : null;

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
        badTier(analysis[loser]) && analysis[loser].played && analysis[loser].best &&
        // An unpunished risk cost nothing — it cannot have seeded the loss;
        // a deliberate low-cost sack likewise.
        !analysis[loser].riskUnpunished && !analysis[loser].sacrifice)
      .sort((a, b) => (b[loser].regret ?? 0) - (a[loser].regret ?? 0))
      .slice(0, 2)
      .sort((a, b) => a.turn - b.turn);
    if (seeds.length > 0) {
      const parts = seeds.map(analysis => {
        const side = analysis[loser];
        const setup = playedSetupMove(side) ? '; a setup move the engine may undervalue' : '';
        const better = side.bestNull?.alternative?.label ?? side.best!.label;
        // Round 6: the played move's analytic odds ground the claim.
        const oddsBit = side.played!.koOdds ? ` (${koPhrase(side.played!.koOdds)})` : '';
        return `turn ${analysis.turn} (${labelPhrase(side.played!.label)}${oddsBit}, ` +
          `${winDeltaText(-(side.regret ?? 0))} — safer was ${labelPhrase(better)}${setup})`;
      });
      sentences.push(`The seeds of the loss: ${parts.join(' and ')}.`);
    } else if (playedTracking && decisionTotals[loser] < CLEAN_PLAY_TOTAL) {
      sentences.push(`${loserName}'s play was clean — the loss came from matchup and variance, not blunders.`);
    }
  } else if (known.length > 0) {
    sentences.push('No winner recorded — the game may be unfinished.');
  }

  if (Math.abs(chanceTotal) >= 0.25) {
    sentences.push(`Luck ran ${chanceTotal > 0 ? 'for' : 'against'} ${playerNames[0]} overall (${winDeltaText(chanceTotal)}).`);
  }

  return {
    winner, turningPoint, keyMoments, misplays, reads, tracked: playedTracking,
    accuracy, decisionTotals, chanceTotal, resolutionTotal, summary: sentences.join(' '),
  };
}
