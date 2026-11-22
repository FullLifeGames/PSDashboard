/**
 * Round 89 (C7): the one reader of a Revival Blessing prompt. The simulator marks the user's party entry `reviving` in the request
 * (`@pkmn/sim` pokemon.js, getSwitchRequestData), so whether a request asks for a fainted body comes from the request, never from a
 * move name. The forward model (`switchInSlots`) and the branch layer (`switchInsOf`, `revivingSlots` of the forced answers) import it.
 */

/** What the reader needs of a side: its active table (one entry per slot) and the request the simulator last sent it. */
export interface RevivingSide {
  active: readonly unknown[];
  activeRequest?: unknown;
}

/** Per active slot: does the request mark that slot's party entry `reviving`? The request lists the actives first, in slot order. */
export function revivingSlots(side: RevivingSide): boolean[] {
  const party = (side.activeRequest as { side?: { pokemon?: { reviving?: boolean }[] } } | null | undefined)?.side?.pokemon;
  return side.active.map((_, slot) => !!party?.[slot]?.reviving);
}

/** Does the request ask this side for a fainted body? */
export const isReviving = (side: RevivingSide): boolean => revivingSlots(side).some(Boolean);
