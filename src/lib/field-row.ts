import type { PokemonSnapshot } from '@fulllifegames/replay-core';

/** Actives in field order, one per slot, null where a lower slot's body fainted unreplaced; no slots: party order. */
export function fieldRow(pokemon: PokemonSnapshot[]): (PokemonSnapshot | null)[] {
  const living = pokemon.filter(mon => mon.isActive && !mon.fainted).map((mon, position) => ({ mon, slot: mon.slot ?? position }));
  const row: (PokemonSnapshot | null)[] = [];
  for (const { mon, slot } of living) {
    while (row.length <= slot) row.push(null);
    row[slot] = mon;
  }
  return row;
}
