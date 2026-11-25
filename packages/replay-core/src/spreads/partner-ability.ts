import type { PokemonSet } from '@pkmn/sim';
import { toId } from '../ids.ts';
import { originIn, type FormeDex } from './battle-forme.ts';

/** The ability of a partner the log never showed: the Dex's single one, else the built set's; empty if neither. */
export function partnerAbility(dex: FormeDex, sets: readonly PokemonSet[], species: string): string {
  const abilities = new Set(Object.values(dex.species.get(species).abilities as Record<string, string>).map(toId));
  if (abilities.size === 1) return [...abilities][0];
  const origin = originIn(dex, sets, species) ?? species;
  const set = sets.find(entry => toId(entry.species) === toId(origin) || toId(entry.name || '') === toId(origin));
  return set?.ability ? toId(set.ability) : '';
}
