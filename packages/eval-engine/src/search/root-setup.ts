import { unansweredMons, type MatchupCache } from '../eval-function.ts';
import { positionBattle, type ChoiceOption, type SimPosition } from '../forward-model.ts';
import { koOddsForOptions } from '../cell-blend.ts';
import { playedBoundsOf } from '../branch/action-bound.ts';
import type { EvalSettings } from '../types.ts';
import { expandPivotPairs, restrictOptions, searchOptions } from './options.ts';
import { koOddsMapsFor, type RootPayload } from './root-payload.ts';
import type { Matrix } from './matrix.ts';

/** The root search's setup: the option lists and the narrative payload of a root. */

/** The root's option lists: restricted for deep sub-searches, pivot-expanded for the root matrix. */
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
    // root matrix only: sub-searches keep the greedy pivot resolution
    p1Options = expandPivotPairs(root, 'p1', p1Options);
    p2Options = expandPivotPairs(root, 'p2', p2Options);
  }
  return { p1Options, p2Options };
}

/**
 * The root's narrative payload, computed once per search and re-attached to every partial result: the sampler's mismatch
 * diagnostics, each root option's analytic kill odds (vs the standing opposing active), and the unanswered-mon profile.
 * Sub-searches skip the odds and the profile.
 */
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
  // the order bound of the played turn's fallen bodies, on the root battle
  const playedBounds = restrictCandidates ? undefined : playedBoundsOf(battle, settings.keepPlayed?.fell);
  return { diagnostics: matrix.diagnostics, koOddsMaps, unanswered, playedBounds };
}
