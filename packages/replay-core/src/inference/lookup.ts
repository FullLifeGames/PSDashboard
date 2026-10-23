import type { RulesDex } from '../rules-dex.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';
import { arg, detailsOf, identOf, type LogLine } from './log-line.ts';

/**
 * The formes a battle-only forme comes from, as the Dex names them: one for
 * a Mega, Mimikyu-Busted or Ogerpon-Teal-Tera, two for Zygarde-Complete and
 * Necrozma-Ultra (the team decides); a Gigantamax forme changes from its
 * base. Empty for every other species.
 */
function battleOrigins(dex: RulesDex, species: string): string[] {
  const entry = dex.species.get(species);
  if (entry.battleOnly) return ([] as string[]).concat(entry.battleOnly);
  return entry.forme === 'Gmax' && entry.changesFrom ? [entry.changesFrom] : [];
}

/**
 * The team entry a seen species belongs to (round 63, T101): its own name
 * when the team holds it (a preview may name Zacian-Crowned itself); else
 * the held origin of a battle-only forme (Zygarde-Complete → Zygarde-10%,
 * Necrozma-Ultra → Necrozma-Dusk-Mane), or the held entry of the same Dex
 * number (Greninja-Ash came from Greninja-Bond, the preview shows Greninja);
 * else the forme's first origin, as a Mega first seen evolved always was
 * (B16: battle-only formes never make a seventh card).
 */
export function teamSpecies(dex: RulesDex, pokemonMap: Map<string, RevealedPokemonInfo>, species: string): string {
  // A "-*" preview marker learns the forme as the switch shows it (Zamazenta-Crowned).
  if (pokemonMap.has(species) || unknownFormeMarkerFor(dex, pokemonMap, species)) return species;
  const origins = battleOrigins(dex, species);
  if (origins.length === 0) return species;
  const num = dex.species.get(species).num;
  return origins.find(origin => pokemonMap.has(origin)) ??
    [...pokemonMap.keys()].find(key => !key.endsWith('-*') && dex.species.get(key).num === num) ??
    origins[0];
}

/**
 * Team preview hides some formes behind a "-*" marker (Urshifu-*,
 * Zamazenta-*, Greninja-*, Arceus-*): the marker entry a revealed species
 * belongs to, matched on the base species — null when the team holds none.
 */
export function unknownFormeMarkerFor(dex: RulesDex, pokemonMap: Map<string, RevealedPokemonInfo>, species: string): string | null {
  const dexSpecies = dex.species.get(species);
  const base = toId(dexSpecies.exists ? dexSpecies.baseSpecies : species.split('-')[0]);
  for (const key of pokemonMap.keys()) {
    if (key.endsWith('-*') && toId(key.slice(0, -2)) === base) return key;
  }
  return null;
}

/**
 * The battle revealed the forme behind a marker: the entry keeps its
 * preview position and everything booked on it; only its identity changes.
 */
export function revealMarkerForme(
  pokemonMap: Map<string, RevealedPokemonInfo>,
  marker: string,
  revealed: { species: string; level: number; gender: string },
): void {
  const entries = [...pokemonMap];
  pokemonMap.clear();
  for (const [key, info] of entries) {
    if (key !== marker) {
      pokemonMap.set(key, info);
      continue;
    }
    info.species = revealed.species;
    info.level = revealed.level;
    if (revealed.gender) info.gender = revealed.gender;
    pokemonMap.set(revealed.species, info);
  }
}

/** The opponent Pokémon behind a nickname: the first switch or drag line of the side that names it. */
export function findPokemonByNickname(
  dex: RulesDex,
  pokemonMap: Map<string, RevealedPokemonInfo>,
  nickname: string,
  lines: readonly LogLine[],
  side: string,
): RevealedPokemonInfo | undefined {
  for (const line of lines) {
    if (line.cmd !== 'switch' && line.cmd !== 'drag' && line.cmd !== 'replace') continue;
    const ident = identOf(arg(line, 1));
    if (ident?.side !== side || ident.name !== nickname) continue;
    const parsed = detailsOf(arg(line, 2));
    if (parsed) return pokemonMap.get(teamSpecies(dex, pokemonMap, parsed.species));
  }
  return undefined;
}
