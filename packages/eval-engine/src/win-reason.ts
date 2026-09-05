import { BREADTH_MIN_OPTIONS, TIER_THRESHOLDS, playedSetupMove, type SideAnalysis, type TurnAnalysis } from './analysis.ts';
import { KEY_TURN_SWING } from './graph.ts';
import { koPhrase, phrase } from './prose/phrases.ts';
import { SPOKEN_MASS } from './types.ts';
import { winDeltaText, winPercent } from './winprob.ts';
import { sideIndex } from '@fulllifegames/replay-core';

/**
 * Why the winner won: the report's winner-side story. The old summary told
 * the win only through the loser (seeds of the loss, clean play) — a game
 * the loser never handed over read as if the win just happened. This module
 * detects the winner's own path from data the walk already carries: the
 * conversion (first proven forced win or decided sweep), the dominant edge
 * (a steady grind, accumulated giveaways, paid-off reads, or the rolls),
 * the tip turn's mechanism, and a lopsided starting matchup. Pure — no sim
 * imports, main-bundle safe.
 */

type Side = 'p1' | 'p2';
type PlayerNames = [string, string];

/**
 * A turn ranks by its biggest COMPONENT, not its net: the game's biggest
 * roll can net to almost nothing when the decision delta pushes the other
 * way (573756 t73: chance +0.43 on a net of +0.18), and a selection keyed
 * on the net alone never surfaces it.
 */
export const momentScore = (analysis: TurnAnalysis): number =>
  Math.max(Math.abs(analysis.swing ?? 0), Math.abs(analysis.chanceDelta ?? 0));

export const badTier = (side: SideAnalysis): boolean =>
  side.tier === 'mistake' || side.tier === 'blunder';

/** The moment the winner sealed it: the first proven forced win at spoken mass, or the first decided sweep. */
export interface WinConversion {
  kind: 'forced' | 'decided';
  turn: number;
  /** decided: the mon that clears everything the loser has left. */
  species?: string;
  /** forced: the deepest proven line in own moves. */
  provenTurns?: number;
}

/** The dominant edge the summary credits the win to ('close' = the no-single-edge fallback). */
export interface WinPath {
  factor: 'grind' | 'decisions' | 'reads' | 'variance' | 'close';
  /** wp-units behind the claim (0 for 'close'). */
  size: number;
}

export interface WinPathResult {
  winPath: WinPath;
  sentence: string;
  /** The sentence already tells the luck story — the standalone luck line stays silent. */
  foldLuck: boolean;
}

/** A win-path factor must reach a mistake-sized edge before it may claim the game. */
const WIN_PATH_FLOOR = TIER_THRESHOLDS.mistake;
/** Net chance worth a luck sentence — shared with the report's luck line. */
export const LUCK_TOTAL_THRESHOLD = 0.25;
/** How many turns before the favor boundary the grind detector looks at. */
const GRIND_WINDOW = 12;
/** A grind needs at least this many analyzed turns in the window. */
const GRIND_MIN_TURNS = 8;
/** Starting score that reads as a lopsided matchup on a wire-to-wire win. */
const MATCHUP_EDGE = TIER_THRESHOLDS.mistake;
/** Punished regret below measurement noise renders as "next to nothing". */
const NEGLIGIBLE_REGRET = 0.02;

const toward = (winner: Side, delta: number): number => (winner === 'p1' ? delta : -delta);
const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

/**
 * The visible dice ACTIVELY contradict the chance ledger's direction — at
 * least an inaccuracy of dice-turn chance runs the other way. Asymmetric on
 * purpose: a weak or empty anchor proves nothing (damage rolls leave no
 * protocol marker), so only a contradiction demotes a luck claim.
 */
const diceContradict = (chanceTotal: number, diceAnchor: number | null): boolean =>
  diceAnchor !== null && Math.abs(diceAnchor) >= TIER_THRESHOLDS.inaccuracy &&
  chanceTotal !== 0 && Math.sign(diceAnchor) !== Math.sign(chanceTotal);

/**
 * The luck line: named "luck" only while the visible dice don't dispute it.
 * Contradicted, it keeps the number but says what it is — the ledger's
 * residual — and names where the dice actually went (the draft game: two
 * crits and two Flame Body burns into the winner under a net toward them).
 */
export function luckSentence(
  chanceTotal: number,
  diceAnchor: number | null,
  playerNames: PlayerNames,
): string {
  if (diceContradict(chanceTotal, diceAnchor)) {
    const beneficiary = playerNames[chanceTotal > 0 ? 0 : 1];
    const diceName = playerNames[(diceAnchor ?? 0) > 0 ? 0 : 1];
    return `Chance swings favored ${beneficiary} overall (${winDeltaText(Math.abs(chanceTotal))}), ` +
      `while the visible dice favored ${diceName}.`;
  }
  return `Luck ran ${chanceTotal > 0 ? 'for' : 'against'} ${playerNames[0]} overall (${winDeltaText(chanceTotal)}).`;
}

/** First forced-win (spoken mass) or decided signal on the WINNER's side, in turn order; forced wins a same-turn tie. */
export function conversionFor(
  known: TurnAnalysis[],
  winner: Side,
  playerNames: PlayerNames,
): { conversion: WinConversion; sentence: string } | null {
  const loserName = playerNames[sideIndex(other(winner))];
  for (const analysis of known) {
    const side = analysis[winner];
    const forced = side.forcedWin;
    if (forced && forced.mass >= SPOKEN_MASS) {
      const tail = forced.caveat === 'barring-crit' ? ', barring a crit'
        : forced.caveat === 'sampled-rolls' ? ' on the sampled rolls' : '';
      return {
        conversion: { kind: 'forced', turn: analysis.turn, provenTurns: forced.turns },
        sentence: `From turn ${analysis.turn} the win was forced — ` +
          `every reply lost within ${forced.turns} turn${forced.turns === 1 ? '' : 's'}${tail}.`,
      };
    }
    if (side.decided) {
      return {
        conversion: { kind: 'decided', turn: analysis.turn, species: side.decided.species },
        sentence: `From turn ${analysis.turn}, ${side.decided.species} cleared everything ${loserName} had left.`,
      };
    }
  }
  return null;
}

/**
 * The tip turn's mechanism, when it has one the seeds don't already tell:
 * the winner's read, or a winner-ward roll the protocol shows. A chance
 * entry without a visible dice event stays unnamed — the ledger is a
 * residual, and 573756 t70 booked the engine disagreeing with itself
 * across two evaluations (Swords Dance priced a turn late) as a "roll".
 * Without dice info at all the clause stays ungated, like the luck line.
 */
export function tipClause(
  known: TurnAnalysis[],
  winner: Side,
  winnerName: string,
  turningPoint: number | null,
  diceTurns: ReadonlySet<number> | null,
): string {
  const analysis = known.find(entry => entry.turn === turningPoint);
  if (!analysis) return '';
  const played = analysis[winner].played;
  if (analysis.attribution === `${winner}-read` && played) {
    return `, when ${winnerName}'s read (${phrase(played.label)}) paid off`;
  }
  const diceShown = diceTurns === null || diceTurns.has(analysis.turn);
  if (analysis.attribution === 'chance' && diceShown && toward(winner, analysis.chanceDelta ?? 0) > 0) {
    return `, on a roll that went ${winnerName}'s way`;
  }
  return '';
}

/** On a wire-to-wire win, name the starting matchup when it was lopsided. */
export function matchupClause(series: (number | undefined)[], winner: Side): string {
  const first = series.find((value): value is number => value !== undefined);
  if (first === undefined || toward(winner, first) < MATCHUP_EDGE) return '';
  return ` — a ${winPercent(winner === 'p1' ? first : -first)}% matchup from the start`;
}

/** Regret that actually cost something: paid-off reads, unpunished risks, and sacks carry no blame. */
const punishedRegret = (side: SideAnalysis): number =>
  side.riskPaidOff || side.riskUnpunished || side.sacrifice ? 0 : side.regret ?? 0;

interface ReadExample { turn: number; label: string; payoff: number }

/** A side's paid-off reads, biggest payoff first. */
function paidReads(analyses: TurnAnalysis[], side: Side): ReadExample[] {
  return analyses
    .filter(analysis => analysis[side].riskPaidOff && analysis[side].played)
    .map(analysis => ({
      turn: analysis.turn,
      label: analysis[side].played!.label,
      payoff: analysis[side].riskPayoff ?? 0,
    }))
    .sort((a, b) => b.payoff - a.payoff);
}

/**
 * "The right play even though it was hard to spot": the position offered
 * real breadth but only one line held (viableCount 1) and the side found
 * it — or the engine itself needed the depth+1 verification pass to see
 * the played line holds up.
 */
const narrowTurn = (side: SideAnalysis): boolean =>
  (side.choiceCount ?? 0) >= BREADTH_MIN_OPTIONS &&
  ((side.viableCount === 1 && (side.regret ?? 1) < TIER_THRESHOLDS.inaccuracy) ||
    side.verifiedAtDepth === true);

interface Grind {
  spanStart: number;
  spanCount: number;
  /** Position change over the span, toward the winner. */
  drift: number;
  /** The span's decision share toward the winner — the grind's ranking size. */
  size: number;
  narrow: number;
  read: ReadExample | null;
}

/**
 * The draft-game shape: the winner improves the position step by step
 * through the window before the favor boundary — no single big swing, and
 * the drift runs on the choices, not the rolls. A chance-led climb stays a
 * variance story.
 */
function grindFor(
  known: TurnAnalysis[],
  series: (number | undefined)[],
  boundary: number | null,
  winner: Side,
): Grind | null {
  if (boundary === null || boundary <= 1) return null;
  const start = Math.max(1, boundary - GRIND_WINDOW);
  const span = known.filter(analysis => analysis.turn >= start && analysis.turn < boundary);
  if (span.length < GRIND_MIN_TURNS) return null;
  if (span.some(analysis => momentScore(analysis) >= KEY_TURN_SWING)) return null;
  const decisionShare = span.reduce((sum, analysis) => sum + toward(winner, analysis.decisionDelta ?? 0), 0);
  const chanceShare = span.reduce((sum, analysis) => sum + toward(winner, analysis.chanceDelta ?? 0), 0);
  if (decisionShare < chanceShare) return null;
  const from = series[span[0].turn];
  const to = series[boundary];
  if (from === undefined || to === undefined) return null;
  return {
    spanStart: span[0].turn,
    spanCount: span.length,
    drift: toward(winner, to - from),
    size: decisionShare,
    narrow: span.filter(analysis => narrowTurn(analysis[winner])).length,
    read: paidReads(span, winner)[0] ?? null,
  };
}

const grindSentence = (grind: Grind, winnerName: string): string => {
  const main = `${winnerName} built it step by step from turn ${grind.spanStart} — ` +
    `${winDeltaText(grind.drift)} across ${grind.spanCount} turns with no single big swing.`;
  const parts: string[] = [];
  if (grind.narrow > 0) parts.push(`${grind.narrow} turn${grind.narrow === 1 ? '' : 's'} where only one line held`);
  if (grind.read) {
    parts.push(`a read that paid off on turn ${grind.read.turn} ` +
      `(${phrase(grind.read.label)}, ${winDeltaText(grind.read.payoff)})`);
  }
  const rider = parts.length > 0
    ? ` ${winnerName} kept finding the right play where it was hard to spot: ${parts.join(', and ')}.`
    : '';
  return `${main}${rider}`;
};

export interface WinPathArgs {
  known: TurnAnalysis[];
  series: (number | undefined)[];
  boundary: number | null;
  winner: Side;
  playerNames: PlayerNames;
  /** Net chance outside the resolution turns (p1 perspective). */
  chanceTotal: number;
  /** Chance summed over the protocol's dice-event turns (p1 perspective), null without dice info. */
  diceAnchor: number | null;
  playedTracking: boolean;
  /** The seeds sentence already tells the decisions story — don't tell it twice. */
  seedsSpoken: boolean;
}

/** The ranked factor candidates: each edge that clears its floor, in specificity order (ties keep the earlier). */
function factorCandidates(
  args: WinPathArgs,
  punished: { p1: number; p2: number },
  readsSize: number,
  grind: Grind | null,
): { factor: WinPath['factor']; size: number }[] {
  const { winner, playedTracking } = args;
  const loser = other(winner);
  const luck = toward(winner, args.chanceTotal);
  const candidates: { factor: WinPath['factor']; size: number }[] = [];
  if (grind && grind.size >= WIN_PATH_FLOOR) candidates.push({ factor: 'grind', size: grind.size });
  if (playedTracking && punished[loser] - punished[winner] >= WIN_PATH_FLOOR) {
    candidates.push({ factor: 'decisions', size: punished[loser] - punished[winner] });
  }
  if (playedTracking && readsSize >= WIN_PATH_FLOOR) candidates.push({ factor: 'reads', size: readsSize });
  // "The rolls decided it" needs the visible dice on board with the claim.
  if (luck >= LUCK_TOTAL_THRESHOLD && !diceContradict(args.chanceTotal, args.diceAnchor)) {
    candidates.push({ factor: 'variance', size: luck });
  }
  return candidates;
}

/** The dominant edge behind the win, spoken as one sentence; null when the seeds cover it or nothing clears the floor. */
export function winPathFor(args: WinPathArgs): WinPathResult | null {
  const { known, winner, seedsSpoken } = args;
  const loser = other(winner);
  const winnerName = args.playerNames[sideIndex(winner)];
  const loserName = args.playerNames[sideIndex(loser)];
  const punished = {
    p1: known.reduce((sum, analysis) => sum + punishedRegret(analysis.p1), 0),
    p2: known.reduce((sum, analysis) => sum + punishedRegret(analysis.p2), 0),
  };
  const reads = paidReads(known, winner);
  const readsSize = reads.reduce((sum, read) => sum + read.payoff, 0);
  const grind = grindFor(known, args.series, args.boundary, winner);

  const top = factorCandidates(args, punished, readsSize, grind)
    .reduce((best, entry) => (entry.size > best.size ? entry : best),
      { factor: null as WinPath['factor'] | null, size: -Infinity });
  if (top.factor === null || (top.factor === 'decisions' && seedsSpoken)) return null;

  if (top.factor === 'grind') {
    return { winPath: { factor: 'grind', size: top.size }, sentence: grindSentence(grind!, winnerName), foldLuck: false };
  }
  if (top.factor === 'decisions') {
    const winnerBit = punished[winner] < NEGLIGIBLE_REGRET ? 'next to nothing' : winDeltaText(-punished[winner]);
    const sentence = `${loserName} gave it away in small steps — ${winDeltaText(-punished[loser])} ` +
      `to decisions across the game, against ${winnerBit} for ${winnerName}.`;
    return { winPath: { factor: 'decisions', size: top.size }, sentence, foldLuck: false };
  }
  if (top.factor === 'reads') {
    const examples = reads.slice(0, 2)
      .map(read => `${phrase(read.label)} on turn ${read.turn} (${winDeltaText(read.payoff)})`);
    return { winPath: { factor: 'reads', size: top.size }, sentence: `${winnerName} won it on reads: ${examples.join(' and ')}.`, foldLuck: false };
  }
  const sentence = `The rolls decided it — luck ran ${winnerName}'s way overall (${winDeltaText(top.size)}).`;
  return { winPath: { factor: 'variance', size: top.size }, sentence, foldLuck: true };
}

/** Nothing crossed a floor and nothing else explained the tip — say so instead of saying nothing. */
export const closeGameFallback = (winnerName: string): WinPathResult => ({
  winPath: { factor: 'close', size: 0 },
  sentence: `No single edge decided it — ${winnerName} converted a close game turn by turn.`,
  foldLuck: false,
});

/**
 * The loser's two biggest punished misplays up to the turning point. An
 * unpunished risk cost nothing — it cannot have seeded the loss; a
 * deliberate low-cost sack likewise.
 */
export function seedsOfTheLoss(known: TurnAnalysis[], loser: Side, turningPoint: number | null): TurnAnalysis[] {
  return known
    .filter(analysis => (turningPoint === null || analysis.turn <= turningPoint) &&
      badTier(analysis[loser]) && analysis[loser].played && analysis[loser].best &&
      !analysis[loser].riskUnpunished && !analysis[loser].sacrifice)
    .sort((a, b) => (b[loser].regret ?? 0) - (a[loser].regret ?? 0))
    .slice(0, 2)
    .sort((a, b) => a.turn - b.turn);
}

/** One seed, as "turn N (played, regret — safer was better)"; the played move's analytic odds ground the claim (round 6). */
export function seedPhrase(analysis: TurnAnalysis, loser: Side): string {
  const side = analysis[loser];
  const setup = playedSetupMove(side) ? '; a setup move the engine may undervalue' : '';
  const better = side.bestNull?.alternative?.label ?? side.best!.label;
  const oddsBit = side.played!.koOdds ? ` (${koPhrase(side.played!.koOdds)})` : '';
  return `turn ${analysis.turn} (${phrase(side.played!.label)}${oddsBit}, ` +
    `${winDeltaText(-(side.regret ?? 0))} — safer was ${phrase(better)}${setup})`;
}
