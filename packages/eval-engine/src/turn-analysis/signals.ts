import type { EntryUnanswered, EvalMatrix, MatrixCell, RankedChoice } from '../types.ts';
import { nullMoveReason } from '../null-moves.ts';
import { detectStreakOdds } from '../streaks.ts';
import { TIE_EPSILON } from '../rank.ts';
import { LIKELIEST_CLICK_MIN, PREDICTIVE_READ_CONFIDENCE, modelOpponent, type OpponentModel } from '../opponent-model.ts';
import {
  CONDITIONAL_MIX_MIN, FORCED_MIX_THRESHOLD, TIER_THRESHOLDS, unansweredSeenKey,
  type AnalyzeTurnParams, type Side, type SideAnalysis, type VerdictTier,
} from './types.ts';
import { decidedSignals } from './decided-signals.ts';
import { opponentColumn, ownCell } from './clicked-cell.ts';
import { hindsightLine } from '../prose/phrases.ts';
import { cellSolid } from './cell-solid.ts';
import type { SideGrading } from './grading.ts';

// Narrative signals fail closed and never touch the grading.

const viableCountFor = (best: RankedChoice | null, options: RankedChoice[]): number | undefined =>
  best === null ? undefined :
    options.filter(option => best.ev - option.ev <= TIER_THRESHOLDS.inaccuracy).length;

interface MatrixView {
  matrix: EvalMatrix | undefined;
  sideChoices: string[] | undefined;
  sideLabels: string[] | undefined;
  oppLabels: string[] | undefined;
  mix: number[] | undefined;
  ownValue: (grid: EvalMatrix, i: number, j: number) => number;
  /** Index of the mix's heaviest choice; -1 without a mix. */
  mixTop: number;
}

function matrixView(params: AnalyzeTurnParams, key: Side): MatrixView {
  const matrix = params.result.matrix;
  const pick = <T>(p1: T, p2: T): T => (key === 'p1' ? p1 : p2);
  const sideChoices = pick(matrix?.p1Choices, matrix?.p2Choices);
  const sideLabels = pick(matrix?.p1Labels, matrix?.p2Labels);
  const oppLabels = pick(matrix?.p2Labels, matrix?.p1Labels);
  const mix = pick(matrix?.mixes.p1, matrix?.mixes.p2);
  const ownValue = (grid: EvalMatrix, i: number, j: number): number => ownCell(grid, key, i, j);
  const mixTop = mix && mix.length > 0
    ? mix.reduce((top, weight, index) => (weight > mix[top] ? index : top), 0)
    : -1;
  return { matrix, sideChoices, sideLabels, oppLabels, mix, ownValue, mixTop };
}

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

// The equilibrium leans a different choice than the argmax-EV pick: it renders conditionally. Tiered turns only.
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

function forcedMixFor(view: MatrixView, options: RankedChoice[]): SideAnalysis['forcedMix'] {
  const { matrix, sideChoices, sideLabels, mix, mixTop } = view;
  if (matrix && sideChoices && sideLabels && mix && options.length > 1 && mixTop >= 0 &&
    mix[mixTop] >= FORCED_MIX_THRESHOLD && sideChoices[mixTop]?.startsWith('switch')) {
    return { label: sideLabels[mixTop], weight: mix[mixTop] };
  }
  return undefined;
}

/** A hindsight read shows only when its gain lies a band past the equilibrium regret and its cells are no guess. */
export const HINDSIGHT_BAND = TIER_THRESHOLDS.inaccuracy;

// The side row needs the solid cells and the band past the regret; the card sentences need the solid cells alone.
function hindsightShown(
  read: { response: string; against: string; gain: number },
  cells: (Pick<MatrixCell, 'visits' | 'verified' | 'plan'> | undefined)[],
  regret: number | null,
): { shown: true; line: string } | { thin: true } | Record<string, never> {
  if (!cells.every(cellSolid)) return { thin: true };
  return read.gain >= (regret ?? 0) + HINDSIGHT_BAND ? { shown: true, line: hindsightLine(read) } : {};
}

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

function likeliestClick(params: AnalyzeTurnParams, key: Side, matrix: EvalMatrix, column: number): { likeliest?: number } {
  const model = opponentModelFor(params, key, matrix);
  return model && favouriteOf(model) === column && model.confidence >= LIKELIEST_CLICK_MIN
    ? { likeliest: model.confidence }
    : {};
}

function hindsightReadFor(
  params: AnalyzeTurnParams,
  key: Side,
  view: MatrixView,
  played: RankedChoice | null,
  regret: number | null,
): SideAnalysis['hindsightRead'] {
  const { matrix, sideChoices, sideLabels } = view;
  if (!(matrix && sideChoices && sideLabels && played)) return undefined;
  const { column, oppPlayed } = opponentColumn(params, key, matrix);
  const row = sideChoices.indexOf(played.choice);
  if (!(column >= 0 && row >= 0)) return undefined;
  const { bestRow, bestValue } = bestRowAgainst(view, matrix, sideChoices.length, column);
  const playedValue = view.ownValue(matrix, row, column);
  const gain = bestValue - playedValue;
  if (bestRow >= 0 && bestRow !== row && gain >= TIER_THRESHOLDS.mistake) {
    const read = { response: sideLabels[bestRow], against: oppPlayed!.label, gain, playedValue };
    // The cells of the best row and of the played row against the click (cells[p1 row][p2 column]).
    const cellAt = (own: number) => matrix.cells?.[key === 'p1' ? own : column]?.[key === 'p1' ? column : own];
    return { ...read, ...likeliestClick(params, key, matrix, column), ...hindsightShown(read, [cellAt(bestRow), cellAt(row)], regret) };
  }
  return undefined;
}

function opponentModelFor(params: AnalyzeTurnParams, key: Side, matrix: EvalMatrix): OpponentModel | null {
  if (!params.tendencies || matrix.p1Labels.length < 2 || matrix.p2Labels.length < 2) return null;
  return modelOpponent(matrix, key, params.tendencies[key === 'p1' ? 'p2' : 'p1']);
}

const favouriteOf = (model: OpponentModel): number => model.probs.indexOf(model.confidence);

// Needs no played actions; fails closed without tendencies or machine choice ids.
function predictiveReadFor(
  params: AnalyzeTurnParams,
  key: Side,
  view: MatrixView,
  best: RankedChoice | null,
  bestNull: SideAnalysis['bestNull'],
): SideAnalysis['predictiveRead'] {
  const { matrix, sideChoices, sideLabels, oppLabels } = view;
  if (!(matrix && sideChoices && sideLabels && oppLabels && best)) return undefined;
  const model = opponentModelFor(params, key, matrix);
  if (!model || model.confidence < PREDICTIVE_READ_CONFIDENCE) return undefined;
  const shownRow = bestNull?.alternative ? sideLabels.indexOf(bestNull.alternative.label) : sideChoices.indexOf(best.choice);
  if (shownRow < 0) return undefined;
  const column = favouriteOf(model);
  const { bestRow, bestValue } = bestRowAgainst(view, matrix, sideChoices.length, column);
  const gain = bestValue - view.ownValue(matrix, shownRow, column);
  if (bestRow < 0 || bestRow === shownRow || gain < TIER_THRESHOLDS.mistake) return undefined;
  return { expect: oppLabels[column], confidence: model.confidence, response: sideLabels[bestRow], gain, over: sideLabels[shownRow] };
}

const entryTarget = (label: string | undefined): string | null =>
  label?.match(/→ (.+)$/)?.[1] ?? null;

function sideUnanswered(
  params: AnalyzeTurnParams,
  key: Side,
): { ownUnanswered: string[] | undefined; ownEntry: EntryUnanswered[] | undefined } {
  const ownUnanswered = params.result.unanswered?.[key];
  const ownEntry = key === 'p1' ? params.result.unanswered?.p1Entry : params.result.unanswered?.p2Entry;
  return { ownUnanswered, ownEntry };
}

const entrySignal = (target: string, ownUnanswered: string[] | undefined, ownEntry: EntryUnanswered[] | undefined) =>
  ownUnanswered?.includes(target)
    ? { species: target }
    : ownEntry?.find(row => row.species === target);

// The played or recommended line brings in a mon from the root's unanswered profile (no live enemy wins the race pair):
// entry is profit. A stage the game report has already spoken (unansweredSeen) stays silent.
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

// A mechanically null best (Will-O-Wisp into a Fire-type) is replaced for display by a co-optimal option within the
// rank-tie epsilon. Grading untouched; fails closed without board context.
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
  const defenderTera = key === 'p1' ? actives.p2Tera : actives.p1Tera;
  const attackerTera = key === 'p1' ? actives.p1Tera : actives.p2Tera;
  const nullFor = (choice: string) => nullMoveReason({
    choice, gen: actives.gen, mod: actives.mod, attackerSpecies, defenderSpecies, defenderTera, attackerTera,
  });
  const reason = nullFor(best.choice);
  if (!reason) return undefined;
  const alternative = options.find(option => option !== best &&
    best.ev - option.ev <= TIE_EPSILON && nullFor(option.choice) === null) ?? null;
  return {
    reason,
    alternative: alternative
      ? { label: alternative.label, ev: alternative.ev, ...(alternative.koOdds ? { koOdds: alternative.koOdds } : {}) }
      : null,
  };
}

// The render-time history is indexed t-1 = turn t, the current turn included.
function streakFor(params: AnalyzeTurnParams, key: Side): SideAnalysis['streakOdds'] {
  if (params.playedHistory && params.actives) {
    return detectStreakOdds(params.actives.gen, params.playedHistory[key].slice(0, params.turn), params.actives.mod) ?? undefined;
  }
  return undefined;
}

export interface SideSignals {
  viableCount: number | undefined;
  conditional: SideAnalysis['conditional'];
  forcedMix: SideAnalysis['forcedMix'];
  hindsightRead: SideAnalysis['hindsightRead'];
  predictiveRead: SideAnalysis['predictiveRead'];
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
  const hindsightRead = hindsightReadFor(params, key, view, g.played, g.regret);
  const unanswered = unansweredFor(params, key, g.played, g.best);
  const { decided, nearDecided, forcedWin } = decidedSignals(params, key);
  const bestNull = bestNullFor(params, key, g.best, g.options);
  const predictiveRead = predictiveReadFor(params, key, view, g.best, bestNull);
  const streakOdds = streakFor(params, key);
  return { viableCount, conditional, forcedMix, hindsightRead, predictiveRead, unanswered, decided, nearDecided, forcedWin, bestNull, streakOdds };
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
    ...(s.predictiveRead ? { predictiveRead: s.predictiveRead } : {}),
    ...(s.unanswered ? { unanswered: s.unanswered } : {}),
    ...(s.decided ? { decided: s.decided } : {}),
    ...(s.nearDecided ? { nearDecided: s.nearDecided } : {}),
    ...(s.forcedWin ? { forcedWin: s.forcedWin } : {}),
  };
}
