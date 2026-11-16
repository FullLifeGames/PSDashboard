import type { Draw } from './types.ts';

/**
 * Round 89 (X1a, ruling 39): whether the body a random-target die samples can change the turn. `getRandomTarget` samples a standing
 * foe for every doubles click that names no target, spread moves included, but `getMoveTargets` (the simulator's own switch on the
 * move's Dex target) ignores the sample for these targets and takes every body they reach (a scripted move, Counter or Mirror Coat,
 * answers the body that hit it: its `onRedirectTarget` replaces the sample, and with no hit the move fails): `dice-random-target-note.spec.ts` plays
 * every Dex move with each foe forced and holds this list to what the simulator does.
 */
export const AIM_FREE_TARGETS: ReadonlySet<string> = new Set(['all', 'foeSide', 'allySide', 'allyTeam', 'allAdjacent', 'allAdjacentFoes', 'allies', 'scripted']);

/**
 * A random-target die the click cannot force says so to the user ("the seed decides it") only when its sample can change the turn: the
 * sample holds more than one body, and the move aims at one of them. A sample over one body (the other foe fell earlier in the turn)
 * has one result. A draw that is no sample reads as one that can matter.
 */
export function sampleDecides(target: string, draw: Draw | undefined): boolean {
  const bodies = draw?.call === 'sample' ? draw.items?.length : undefined;
  if (bodies !== undefined && bodies <= 1) return false;
  return !AIM_FREE_TARGETS.has(target);
}
