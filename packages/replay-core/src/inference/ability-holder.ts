import { Dex } from '@pkmn/sim';
import { speciesAbilityFor } from '../team/dex-legal.ts';
import type { InferrerState } from './inferrer-state.ts';

/**
 * Who owns an ability a protocol line names (round 60, T104). The sim
 * writes [of] differently per line: Rough Skin's -damage names the victim and
 * [of] the holder (battle.js:1944); an ability heal names the holder and [of]
 * the attacker (battle.js:2103); Pickpocket's -enditem names only the
 * attacker (abilities.js:3390). Outside custom games the dex decides: a
 * Pokémon whose species cannot have the ability never gets it; of two that
 * can, [of] wins as before; an unknown species can.
 */

/** Whether the Pokémon behind an ident may hold the ability as its own. */
export function mayHold(state: InferrerState, ident: string, ability: string): boolean {
  if (state.custom) return true;
  const species = state.identSpecies.get(ident);
  if (!species) return true;
  const dex = Dex.forGen(state.gen);
  if (!dex.species.get(species).exists) return true;
  return speciesAbilityFor(dex, species, ability) !== undefined;
}

/** The ident that owns the line's ability: [of] before the subject, never one the dex rules out. */
export function abilityHolderIdent(state: InferrerState, subject: string | null, of: string | null, ability: string): string | null {
  if (state.custom) return of ?? subject;
  const candidates = [of, subject].filter((ident, index, all): ident is string => !!ident && all.indexOf(ident) === index);
  return candidates.find(ident => mayHold(state, ident, ability)) ?? null;
}
