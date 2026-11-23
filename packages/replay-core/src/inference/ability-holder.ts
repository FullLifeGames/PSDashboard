import { dexOf } from '../rules-dex.ts';
import { speciesAbilityFor } from '../team/dex-legal.ts';
import { type InferrerState } from './inferrer-state.ts';

/** Who owns an ability a protocol line names: the simulator writes [of] per line (Rough Skin's -damage names the victim and [of] the holder, an ability heal the holder and [of] the attacker, Pickpocket's -enditem only the attacker), so outside free-ability formats the Dex decides. */

/** Whether the Pokémon behind an ident may hold the ability as its own. */
export function mayHold(state: InferrerState, ident: string, ability: string): boolean {
  if (state.freeAbilities) return true;
  const species = state.identSpecies.get(ident);
  if (!species) return true;
  const dex = dexOf(state);
  if (!dex.species.get(species).exists) return true;
  return speciesAbilityFor(dex, species, ability) !== undefined;
}

/** The ident that owns the line's ability: [of] before the subject, never one the dex rules out. */
export function abilityHolderIdent(state: InferrerState, subject: string | null, of: string | null, ability: string): string | null {
  if (state.freeAbilities) return of ?? subject;
  const candidates = [of, subject].filter((ident, index, all): ident is string => !!ident && all.indexOf(ident) === index);
  return candidates.find(ident => mayHold(state, ident, ability)) ?? null;
}
