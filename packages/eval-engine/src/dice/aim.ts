import type { Draw } from './types.ts';

/**
 * The move targets for which the body a random-target die samples cannot change the turn. `getRandomTarget` samples a standing foe for
 * every doubles click that names no target, spread moves included, but `getMoveTargets` (the simulator's switch on the move's Dex
 * target) ignores the sample for these and takes every body they reach (a scripted move, Counter or Mirror Coat, answers the body that
 * hit it: its `onRedirectTarget` replaces the sample, and with no hit the move fails). test/dice-random-target-note.spec.ts holds the list.
 */
export const AIM_FREE_TARGETS: ReadonlySet<string> = new Set(['all', 'foeSide', 'allySide', 'allyTeam', 'allAdjacent', 'allAdjacentFoes', 'allies', 'scripted']);

/**
 * Whether a random-target die the click cannot force may tell the user "the seed decides it": its sample holds more than one body (a
 * sample over one body, the other foe having fallen, has one result) and the move aims at one of them. A draw that is no sample can matter.
 */
export function sampleDecides(target: string, draw: Draw | undefined): boolean {
  const bodies = draw?.call === 'sample' ? draw.items?.length : undefined;
  if (bodies !== undefined && bodies <= 1) return false;
  return !AIM_FREE_TARGETS.has(target);
}
