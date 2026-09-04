import type { EntryUnanswered, EvalMatrix, RankedChoice } from '../types.ts';
import { nullMoveReason } from '../null-moves.ts';
import { detectStreakOdds } from '../streaks.ts';
import { TIE_EPSILON } from '../rank.ts';
import { SPOKEN_MASS } from '../types.ts';
import {
  CONDITIONAL_MIX_MIN, FORCED_MIX_THRESHOLD, TIER_THRESHOLDS, decidedSeenKey, forcedWinSeenKey, unansweredSeenKey,
  type AnalyzeTurnParams, type Side, type SideAnalysis, type VerdictTier,
} from './types.ts';
import { matchPlayedChoice } from './played-match.ts';
import type { SideGrading } from './grading.ts';

/**
 * Narrative signals (round 5 ⑥ onward): computed here where the full
 * result is in scope, rendered in summary.ts/report.ts. All of them fail
 * closed on missing data and never touch the grading.
 */

/** How many ranked options sit within an inaccuracy of best — the side's real decision breadth. */
const viableCountFor = (best: RankedChoice | null, options: RankedChoice[]): number | undefined =>
  best === null ? undefined :
    options.filter(option => best.ev - option.ev <= TIER_THRESHOLDS.inaccuracy).length;

/** The side's view of the solved root matrix: own rows and labels, the opponent's labels, the equilibrium mix. */
interface MatrixView {
  matrix: EvalMatrix | undefined;
  sideChoices: string[] | undefined;
  sideLabels: string[] | undefined;
  oppLabels: string[] | undefined;
  mix: number[] | undefined;
  /** Own-perspective matrix value of (own index i, opponent index j). */
  ownValue: (grid: EvalMatrix, i: number, j: number) => number;
  /** Index of the mix's heaviest choice; −1 without a mix. */
  mixTop: number;
}

function matrixView(params: AnalyzeTurnParams, key: Side): MatrixView {
  const matrix = params.result.matrix;
  const pick = <T>(p1: T, p2: T): T => (key === 'p1' ? p1 : p2);
  const sideChoices = pick(matrix?.p1Choices, matrix?.p2Choices);
  const sideLabels = pick(matrix?.p1Labels, matrix?.p2Labels);
  const oppLabels = pick(matrix?.p2Labels, matrix?.p1Labels);
  const mix = pick(matrix?.mixes.p1, matrix?.mixes.p2);
  const ownValue = (grid: EvalMatrix, i: number, j: number): number =>
    key === 'p1' ? grid.values[i][j] : -grid.values[j][i];
  const mixTop = mix && mix.length > 0
    ? mix.reduce((top, weight, index) => (weight > mix[top] ? index : top), 0)
    : -1;
  return { matrix, sideChoices, sideLabels, oppLabels, mix, ownValue, mixTop };
}

/** The opponent replies against which the argmax pick and the mix's leaning pick each earn their keep. */
function splitReplies(
  matrix: EvalMatrix,
  oppLabels: string[],
  ownValue: MatrixView['ownValue'],
  bestIndex: number,
  mixTop: number,
): { bestWhen: string | null; mixWhen: string | null } {
  let bestWhen: string | null = null;
  let mixWhen: string | null = null;
  let bestDiff = 0;
  let mixDiff = 0;
  for (let j = 0; j < oppLabels.length; j++) {
    const diff = ownValue(matrix, bestIndex, j) - ownValue(matrix, mixTop, j);
    if (diff > bestDiff) { bestDiff = diff; bestWhen = oppLabels[j]; }
    if (diff < mixDiff) { mixDiff = diff; mixWhen = oppLabels[j]; }
  }
  return { bestWhen, mixWhen };
}

/**
 * The engine's own equilibrium leans a DIFFERENT choice than the argmax-EV
 * recommendation (weight ≥ CONDITIONAL_MIX_MIN): the recommendation
 * renders conditionally, with the opponent replies against which each
 * choice earns its keep. Only on tiered turns — where a recommendation
 * renders.
 */
function conditionalFor(
  tier: VerdictTier | undefined,
  view: MatrixView,
  best: RankedChoice | null,
): SideAnalysis['conditional'] {
  const { matrix, sideChoices, sideLabels, oppLabels, mix, mixTop } = view;
  if (!(tier && matrix && sideChoices && sideLabels && oppLabels && mix && best && mixTop >= 0)) return undefined;
  const bestIndex = sideChoices.indexOf(best.choice);
  if (!(bestIndex >= 0 && mixTop !== bestIndex && mix[mixTop] >= CONDITIONAL_MIX_MIN)) return undefined;
  const { bestWhen, mixWhen } = splitReplies(matrix, oppLabels, view.ownValue, bestIndex, mixTop);
  return { mixLabel: sideLabels[mixTop], mixWeight: mix[mixTop], bestWhen, mixWhen };
}

/** A near-pure equilibrium SWITCH (≥ FORCED_MIX_THRESHOLD with more than one option): a forced expectation named in prose. */
function forcedMixFor(view: MatrixView, options: RankedChoice[]): SideAnalysis['forcedMix'] {
  const { matrix, sideChoices, sideLabels, mix, mixTop } = view;
  if (matrix && sideChoices && sideLabels && mix && options.length > 1 && mixTop >= 0 &&
    mix[mixTop] >= FORCED_MIX_THRESHOLD && sideChoices[mixTop]?.startsWith('switch')) {
    return { label: sideLabels[mixTop], weight: mix[mixTop] };
  }
  return undefined;
}

/** The opponent's ACTUAL click as a matrix column (−1 when unknown), with the matched choice for the sentence. */
function opponentColumn(
  params: AnalyzeTurnParams,
  key: Side,
  matrix: EvalMatrix,
): { column: number; oppPlayed: RankedChoice | null } {
  const oppKey = key === 'p1' ? 'p2' as const : 'p1' as const;
  const oppChoices = key === 'p1' ? matrix.p2Choices : matrix.p1Choices;
  const oppPlayed = matchPlayedChoice(params.result, oppKey, params.played?.[oppKey] ?? null);
  const column = oppPlayed && oppChoices ? oppChoices.indexOf(oppPlayed.choice) : -1;
  return { column, oppPlayed };
}

/** The own row with the best own-perspective value in the column. */
function bestRowAgainst(
  view: MatrixView,
  matrix: EvalMatrix,
  rows: number,
  column: number,
): { bestRow: number; bestValue: number } {
  let bestRow = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < rows; i++) {
    const value = view.ownValue(matrix, i, column);
    if (value > bestValue) { bestValue = value; bestRow = i; }
  }
  return { bestRow, bestValue };
}

/**
 * Round 13: the read that was on the table. Against the opponent's ACTUAL
 * click (a known column, unlike the equilibrium the conditional reasons
 * over) the matrix knows the best own row; when it beats the played line
 * in that column by a mistake-sized gain, the shift narrative names the
 * concrete counterfactual (562428 t10: → Heatran into the Horn Leech).
 */
function hindsightReadFor(
  params: AnalyzeTurnParams,
  key: Side,
  view: MatrixView,
  played: RankedChoice | null,
): SideAnalysis['hindsightRead'] {
  const { matrix, sideChoices, sideLabels } = view;
  if (!(matrix && sideChoices && sideLabels && played)) return undefined;
  const { column, oppPlayed } = opponentColumn(params, key, matrix);
  const row = sideChoices.indexOf(played.choice);
  if (!(column >= 0 && row >= 0)) return undefined;
  const { bestRow, bestValue } = bestRowAgainst(view, matrix, sideChoices.length, column);
  const gain = bestValue - view.ownValue(matrix, row, column);
  if (bestRow >= 0 && bestRow !== row && gain >= TIER_THRESHOLDS.mistake) {
    return { response: sideLabels[bestRow], against: oppPlayed!.label, gain };
  }
  return undefined;
}

/** "→ X" (a pivot's "U-turn → X" included) names the entry target of a line. */
const entryTarget = (label: string | undefined): string | null =>
  label?.match(/→ (.+)$/)?.[1] ?? null;

/** The root's unanswered profile for the side: the open list and the switch-in-stage rows. */
function sideUnanswered(
  params: AnalyzeTurnParams,
  key: Side,
): { ownUnanswered: string[] | undefined; ownEntry: EntryUnanswered[] | undefined } {
  const ownUnanswered = params.result.unanswered?.[key];
  const ownEntry = key === 'p1' ? params.result.unanswered?.p1Entry : params.result.unanswered?.p2Entry;
  return { ownUnanswered, ownEntry };
}

/** The open (no live answer) signal for an entry target, else its switch-in-stage row. */
const entrySignal = (target: string, ownUnanswered: string[] | undefined, ownEntry: EntryUnanswered[] | undefined) =>
  ownUnanswered?.includes(target)
    ? { species: target }
    : ownEntry?.find(row => row.species === target);

/**
 * Round 13: entry-is-profit — the played or recommended line brings in a
 * mon from the root's unanswered profile (no live enemy wins the race pair
 * against it), so a clean entry is value on its own (648453 t13). Round
 * 14: the switch-in stage rides the same match — bench exhausted, a
 * standing active still holding — and carries the holder's species. A
 * stage the game report has already spoken (unansweredSeen) stays silent.
 */
function unansweredFor(
  params: AnalyzeTurnParams,
  key: Side,
  played: RankedChoice | null,
  best: RankedChoice | null,
): SideAnalysis['unanswered'] {
  const { ownUnanswered, ownEntry } = sideUnanswered(params, key);
  if (!((ownUnanswered && ownUnanswered.length > 0) || (ownEntry && ownEntry.length > 0))) return undefined;
  for (const target of [played?.label, best?.label].map(entryTarget)) {
    if (target === null) continue;
    const signal = entrySignal(target, ownUnanswered, ownEntry);
    if (!signal) continue;
    if (params.unansweredSeen?.has(unansweredSeenKey(key, signal))) continue;
    return signal;
  }
  return undefined;
}

/**
 * Round 15: the decided sweep / the near-decided roll — board states, not
 * click context: they attach to the owning side on every turn they hold
 * (display layers book resolution prose from the state) and announce only
 * until the game report has spoken them once.
 */
/** Round 35: the forced win for this side, spoken once by the report; when it speaks, the decided stages stay quiet. */
function forcedWinSignal(params: AnalyzeTurnParams, key: Side): SideAnalysis['forcedWin'] {
  const forced = params.result.forcedWin;
  if (!forced || forced.side !== key) return undefined;
  return {
    turns: forced.turns, mass: forced.mass, caveat: forced.caveat,
    ...(forced.open ? { open: forced.open } : {}),
    announce: !params.decidedSeen?.has(forcedWinSeenKey(key)),
  };
}

function decidedSignals(
  params: AnalyzeTurnParams,
  key: Side,
): { decided: SideAnalysis['decided']; nearDecided: SideAnalysis['nearDecided']; forcedWin: SideAnalysis['forcedWin'] } {
  let decided: SideAnalysis['decided'];
  const ownDecided = params.result.unanswered?.decided;
  if (ownDecided && ownDecided.side === key) {
    decided = {
      species: ownDecided.species,
      announce: !params.decidedSeen?.has(decidedSeenKey(key, { species: ownDecided.species })),
    };
  }
  let nearDecided: SideAnalysis['nearDecided'];
  const ownNear = params.result.unanswered?.nearDecided;
  if (ownNear && ownNear.side === key) {
    nearDecided = {
      species: ownNear.species, odds: ownNear.odds, removes: ownNear.removes,
      announce: !params.decidedSeen?.has(
        decidedSeenKey(key, { species: ownNear.species, removes: ownNear.removes })),
    };
  }
  const forcedWin = forcedWinSignal(params, key);
  if (forcedWin?.announce && forcedWin.mass >= SPOKEN_MASS) {
    // The proof speaks for the board; the decided stages keep their state, quietly.
    if (decided) decided = { ...decided, announce: false };
    if (nearDecided) nearDecided = { ...nearDecided, announce: false };
  }
  return { decided, nearDecided, forcedWin };
}

/**
 * The recommended best is MECHANICALLY NULL against the opposing active
 * (Will-O-Wisp into a Fire-type): a co-optimal option within the rank-tie
 * epsilon replaces it for display; with no such option the caveat stays.
 * Grading untouched; fails closed without board context.
 */
function bestNullFor(
  params: AnalyzeTurnParams,
  key: Side,
  best: RankedChoice | null,
  options: RankedChoice[],
): SideAnalysis['bestNull'] {
  const actives = params.actives;
  const defenderSpecies = actives ? (key === 'p1' ? actives.p2 : actives.p1) : null;
  if (!(best && actives && defenderSpecies)) return undefined;
  const attackerSpecies = key === 'p1' ? actives.p1 : actives.p2;
  const nullFor = (choice: string) => nullMoveReason({
    choice, gen: actives.gen, attackerSpecies, defenderSpecies,
  });
  const reason = nullFor(best.choice);
  if (!reason) return undefined;
  // The swap stays within the established rank-tie scale: a co-optimal
  // option is a fair display substitute, never a regrade.
  const alternative = options.find(option => option !== best &&
    best.ev - option.ev <= TIE_EPSILON && nullFor(option.choice) === null) ?? null;
  return {
    reason,
    alternative: alternative
      ? { label: alternative.label, ev: alternative.ev, ...(alternative.koOdds ? { koOdds: alternative.koOdds } : {}) }
      : null,
  };
}

/** Round 6 ②: a streak ending THIS turn, read from the render-time history (index t−1 = turn t, current included). */
function streakFor(params: AnalyzeTurnParams, key: Side): SideAnalysis['streakOdds'] {
  if (params.playedHistory && params.actives) {
    return detectStreakOdds(params.actives.gen, params.playedHistory[key].slice(0, params.turn)) ?? undefined;
  }
  return undefined;
}

/** The narrative signals of one side, computed in analyzeTurn's original order. */
export interface SideSignals {
  viableCount: number | undefined;
  conditional: SideAnalysis['conditional'];
  forcedMix: SideAnalysis['forcedMix'];
  hindsightRead: SideAnalysis['hindsightRead'];
  unanswered: SideAnalysis['unanswered'];
  decided: SideAnalysis['decided'];
  nearDecided: SideAnalysis['nearDecided'];
  forcedWin: SideAnalysis['forcedWin'];
  bestNull: SideAnalysis['bestNull'];
  streakOdds: SideAnalysis['streakOdds'];
}

export function signalSide(params: AnalyzeTurnParams, key: Side, g: SideGrading): SideSignals {
  const viableCount = viableCountFor(g.best, g.options);
  const view = matrixView(params, key);
  const conditional = conditionalFor(g.tier, view, g.best);
  const forcedMix = forcedMixFor(view, g.options);
  const hindsightRead = hindsightReadFor(params, key, view, g.played);
  const unanswered = unansweredFor(params, key, g.played, g.best);
  const { decided, nearDecided, forcedWin } = decidedSignals(params, key);
  const bestNull = bestNullFor(params, key, g.best, g.options);
  const streakOdds = streakFor(params, key);
  return { viableCount, conditional, forcedMix, hindsightRead, unanswered, decided, nearDecided, forcedWin, bestNull, streakOdds };
}

/** The signal half of the side record, keys in the report's order. */
export function signalFields(s: SideSignals): Partial<SideAnalysis> {
  return {
    ...(s.viableCount !== undefined ? { viableCount: s.viableCount } : {}),
    ...(s.conditional ? { conditional: s.conditional } : {}),
    ...(s.bestNull ? { bestNull: s.bestNull } : {}),
    ...(s.forcedMix ? { forcedMix: s.forcedMix } : {}),
    ...(s.streakOdds ? { streakOdds: s.streakOdds } : {}),
    ...(s.hindsightRead ? { hindsightRead: s.hindsightRead } : {}),
    ...(s.unanswered ? { unanswered: s.unanswered } : {}),
    ...(s.decided ? { decided: s.decided } : {}),
    ...(s.nearDecided ? { nearDecided: s.nearDecided } : {}),
    ...(s.forcedWin ? { forcedWin: s.forcedWin } : {}),
  };
}
