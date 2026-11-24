import { dexOf } from '../rules-dex.ts';
import { speciesAbilityFor } from '../team/dex-legal.ts';
import { type InferrerState } from './inferrer-state.ts';

// Protocol [of] is the holder in Rough Skin's -damage, the attacker in an ability heal and in Pickpocket's -enditem.

export function mayHold(state: InferrerState, ident: string, ability: string): boolean {
  if (state.freeAbilities) return true;
  const species = state.identSpecies.get(ident);
  if (!species) return true;
  const dex = dexOf(state);
  if (!dex.species.get(species).exists) return true;
  return speciesAbilityFor(dex, species, ability) !== undefined;
}

export function abilityHolderIdent(state: InferrerState, subject: string | null, of: string | null, ability: string): string | null {
  if (state.freeAbilities) return of ?? subject;
  const candidates = [of, subject].filter((ident, index, all): ident is string => !!ident && all.indexOf(ident) === index);
  return candidates.find(ident => mayHold(state, ident, ability)) ?? null;
}
