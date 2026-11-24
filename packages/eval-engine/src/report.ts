import type { SideAnalysis, TurnAnalysis, VerdictTier } from './analysis.ts';
import { type BiggestRoll, biggestRollFor, biggestRollSentence, type RollFlip } from './biggest-roll.ts';
import { type DeniedEnd, deniedEndFor, deniedEndSentence } from './denied-end.ts';
import { KEY_MOMENT_SWING, keyMomentsFor } from './key-moments.ts';
import { misplayExtrasFor } from './prose/phrases.ts';
import { inStandoff, type Standoff, standoffSentence, standoffsOf } from './standoff.ts';
import { diceAnchorFor, luckSplit, type LuckSplit } from './turn-analysis/luck.ts';
import { lostGround } from './turn-analysis/risk.ts';
import {
  LUCK_TOTAL_THRESHOLD, badTier, closeGameFallback, conversionFor, luckSentence, matchupClause,
  seedPhrase, seedsOfTheLoss, tipClause, winPathFor, type WinConversion, type WinPath, type WinPathResult,
} from './win-reason.ts';
import { winPercent } from './winprob.ts';
import { sideIndex } from '@fulllifegames/replay-core';

export { KEY_MOMENT_SWING };
const REPORT_MISPLAYS_PER_SIDE = 2;
const REPORT_READS_PER_SIDE = 2;

interface GameRead {
  turn: number;
  side: 'p1' | 'p2';
  played: string;
  /** Own-perspective value won over the safe line's guarantee. */
  payoff: number;
}
const CLEAN_PLAY_TOTAL = 0.2;

interface GameMisplay {
  turn: number;
  side: 'p1' | 'p2';
  regret: number;
  played: string;
  better: string;
  /** Verdict band: mistake or blunder; inaccuracies stay out of the list. */
  tier?: VerdictTier;
  riskUnpunished?: boolean;
  sacrifice?: boolean;
  /** The body fell before it moved; `played` is the engine's stand-in label, so the display gives its chance. */
  neverActed?: { ev: number; faintedFraction?: number };
  /** A regret over 1 spans these two values (shown best, played). */
  span?: { from: number; to: number; faintedFraction?: number };
}

export interface GameReport {
  winner: 'p1' | 'p2' | null;
  /** The turn whose play made the winner's advantage permanent; null = wire-to-wire or unknown. */
  turningPoint: number | null;
  keyMoments: TurnAnalysis[];
  misplays: GameMisplay[];
  reads: GameRead[];
  /** False when played actions were unavailable: an empty misplay list then means "unknown", not "clean". */
  tracked: boolean;
  /** Lichess-style game accuracy per player (0–100); null below ACCURACY_MIN_TURNS graded turns. */
  accuracy?: { p1: number | null; p2: number | null };
  decisionTotals: { p1: number; p2: number };
  /** Net chance contribution across the game (p1 perspective). */
  chanceTotal: number;
  /** Chance booked past the favor boundary toward the winner: the decided game resolving; kept out of `chanceTotal`. */
  resolutionTotal: number;
  /** Chance over the dice-event turns (p1 perspective, resolution excluded); absent without dice info. */
  diceAnchorTotal?: number;
  /** `chanceTotal` in two parts: turns with a roll in their residual's direction and the rest; absent without rolls. */
  chanceSplit?: LuckSplit;
  conversion?: WinConversion;
  deniedEnd?: DeniedEnd;
  /** The dominant edge the summary credits the win to ('close' = the fallback sentence); absent without a winner. */
  winPath?: WinPath;
  summary: string;
}

type Winner = 'p1' | 'p2' | null;
type Side = 'p1' | 'p2';

// s[t] is the score at the start of turn t, plus a final entry after the last analyzed turn; unknown turns: undefined.
function scoreSeries(analyses: (TurnAnalysis | null)[]): (number | undefined)[] {
  const series: (number | undefined)[] = new Array(analyses.length + 2).fill(undefined);
  for (const analysis of analyses) {
    if (!analysis) continue;
    series[analysis.turn] = analysis.scoreBefore;
    if (analysis.scoreAfter !== null) series[analysis.turn + 1] = analysis.scoreAfter;
  }
  return series;
}

const ACCURACY_MIN_TURNS = 5;

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

// Past the favor boundary a locked endgame is underpriced, so its convergence is no luck; chance against the winner is.
function resolutionTurns(known: TurnAnalysis[], boundary: number | null, winner: Winner): Set<number> {
  const towardWinner = (delta: number) => (winner === 'p1' ? delta > 0 : delta < 0);
  return new Set(boundary === null ? [] : known
    .filter(analysis => analysis.turn >= boundary && analysis.attribution === 'chance' &&
      analysis.chanceDelta !== null && towardWinner(analysis.chanceDelta))
    .map(analysis => analysis.turn));
}

// Selected per side: a global top list would let one player's numbers crowd the other's out.
function misplaysFor(known: TurnAnalysis[], side: Side): GameMisplay[] {
  return known
    .filter(analysis => badTier(analysis[side]) &&
      analysis[side].played && analysis[side].best && !analysis[side].riskPaidOff)
    .map(analysis => ({
      turn: analysis.turn,
      side,
      regret: analysis[side].regret ?? 0,
      played: analysis[side].played!.label,
      // A mechanically null best displays as its co-optimal alternative, as in the turn summary.
      better: analysis[side].bestNull?.alternative?.label ?? analysis[side].best!.label,
      ...(analysis[side].tier ? { tier: analysis[side].tier } : {}),
      ...(analysis[side].riskUnpunished ? { riskUnpunished: true } : {}),
      ...(analysis[side].sacrifice ? { sacrifice: true } : {}),
      ...misplayExtrasFor(analysis[side]),
    }))
    .sort((a, b) => b.regret - a.regret)
    .slice(0, REPORT_MISPLAYS_PER_SIDE);
}

// Reads stay off the list when the side lost ground (their regret leaves the totals) or the turn is inside a standoff.
function readsFor(known: TurnAnalysis[], side: Side, standoffs: readonly Standoff[]): GameRead[] {
  return known
    .filter(analysis => analysis[side].riskPaidOff && analysis[side].played && !lostGround(analysis, side) &&
      !inStandoff(standoffs, analysis.turn))
    .map(analysis => ({
      turn: analysis.turn,
      side,
      played: analysis[side].played!.label,
      payoff: analysis[side].riskPayoff ?? 0,
    }))
    .sort((a, b) => b.payoff - a.payoff)
    .slice(0, REPORT_READS_PER_SIDE);
}

const regretOf = (side: SideAnalysis) => (side.riskPaidOff ? 0 : side.regret ?? 0);

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

interface WinStory {
  seeds: TurnAnalysis[];
  conversion: ReturnType<typeof conversionFor>;
  denied: DeniedEnd | null;
  /** The largest roll against the winner, absent where the denied end already speaks that turn. */
  roll: BiggestRoll | null;
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
  chanceSplit: LuckSplit | null;
  diceTurns: ReadonlySet<number> | null;
  rollFlip: RollFlip | null;
}): WinStory {
  const { known, winner, turningPoint, playedTracking } = args;
  const loser = winner === 'p1' ? 'p2' : 'p1';
  const seeds = !playedTracking ? [] : seedsOfTheLoss(known, loser, turningPoint);
  const conversion = conversionFor(known, winner, args.playerNames);
  const denied = deniedEndFor(known, args.diceTurns);
  const roll = biggestRollFor(known, winner, args.rollFlip, denied?.turn);
  const tip = tipClause(known, winner, args.playerNames[sideIndex(winner)], turningPoint, args.diceTurns);
  const path = winPathFor({
    known, series: args.series, boundary: args.boundary, winner, playerNames: args.playerNames, chanceTotal: args.chanceTotal,
    diceAnchor: args.diceAnchor, chanceSplit: args.chanceSplit, playedTracking, seedsSpoken: seeds.length > 0,
  });
  if (!path && !conversion && seeds.length === 0 && turningPoint !== null) {
    return { seeds, conversion, denied, roll, tip, path: closeGameFallback(args.playerNames[sideIndex(winner)]) };
  }
  return { seeds, conversion, denied, roll, tip, path };
}

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
  if (story.roll) sentences.push(biggestRollSentence(story.roll, winnerName));
  if (story.seeds.length > 0) {
    const parts = story.seeds.map(analysis => seedPhrase(analysis, loser));
    sentences.push(`The seeds of the loss: ${parts.join(' and ')}.`);
  } else if (playedTracking && decisionTotals[loser] < CLEAN_PLAY_TOTAL) {
    sentences.push(story.path
      ? `${loserName}'s play was clean.`
      : `${loserName}'s play was clean: the loss came from matchup and variance, not blunders.`);
  }
  if (story.path) sentences.push(story.path.sentence);
  return sentences;
}

function reportSummary(
  known: TurnAnalysis[],
  playerNames: [string, string],
  winner: Winner,
  turningPoint: number | null,
  playedTracking: boolean,
  decisionTotals: { p1: number; p2: number },
  luck: { chanceTotal: number; diceAnchor: number | null; split: LuckSplit | null },
  story: WinStory | null,
  series: (number | undefined)[],
  standoffs: readonly Standoff[],
): string {
  const { chanceTotal, diceAnchor, split } = luck;
  const sentences: string[] = [];
  if (winner && story) {
    sentences.push(...winnerSentences(playerNames, winner, turningPoint, playedTracking, decisionTotals, story, series));
  } else if (known.length > 0) {
    sentences.push('No winner recorded; the game may be unfinished.');
  }
  if (standoffs.length > 0) sentences.push(standoffSentence(standoffs));

  if (!story?.path?.foldLuck && Math.abs(chanceTotal) >= LUCK_TOTAL_THRESHOLD) {
    sentences.push(luckSentence(chanceTotal, diceAnchor, playerNames, split));
  }
  return sentences.join(' ');
}

function optionalFields(story: WinStory | null, diceAnchor: number | null, split: LuckSplit | null): Partial<GameReport> {
  return {
    ...(diceAnchor !== null ? { diceAnchorTotal: diceAnchor } : {}),
    ...(split ? { chanceSplit: split } : {}),
    ...(story?.conversion ? { conversion: story.conversion.conversion } : {}),
    ...(story?.denied ? { deniedEnd: story.denied } : {}),
    ...(story?.path ? { winPath: story.path.winPath } : {}),
  };
}

export function buildGameReport(
  analyses: (TurnAnalysis | null)[],
  playerNames: [string, string],
  winner: 'p1' | 'p2' | null,
  /** False = played actions unavailable: no seeds, no clean-play claim. */
  playedTracking = true,
  /** Turns with a protocol-visible dice event (dice-events.ts); null = no dice info, luck claims stay ungated. */
  diceTurns: ReadonlySet<number> | null = null,
  /** Score of the next root with the biggest roll's die turned over (rolled-copy.ts); null = not played. */
  rollFlip: RollFlip | null = null,
): GameReport {
  const known = analyses.filter((entry): entry is TurnAnalysis => entry !== null);

  const series = scoreSeries(analyses);
  const boundary = winner ? favorBoundary(series, winner) : null;
  const resolution = resolutionTurns(known, boundary, winner);
  const standoffs = standoffsOf(known);
  const keyMoments = keyMomentsFor(known, resolution, winner, diceTurns, standoffs);
  const misplays = !playedTracking ? [] : [...misplaysFor(known, 'p1'), ...misplaysFor(known, 'p2')]
    .sort((a, b) => a.turn - b.turn || a.side.localeCompare(b.side));
  const reads = !playedTracking ? [] : [...readsFor(known, 'p1', standoffs), ...readsFor(known, 'p2', standoffs)]
    .sort((a, b) => a.turn - b.turn || a.side.localeCompare(b.side));
  const { decisionTotals, chanceTotal, resolutionTotal } = gameTotals(known, resolution);

  const accuracy = playedTracking
    ? { p1: accuracyFor(known, 'p1', series), p2: accuracyFor(known, 'p2', series) }
    : { p1: null, p2: null };

  const diceAnchor = diceAnchorFor(known, diceTurns, resolution);
  const chanceSplit = luckSplit(known, resolution);

  // The play that produced the boundary score happened on the turn before.
  const turningPoint = boundary !== null && boundary > 1 ? boundary - 1 : null;
  const story = winner === null ? null : winStoryFor({
    known, series, boundary, playerNames, winner, turningPoint, playedTracking, chanceTotal, diceAnchor, chanceSplit, diceTurns, rollFlip,
  });
  const summary = reportSummary(known, playerNames, winner, turningPoint, playedTracking, decisionTotals,
    { chanceTotal, diceAnchor, split: chanceSplit }, story, series, standoffs);

  return {
    winner, turningPoint, keyMoments, misplays, reads, tracked: playedTracking,
    accuracy, decisionTotals, chanceTotal, resolutionTotal, summary,
    ...optionalFields(story, diceAnchor, chanceSplit),
  };
}
