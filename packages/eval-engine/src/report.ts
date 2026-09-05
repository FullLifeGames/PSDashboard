import type { SideAnalysis, TurnAnalysis, VerdictTier } from './analysis.ts';
import { type DeniedEnd, deniedEndFor, deniedEndSentence } from './denied-end.ts';
import { KEY_TURN_SWING } from './graph.ts';
import {
  LUCK_TOTAL_THRESHOLD, badTier, closeGameFallback, conversionFor, luckSentence, matchupClause, momentScore,
  seedPhrase, seedsOfTheLoss, tipClause, winPathFor, type WinConversion, type WinPath, type WinPathResult,
} from './win-reason.ts';
import { winPercent } from './winprob.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * Multi-turn root-cause analysis over a completed graph sweep: where the
 * game tipped for good, which decisions seeded the loss, and how much of
 * the result was play vs luck. Pure — no sim imports, main-bundle safe.
 */

/** A key moment needs at least this much swing in one COMPONENT (net swing
 * or the chance share alone — a roll a decision partially cancelled still
 * swung the game, 573756 t73) — the same constant that selects the sweep's
 * deepening turns (graph.ts): whatever the report names ran at the
 * configured settings. */
export const KEY_MOMENT_SWING = KEY_TURN_SWING;
/** How many key moments the report keeps. */
const REPORT_KEY_MOMENTS = 4;
/** How many misplays the report lists per player. */
const REPORT_MISPLAYS_PER_SIDE = 2;
/** How many paid-off reads the report lists per player. */
const REPORT_READS_PER_SIDE = 2;

/** One risk whose read won value, ready for display. */
interface GameRead {
  turn: number;
  side: 'p1' | 'p2';
  played: string;
  /** Own-perspective value won over the safe line's guarantee. */
  payoff: number;
}
/** Below this summed regret a player's game counts as clean. */
const CLEAN_PLAY_TOTAL = 0.2;

/** One regretted decision, ready for display. */
interface GameMisplay {
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
  /** Chance summed over the protocol's dice-event turns (p1 perspective, resolution excluded) — the luck claims' anchor. Absent without dice info. */
  diceAnchorTotal?: number;
  /** How the winner sealed it: the first proven forced win or decided sweep. Absent without a signal. */
  conversion?: WinConversion;
  /** A one-roll sweep that visibly failed while the game ran on — the denied early end (denied-end.ts). */
  deniedEnd?: DeniedEnd;
  /** The dominant edge the summary credits the win to ('close' = the fallback sentence). Absent when the seeds tell the story or no winner is known. */
  winPath?: WinPath;
  summary: string;
}

type Winner = 'p1' | 'p2' | null;
type Side = 'p1' | 'p2';

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

/**
 * Chance booked inside the decided region TOWARD the winner is the game
 * resolving: past the favor boundary the static bar underprices a locked
 * endgame, so its terminal convergence "surprises" the model by the
 * horizon gap (573756 t138: chanceDelta −1.02 on the final KO of a game
 * decided at t71). Those turns leave the key moments and the luck ledger;
 * chance AGAINST the winner stays genuine luck wherever it lands.
 */
function resolutionTurns(known: TurnAnalysis[], boundary: number | null, winner: Winner): Set<number> {
  const towardWinner = (delta: number) => (winner === 'p1' ? delta > 0 : delta < 0);
  return new Set(boundary === null ? [] : known
    .filter(analysis => analysis.turn >= boundary && analysis.attribution === 'chance' &&
      analysis.chanceDelta !== null && towardWinner(analysis.chanceDelta))
    .map(analysis => analysis.turn));
}

/** Selection by the biggest component (momentScore, win-reason.ts); resolution turns stay excluded. */
function keyMomentsFor(known: TurnAnalysis[], resolution: Set<number>): TurnAnalysis[] {
  return known
    .filter(analysis => analysis.attribution !== 'quiet' && analysis.swing !== null &&
      momentScore(analysis) >= KEY_MOMENT_SWING && !resolution.has(analysis.turn))
    .sort((a, b) => momentScore(b) - momentScore(a))
    .slice(0, REPORT_KEY_MOMENTS)
    .sort((a, b) => a.turn - b.turn);
}

/**
 * Selected PER SIDE — a global top list lets one player's numbers (often
 * a winner's unpunished risks) crowd the other's out entirely.
 */
function misplaysFor(known: TurnAnalysis[], side: Side): GameMisplay[] {
  return known
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
}

function readsFor(known: TurnAnalysis[], side: Side): GameRead[] {
  return known
    .filter(analysis => analysis[side].riskPaidOff && analysis[side].played)
    .map(analysis => ({
      turn: analysis.turn,
      side,
      played: analysis[side].played!.label,
      payoff: analysis[side].riskPayoff ?? 0,
    }))
    .sort((a, b) => b.payoff - a.payoff)
    .slice(0, REPORT_READS_PER_SIDE);
}

/** Paid-off reads are not decision errors — they stay out of the totals. */
const regretOf = (side: SideAnalysis) => (side.riskPaidOff ? 0 : side.regret ?? 0);

/** Summed regret per player, the net chance outside the resolution turns, and the resolution itself. */
function gameTotals(
  known: TurnAnalysis[],
  resolution: Set<number>,
): { decisionTotals: { p1: number; p2: number }; chanceTotal: number; resolutionTotal: number } {
  const decisionTotals = {
    p1: known.reduce((sum, analysis) => sum + regretOf(analysis.p1), 0),
    p2: known.reduce((sum, analysis) => sum + regretOf(analysis.p2), 0),
  };
  const chanceTotal = known.reduce((sum, analysis) =>
    sum + (resolution.has(analysis.turn) ? 0 : analysis.chanceDelta ?? 0), 0);
  const resolutionTotal = known.reduce((sum, analysis) =>
    sum + (resolution.has(analysis.turn) ? analysis.chanceDelta ?? 0 : 0), 0);
  return { decisionTotals, chanceTotal, resolutionTotal };
}

/** The winner-side pieces of the story (win-reason.ts), resolved once for the summary and the report fields. */
interface WinStory {
  seeds: TurnAnalysis[];
  conversion: ReturnType<typeof conversionFor>;
  denied: DeniedEnd | null;
  /** The tip turn's mechanism clause ('' when it has none the report may name). */
  tip: string;
  path: WinPathResult | null;
}

function winStoryFor(args: {
  known: TurnAnalysis[];
  series: (number | undefined)[];
  boundary: number | null;
  playerNames: [string, string];
  winner: Side;
  turningPoint: number | null;
  playedTracking: boolean;
  chanceTotal: number;
  diceAnchor: number | null;
  diceTurns: ReadonlySet<number> | null;
}): WinStory {
  const { known, winner, turningPoint, playedTracking } = args;
  const loser = winner === 'p1' ? 'p2' : 'p1';
  const seeds = !playedTracking ? [] : seedsOfTheLoss(known, loser, turningPoint);
  const conversion = conversionFor(known, winner, args.playerNames);
  const denied = deniedEndFor(known, args.diceTurns);
  const tip = tipClause(known, winner, args.playerNames[sideIndex(winner)], turningPoint, args.diceTurns);
  const path = winPathFor({
    known, series: args.series, boundary: args.boundary, winner, playerNames: args.playerNames,
    chanceTotal: args.chanceTotal, diceAnchor: args.diceAnchor, playedTracking, seedsSpoken: seeds.length > 0,
  });
  // Nothing else explained a tipped game: say so instead of saying nothing.
  if (!path && !conversion && seeds.length === 0 && turningPoint !== null) {
    return { seeds, conversion, denied, tip, path: closeGameFallback(args.playerNames[sideIndex(winner)]) };
  }
  return { seeds, conversion, denied, tip, path };
}

/** The winner's story: who won, when and how it tipped, the conversion, the seeds (or clean play), and the winning edge. */
function winnerSentences(
  playerNames: [string, string],
  winner: Side,
  turningPoint: number | null,
  playedTracking: boolean,
  decisionTotals: { p1: number; p2: number },
  story: WinStory,
  series: (number | undefined)[],
): string[] {
  const winnerName = playerNames[sideIndex(winner)];
  const sentences: string[] = [];
  sentences.push(`${winnerName} won.`);
  sentences.push(turningPoint !== null
    ? `The game tipped for good on turn ${turningPoint}${story.tip}.`
    : `${winnerName} led from start to finish${matchupClause(series, winner)}.`);
  if (story.conversion) sentences.push(story.conversion.sentence);

  const loser = winner === 'p1' ? 'p2' : 'p1';
  const loserName = playerNames[sideIndex(loser)];
  if (story.denied) sentences.push(deniedEndSentence(story.denied, winner, loserName));
  if (story.seeds.length > 0) {
    const parts = story.seeds.map(analysis => seedPhrase(analysis, loser));
    sentences.push(`The seeds of the loss: ${parts.join(' and ')}.`);
  } else if (playedTracking && decisionTotals[loser] < CLEAN_PLAY_TOTAL) {
    // With a win-path sentence following, the explaining is its job — the
    // clean line keeps the praise and drops its matchup-and-variance tail.
    sentences.push(story.path
      ? `${loserName}'s play was clean.`
      : `${loserName}'s play was clean — the loss came from matchup and variance, not blunders.`);
  }
  if (story.path) sentences.push(story.path.sentence);
  return sentences;
}

/** The report's prose: the winner's story (or the unfinished note), then the luck line. */
function reportSummary(
  known: TurnAnalysis[],
  playerNames: [string, string],
  winner: Winner,
  turningPoint: number | null,
  playedTracking: boolean,
  decisionTotals: { p1: number; p2: number },
  chanceTotal: number,
  diceAnchor: number | null,
  story: WinStory | null,
  series: (number | undefined)[],
): string {
  const sentences: string[] = [];
  if (winner && story) {
    sentences.push(...winnerSentences(playerNames, winner, turningPoint, playedTracking, decisionTotals, story, series));
  } else if (known.length > 0) {
    sentences.push('No winner recorded — the game may be unfinished.');
  }

  if (!story?.path?.foldLuck && Math.abs(chanceTotal) >= LUCK_TOTAL_THRESHOLD) {
    sentences.push(luckSentence(chanceTotal, diceAnchor, playerNames));
  }
  return sentences.join(' ');
}

/** The luck claims' anchor: the chance ledger summed over the dice-event turns only (resolution excluded). */
function diceAnchorFor(
  known: TurnAnalysis[],
  diceTurns: ReadonlySet<number> | null,
  resolution: Set<number>,
): number | null {
  if (diceTurns === null) return null;
  return known.reduce((sum, analysis) =>
    sum + (diceTurns.has(analysis.turn) && !resolution.has(analysis.turn) ? analysis.chanceDelta ?? 0 : 0), 0);
}

/** The report's optional story-and-anchor fields, absent when unset. */
function optionalFields(story: WinStory | null, diceAnchor: number | null): Partial<GameReport> {
  return {
    ...(diceAnchor !== null ? { diceAnchorTotal: diceAnchor } : {}),
    ...(story?.conversion ? { conversion: story.conversion.conversion } : {}),
    ...(story?.denied ? { deniedEnd: story.denied } : {}),
    ...(story?.path ? { winPath: story.path.winPath } : {}),
  };
}

export function buildGameReport(
  analyses: (TurnAnalysis | null)[],
  playerNames: [string, string],
  winner: 'p1' | 'p2' | null,
  /** False = played actions unavailable (doubles): no seeds, no clean-play claim. */
  playedTracking = true,
  /** Turns with a protocol-visible dice event (dice-events.ts); null = no dice info, luck claims stay ungated. */
  diceTurns: ReadonlySet<number> | null = null,
): GameReport {
  const known = analyses.filter((entry): entry is TurnAnalysis => entry !== null);

  const series = scoreSeries(analyses);
  const boundary = winner ? favorBoundary(series, winner) : null;
  const resolution = resolutionTurns(known, boundary, winner);
  const keyMoments = keyMomentsFor(known, resolution);
  const misplays = !playedTracking ? [] : [...misplaysFor(known, 'p1'), ...misplaysFor(known, 'p2')]
    .sort((a, b) => a.turn - b.turn || a.side.localeCompare(b.side));
  const reads = !playedTracking ? [] : [...readsFor(known, 'p1'), ...readsFor(known, 'p2')]
    .sort((a, b) => a.turn - b.turn || a.side.localeCompare(b.side));
  const { decisionTotals, chanceTotal, resolutionTotal } = gameTotals(known, resolution);

  const accuracy = playedTracking
    ? { p1: accuracyFor(known, 'p1', series), p2: accuracyFor(known, 'p2', series) }
    : { p1: null, p2: null };

  const diceAnchor = diceAnchorFor(known, diceTurns, resolution);

  // The play that produced the boundary score happened on the turn before.
  const turningPoint = boundary !== null && boundary > 1 ? boundary - 1 : null;
  const story = winner === null ? null : winStoryFor({
    known, series, boundary, playerNames, winner, turningPoint, playedTracking, chanceTotal, diceAnchor, diceTurns,
  });
  const summary = reportSummary(known, playerNames, winner, turningPoint, playedTracking, decisionTotals, chanceTotal, diceAnchor, story, series);

  return {
    winner, turningPoint, keyMoments, misplays, reads, tracked: playedTracking,
    accuracy, decisionTotals, chanceTotal, resolutionTotal, summary,
    ...optionalFields(story, diceAnchor),
  };
}
