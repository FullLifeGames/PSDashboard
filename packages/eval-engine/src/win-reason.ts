import { BREADTH_MIN_OPTIONS, TIER_THRESHOLDS, playedSetupMove, type SideAnalysis, type TurnAnalysis } from './analysis.ts';
import { DECIDED_SCORE } from './turn-analysis/types.ts';
import { KEY_TURN_SWING } from './graph.ts';
import { NEVER_ACTED_WORDS, choiceSentence, delayClause, displayBest, forcedQualifier, koPhrase, phrase, regretText } from './prose/phrases.ts';
import { chanceRolled, rollsCarry, type LuckSplit } from './turn-analysis/luck.ts';
import { lostGround } from './turn-analysis/risk.ts';
import { SPOKEN_MASS } from './types.ts';
import { winDeltaText, winPercent } from './winprob.ts';
import { sideIndex } from '@fulllifegames/replay-core';

// The winner-side story of the report; pure, no sim imports, main-bundle safe.

type Side = 'p1' | 'p2';
type PlayerNames = [string, string];

/** A turn ranks by its biggest COMPONENT, not its net: the game's biggest roll can net to almost nothing. */
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

/** The dominant edge the summary credits the win to ('close' = no single edge). */
export interface WinPath {
  factor: 'grind' | 'decisions' | 'reads' | 'variance' | 'close';
  /** wp-units behind the claim (0 for 'close'). */
  size: number;
}

export interface WinPathResult {
  winPath: WinPath;
  sentence: string;
  /** The sentence already tells the luck story: the standalone luck line stays silent. */
  foldLuck: boolean;
}

const WIN_PATH_FLOOR = TIER_THRESHOLDS.mistake;
/** Net chance worth a luck sentence; shared with the report's luck line. */
export const LUCK_TOTAL_THRESHOLD = 0.25;
const GRIND_WINDOW = 12;
const GRIND_MIN_TURNS = 8;
const MATCHUP_EDGE = TIER_THRESHOLDS.mistake;
const NEGLIGIBLE_REGRET = 0.02;

const toward = (winner: Side, delta: number): number => (winner === 'p1' ? delta : -delta);
const other = (side: Side): Side => (side === 'p1' ? 'p2' : 'p1');

// The visible dice ACTIVELY contradict the ledger: at least an inaccuracy of dice-turn chance runs the other way.
// Asymmetric on purpose: damage rolls leave no protocol marker, so a weak anchor proves nothing.
const diceContradict = (chanceTotal: number, diceAnchor: number | null): boolean =>
  diceAnchor !== null && Math.abs(diceAnchor) >= TIER_THRESHOLDS.inaccuracy &&
  chanceTotal !== 0 && Math.sign(diceAnchor) !== Math.sign(chanceTotal);

const rollsBehind = (chanceTotal: number, diceAnchor: number | null, split: LuckSplit | null): boolean =>
  split ? rollsCarry(chanceTotal, split) : !diceContradict(chanceTotal, diceAnchor);

// The part no roll explains is an estimate that moved, no probability. Under 1% the rolls favored neither side.
function rollsOnlyLuckSentence(split: LuckSplit, playerNames: PlayerNames): string {
  if (Math.abs(split.rolled) * 50 < 1) return 'The rolls favored neither side.';
  return `The rolls gave ${playerNames[split.rolled > 0 ? 0 : 1]} ${winDeltaText(Math.abs(split.rolled))}.`;
}

/** The luck line: "luck" only while the visible dice don't dispute it (with the split: when the rolls carry it). */
export function luckSentence(
  chanceTotal: number,
  diceAnchor: number | null,
  playerNames: PlayerNames,
  split: LuckSplit | null = null,
): string {
  if (split && !rollsCarry(chanceTotal, split)) return rollsOnlyLuckSentence(split, playerNames);
  if (!split && diceContradict(chanceTotal, diceAnchor)) {
    const beneficiary = playerNames[chanceTotal > 0 ? 0 : 1];
    const diceName = playerNames[(diceAnchor ?? 0) > 0 ? 0 : 1];
    return `Chance swings favored ${beneficiary} overall (${winDeltaText(Math.abs(chanceTotal))}), ` +
      `while the visible dice favored ${diceName}.`;
  }
  if (split) return `Luck ran ${chanceTotal > 0 ? 'for' : 'against'} ${playerNames[0]} (${winDeltaText(split.rolled)} from the rolls).`;
  return `Luck ran ${chanceTotal > 0 ? 'for' : 'against'} ${playerNames[0]} overall (${winDeltaText(chanceTotal)}).`;
}

function barHoldsAfter(known: TurnAnalysis[], index: number, winner: Side): boolean {
  const sign = winner === 'p1' ? 1 : -1;
  return known.slice(index + 1).every(analysis => analysis.scoreBefore * sign >= DECIDED_SCORE);
}

/** First forced win or decided sweep of the winner from which the bar holds to the last turn; forced wins a tie. */
export function conversionFor(
  known: TurnAnalysis[],
  winner: Side,
  playerNames: PlayerNames,
): { conversion: WinConversion; sentence: string } | null {
  const loserName = playerNames[sideIndex(other(winner))];
  for (const [index, analysis] of known.entries()) {
    if (!barHoldsAfter(known, index, winner)) continue;
    const side = analysis[winner];
    const forced = side.forcedWin;
    if (forced && forced.mass >= SPOKEN_MASS) {
      return {
        conversion: { kind: 'forced', turn: analysis.turn, provenTurns: forced.turns },
        sentence: `From turn ${analysis.turn} the win was forced: ` +
          `every reply lost within ${forced.turns} turn${forced.turns === 1 ? '' : 's'}${forcedQualifier(forced)}${delayClause(forced, true)}.${choiceSentence(forced, true)}`,
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

/** The tip turn's mechanism: the winner's read, or a winner-ward roll the protocol shows; no dice event, no name. */
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
  const diceShown = chanceRolled(analysis) ?? (diceTurns === null || diceTurns.has(analysis.turn));
  if (analysis.attribution === 'chance' && diceShown && toward(winner, analysis.chanceDelta ?? 0) > 0) {
    return `, on a roll that went ${winnerName}'s way`;
  }
  return '';
}

export function matchupClause(series: (number | undefined)[], winner: Side): string {
  const first = series.find((value): value is number => value !== undefined);
  if (first === undefined || toward(winner, first) < MATCHUP_EDGE) return '';
  return ` from a ${winPercent(winner === 'p1' ? first : -first)}% opening matchup`;
}

// Paid-off reads, unpunished risks and sacks carry no blame.
const punishedRegret = (side: SideAnalysis): number =>
  side.riskPaidOff || side.riskUnpunished || side.sacrifice ? 0 : side.regret ?? 0;

interface ReadExample { turn: number; label: string; payoff: number }

function paidReads(analyses: TurnAnalysis[], side: Side): ReadExample[] {
  return analyses
    .filter(analysis => analysis[side].riskPaidOff && analysis[side].played && !lostGround(analysis, side))
    .map(analysis => ({
      turn: analysis.turn,
      label: analysis[side].played!.label,
      payoff: analysis[side].riskPayoff ?? 0,
    }))
    .sort((a, b) => b.payoff - a.payoff);
}

// Real breadth but only one line held (viableCount 1) and the side found it, or only the depth+1 pass saw it hold.
const narrowTurn = (side: SideAnalysis): boolean =>
  (side.choiceCount ?? 0) >= BREADTH_MIN_OPTIONS &&
  ((side.viableCount === 1 && (side.regret ?? 1) < TIER_THRESHOLDS.inaccuracy) ||
    side.verifiedAtDepth === true);

interface Grind {
  spanStart: number;
  spanCount: number;
  /** Position change over the span, toward the winner. */
  drift: number;
  /** The span's decision share toward the winner: the grind's ranking size. */
  size: number;
  narrow: number;
  read: ReadExample | null;
}

// Step by step through the window before the favor boundary, no single big swing; a chance-led climb is variance.
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
  const main = `${winnerName} built it step by step from turn ${grind.spanStart}: ` +
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
  /** The ledger split into the rolled part and the rest (luck.ts); null without the turns' rolls. */
  chanceSplit: LuckSplit | null;
  playedTracking: boolean;
  seedsSpoken: boolean;
}

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
  if (luck >= LUCK_TOTAL_THRESHOLD && rollsBehind(args.chanceTotal, args.diceAnchor, args.chanceSplit)) {
    candidates.push({ factor: 'variance', size: luck });
  }
  return candidates;
}

/** The dominant edge behind the win as one sentence; null when the seeds cover it or nothing clears the floor. */
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
    const sentence = `${loserName} gave it away in small steps: ${winDeltaText(-punished[loser])} ` +
      `to decisions across the game, against ${winnerBit} for ${winnerName}.`;
    return { winPath: { factor: 'decisions', size: top.size }, sentence, foldLuck: false };
  }
  if (top.factor === 'reads') {
    const examples = reads.slice(0, 2).sort((a, b) => a.turn - b.turn)
      .map(read => `${phrase(read.label)} on turn ${read.turn} (${winDeltaText(read.payoff)})`);
    return { winPath: { factor: 'reads', size: top.size }, sentence: `${winnerName} won it on reads: ${examples.join(' and ')}.`, foldLuck: false };
  }
  const sentence = args.chanceSplit
    ? `The rolls decided it: luck ran ${winnerName}'s way (${winDeltaText(toward(winner, args.chanceSplit.rolled))} from the rolls).`
    : `The rolls decided it: luck ran ${winnerName}'s way overall (${winDeltaText(top.size)}).`;
  return { winPath: { factor: 'variance', size: top.size }, sentence, foldLuck: true };
}

export const closeGameFallback = (winnerName: string): WinPathResult => ({
  winPath: { factor: 'close', size: 0 },
  sentence: `No single edge decided it; ${winnerName} converted a close game turn by turn.`,
  foldLuck: false,
});

/** The loser's two biggest punished misplays up to the turning point; unpunished risks and sacks cost nothing. */
export function seedsOfTheLoss(known: TurnAnalysis[], loser: Side, turningPoint: number | null): TurnAnalysis[] {
  return known
    .filter(analysis => (turningPoint === null || analysis.turn <= turningPoint) &&
      badTier(analysis[loser]) && analysis[loser].played && analysis[loser].best &&
      !analysis[loser].riskUnpunished && !analysis[loser].sacrifice)
    .sort((a, b) => (b[loser].regret ?? 0) - (a[loser].regret ?? 0))
    .slice(0, 2)
    .sort((a, b) => a.turn - b.turn);
}

/** One seed as "turn N (played, regret; safer was better)"; a regret over 1 reads as the two win chances it spans. */
export function seedPhrase(analysis: TurnAnalysis, loser: Side): string {
  const side = analysis[loser];
  const setup = playedSetupMove(side) ? '; a setup move the engine may undervalue' : '';
  const better = displayBest(side);
  // A hit the opponent's click stopped is no claim (the turn card drops it too).
  const odds = side.hitStopped?.played ? undefined : side.played!.koOdds;
  const oddsBit = odds ? ` (${odds.label ? `${phrase(odds.label)}: ` : ''}${koPhrase(odds)})` : '';
  // A body that fell before it moved played nothing; the sentence says so instead of printing the stand-in's label.
  const played = side.neverActed ? NEVER_ACTED_WORDS : `${phrase(side.played!.label)}${oddsBit}`;
  return `turn ${analysis.turn} (${played}, ` +
    `${regretText(side.regret ?? 0, better.ev, side.played!.ev, side.faintedFraction)}; safer was ${phrase(better.label)}${setup})`;
}
