/** The ability rows of a Dex (the Dex of the replay's generation). */
export interface AbilityDex {
  abilities: { get(id: string): { exists: boolean; name: string; flags?: { cantsuppress?: number } } };
}

/**
 * The ability a body fought with at the hit (round 69, T86): the one the log showed beats the build's, and an ability Gastro Acid or
 * a Neutralizing Gas took away is none, unless the Dex marks it as one the gas cannot suppress (Stance Change, Multitype, ...).
 * `built` is what the set or the forme carries.
 */
export function abilityAtHit(dex: AbilityDex, built: string | undefined, shown: string | undefined, suppressed: boolean | undefined): string | undefined {
  const row = shown ? dex.abilities.get(shown) : undefined;
  const ability = row?.exists ? row.name : built;
  if (!suppressed) return ability;
  const current = ability ? dex.abilities.get(ability) : undefined;
  return current?.flags?.cantsuppress ? ability : dex.abilities.get('noability').name;
}
