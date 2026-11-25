import type { Draw } from './types.ts';

// A sample cannot change these turns, read after ModifyMove; Counter and Mirror Coat answer the body that hit them.
export const AIM_FREE_TARGETS: ReadonlySet<string> = new Set(['all', 'foeSide', 'allySide', 'allyTeam', 'allAdjacent', 'allAdjacentFoes', 'allies', 'scripted', 'self']);

/** A sample over one body (the other foe fell) has one result; a draw that is no sample can matter. */
export function sampleDecides(target: string, draw: Draw | undefined): boolean {
  const bodies = draw?.call === 'sample' ? draw.items?.length : undefined;
  if (bodies !== undefined && bodies <= 1) return false;
  return !AIM_FREE_TARGETS.has(target);
}
