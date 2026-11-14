import type { EvalResult, EvalSettings, StaticRuleset, TeraAllowance, TurnAnalysis } from '@fulllifegames/eval-engine';
import type { TurnEvalSettings } from '../../hooks/useEvaluation';
import { gradedSides } from './game-review';
import { engineChoice } from './turn-copy';

/**
 * Round 89 (#104), step G13 (ruling G2b, kept by G7a): the early singles turns run the depth-1 matrix, which keeps no lines, so a
 * graded one had none in the Game review. After the game report the app searches each graded matrix turn once more with the trees and
 * keeps only the lines. Step G14b (ruling G9a, option L): the same stage covers every graded turn of a game in Auto, singles and doubles,
 * tree turns included, and asks each search for the line pass (`LINE_PASS` extra iterations per tree, aimed at the rows the card shows),
 * which gives the second turn of a line the visits it needs without moving a score. A turn is done when its result carries the pass
 * (`linePass`). This module decides which turns those are and what the search is told; the hook (`useEarlyLines`) runs it.
 */

/** The extra iterations per tree the stage asks for (the user's quota, ruling G9a). */
export const LINE_PASS = 300;

/** A turn the app evaluated itself with the matrix or the tree; a result another engine wrote keeps its own sentence. */
const searchedHere = (result: EvalResult | null | undefined, settings: TurnEvalSettings | null | undefined): result is EvalResult =>
  !!result && !result.engine && (settings?.mode === 'matrix' || settings?.mode === 'mcts');

/** A result whose lines had the pass (a pass of an older, smaller quota does not count). */
const passed = (result: EvalResult): boolean => (result.linePass ?? 0) >= LINE_PASS;

export interface EarlyLineJob { turn: number; analysis: TurnAnalysis }

interface GameInputs {
  /** The report's own per-turn analyses (`gameAnalyses`): the graded rule is the review's and the marks'. */
  analyses: readonly (TurnAnalysis | null)[] | null | undefined;
  results: readonly (EvalResult | null | undefined)[];
  settings: readonly (TurnEvalSettings | null | undefined)[];
}

/**
 * The graded turns whose lines have not had the pass yet, in turn order, one job per turn (a turn graded on both sides is one search).
 * A result that carries the pass counts as searched, even with an empty list of lines (a search that kept none); lines the sweep made
 * on a tree turn do not (the pass adds the visits that give them a second turn); a result another engine wrote keeps its own sentence.
 */
export function earlyLineJobs({ analyses, results, settings }: GameInputs): EarlyLineJob[] {
  const found = new Map<number, EarlyLineJob>();
  for (const { analysis } of gradedSides(analyses)) {
    const { turn } = analysis;
    const result = results[turn - 1];
    if (!searchedHere(result, settings[turn - 1]) || passed(result)) continue;
    found.set(turn, { turn, analysis });
  }
  return [...found.values()].sort((a, b) => a.turn - b.turn);
}

/** How many of the graded turns have had the pass: the review's progress line ("2 of 6"). */
export function earlyLineProgress({ analyses, results, settings }: GameInputs): { done: number; total: number } {
  const pending = earlyLineJobs({ analyses, results, settings }).length;
  const total = new Set(gradedSides(analyses)
    .filter(({ analysis }) => searchedHere(results[analysis.turn - 1], settings[analysis.turn - 1]))
    .map(({ analysis }) => analysis.turn)).size;
  return { done: total - pending, total };
}

/**
 * The tree search of one turn: depth 1, the line pass asked for, the played pair kept (the host passes `keepPlayed` the way the sweep does), the rows whose lines the card shows named by the card (its engine choice
 * per side, `lineRows`) and the answer its ranking puts first named as the one the lines meet (`lineReplies`). The prover stays on:
 * the search hands its lines out after it. The host keeps `lines` and drops everything else of the result.
 */
export function earlyLineSettings(
  job: EarlyLineJob,
  context: { tera: TeraAllowance; sleepClause?: boolean; ruleset: StaticRuleset; keepPlayed?: EvalSettings['keepPlayed'] },
): EvalSettings & { ruleset: StaticRuleset } {
  const { analysis } = job;
  const label = (side: 'p1' | 'p2') => engineChoice(analysis[side])?.label;
  const rows = (side: 'p1' | 'p2') => { const named = label(side); return named === undefined ? undefined : [named]; };
  const asked = (pick: (side: 'p1' | 'p2') => string[] | undefined): { p1?: string[]; p2?: string[] } => {
    const out: { p1?: string[]; p2?: string[] } = {};
    const p1 = pick('p1');
    const p2 = pick('p2');
    if (p1) out.p1 = p1;
    if (p2) out.p2 = p2;
    return out;
  };
  return {
    depth: 1, samples: 1, mode: 'mcts', linePass: LINE_PASS, tera: context.tera, sleepClause: context.sleepClause, ruleset: context.ruleset,
    ...(context.keepPlayed ? { keepPlayed: context.keepPlayed } : {}),
    lineRows: asked(rows),
    // player 1's lines meet the answer the card ranks first for player 2, and the other way round
    lineReplies: asked(side => rows(side === 'p1' ? 'p2' : 'p1')),
  };
}
