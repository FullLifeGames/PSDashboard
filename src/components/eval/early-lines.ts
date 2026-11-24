import type { EvalResult, EvalSettings, StaticRuleset, TeraAllowance, TurnAnalysis } from '@fulllifegames/eval-engine';
import type { TurnEvalSettings } from '../../hooks/useEvaluation';
import { gradedSides } from './game-review';
import { engineChoice } from './turn-copy';

/** Extra iterations per tree for the line pass: they give a line's second turn its visits without moving a score. */

export const LINE_PASS = 300;

const searchedHere = (result: EvalResult | null | undefined, settings: TurnEvalSettings | null | undefined): result is EvalResult =>
  !!result && !result.engine && (settings?.mode === 'matrix' || settings?.mode === 'mcts');

const passed = (result: EvalResult): boolean => (result.linePass ?? 0) >= LINE_PASS;

export interface EarlyLineJob { turn: number; analysis: TurnAnalysis }

interface GameInputs {
  analyses: readonly (TurnAnalysis | null)[] | null | undefined;
  results: readonly (EvalResult | null | undefined)[];
  settings: readonly (TurnEvalSettings | null | undefined)[];
}

/** A result that carries the pass counts as searched, even with no lines; a tree turn's sweep lines do not. */
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

export function earlyLineProgress({ analyses, results, settings }: GameInputs): { done: number; total: number } {
  const pending = earlyLineJobs({ analyses, results, settings }).length;
  const total = new Set(gradedSides(analyses)
    .filter(({ analysis }) => searchedHere(results[analysis.turn - 1], settings[analysis.turn - 1]))
    .map(({ analysis }) => analysis.turn)).size;
  return { done: total - pending, total };
}

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
    lineReplies: asked(side => rows(side === 'p1' ? 'p2' : 'p1')),
  };
}
