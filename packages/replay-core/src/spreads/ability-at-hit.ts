/** The ability rows of a Dex (the Dex of the replay's generation). */
export interface AbilityDex {
  abilities: { get(id: string): { exists: boolean; name: string; flags?: { cantsuppress?: number } } };
}

/**
 * The ability a body fought with at the hit: the one the log showed beats `built`; one Gastro Acid or Neutralizing Gas took away is
 * none, unless the Dex marks it as unsuppressible (Stance Change, Multitype).
 */
export function abilityAtHit(dex: AbilityDex, built: string | undefined, shown: string | undefined, suppressed: boolean | undefined): string | undefined {
  const row = shown ? dex.abilities.get(shown) : undefined;
  const ability = row?.exists ? row.name : built;
  if (!suppressed) return ability;
  const current = ability ? dex.abilities.get(ability) : undefined;
  return current?.flags?.cantsuppress ? ability : dex.abilities.get('noability').name;
}
