import type { PokemonSnapshot } from '@fulllifegames/replay-core';

/**
 * The living actives in field order, one entry per slot, null where a lower slot's body fainted and nobody replaced it. The replay
 * client keeps the team in party order, so listing the actives by team position showed slot A the moves of the body in slot B.
 * A snapshot without slots keeps the party order.
 */
export function fieldRow(pokemon: PokemonSnapshot[]): (PokemonSnapshot | null)[] {
  const living = pokemon.filter(mon => mon.isActive && !mon.fainted).map((mon, position) => ({ mon, slot: mon.slot ?? position }));
  const row: (PokemonSnapshot | null)[] = [];
  for (const { mon, slot } of living) {
    while (row.length <= slot) row.push(null);
    row[slot] = mon;
  }
  return row;
}
