import { unansweredMons, type MatchupCache } from '../eval-function.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { koOddsForOptions } from '../cell-blend.ts';
import { playedBoundsOf } from '../branch/action-bound.ts';
import type { EvalSettings } from '../types.ts';
import { expandPivotPairs, restrictOptions, searchOptions } from './options.ts';
import { koOddsMapsFor, type RootPayload } from './root-payload.ts';
import type { Matrix } from './matrix.ts';

export function rootOptions(
  root: SimPosition,
  settings: EvalSettings,
  restrictCandidates: boolean,
): { p1Options: ChoiceOption[]; p2Options: ChoiceOption[] } {
  const tera = settings.tera ?? true;
  let p1Options = searchOptions(root, 'p1', { tera, keep: settings.keepPlayed?.p1Slots, sleepClause: settings.sleepClause });
  let p2Options = searchOptions(root, 'p2', { tera, keep: settings.keepPlayed?.p2Slots, sleepClause: settings.sleepClause });
  if (restrictCandidates) {
    p1Options = restrictOptions(root, 'p1', p1Options);
    p2Options = restrictOptions(root, 'p2', p2Options);
  } else {
    p1Options = expandPivotPairs(root, 'p1', p1Options);
    p2Options = expandPivotPairs(root, 'p2', p2Options);
  }
  return { p1Options, p2Options };
}

/** The root's narrative payload, computed once per search and re-attached to every partial result. */
export function rootPayload(
  battle: ReturnType<typeof positionBattle>,
  matrix: Matrix,
  p1Options: ChoiceOption[],
  p2Options: ChoiceOption[],
  matchupCache: MatchupCache,
  restrictCandidates: boolean,
  settings: EvalSettings,
): RootPayload {
  const koOddsMaps = restrictCandidates ? null : koOddsMapsFor(p1Options, p2Options, {
    p1: koOddsForOptions(battle, 'p1', p1Options.map(option => option.choice)),
    p2: koOddsForOptions(battle, 'p2', p2Options.map(option => option.choice)),
  });
  const unanswered = restrictCandidates ? null : unansweredMons(battle, matchupCache);
  const playedBounds = restrictCandidates ? undefined : playedBoundsOf(battle, settings.keepPlayed?.fell);
  return { diagnostics: matrix.diagnostics, koOddsMaps, unanswered, playedBounds };
}
