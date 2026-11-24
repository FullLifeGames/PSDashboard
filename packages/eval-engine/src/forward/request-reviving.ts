// Revival Blessing: the request marks the party entry `reviving` (pokemon.js getSwitchRequestData), not the move name.

export interface RevivingSide {
  active: readonly unknown[];
  activeRequest?: unknown;
}

/** One entry per active slot: is its party entry marked `reviving`? The request lists actives first, in slot order. */
export function revivingSlots(side: RevivingSide): boolean[] {
  const party = (side.activeRequest as { side?: { pokemon?: { reviving?: boolean }[] } } | null | undefined)?.side?.pokemon;
  return side.active.map((_, slot) => !!party?.[slot]?.reviving);
}

export const isReviving = (side: RevivingSide): boolean => revivingSlots(side).some(Boolean);
