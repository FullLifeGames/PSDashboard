import { Dex } from '@pkmn/sim';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

/**
 * The formes a battle-only forme comes from, as the Dex names them: one for
 * a Mega, Mimikyu-Busted or Ogerpon-Teal-Tera, two for Zygarde-Complete and
 * Necrozma-Ultra (the team decides); a Gigantamax forme changes from its
 * base. Empty for every other species.
 */
function battleOrigins(species: string): string[] {
  const entry = Dex.species.get(species);
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
export function teamSpecies(pokemonMap: Map<string, RevealedPokemonInfo>, species: string): string {
  // A "-*" preview marker learns the forme as the switch shows it (Zamazenta-Crowned).
  if (pokemonMap.has(species) || unknownFormeMarkerFor(pokemonMap, species)) return species;
  const origins = battleOrigins(species);
  if (origins.length === 0) return species;
  const num = Dex.species.get(species).num;
  return origins.find(origin => pokemonMap.has(origin)) ??
    [...pokemonMap.keys()].find(key => !key.endsWith('-*') && Dex.species.get(key).num === num) ??
    origins[0];
}

/** Species as the details line names it, level and gender; teamSpecies maps a battle forme to its card. */
export function parseDetails(details: string): { species: string; level: number; gender: string } | null {
  if (!details) return null;
  const parts = details.split(', ');
  const species = parts[0].trim();
  let level = 100;
  let gender = '';
  for (const part of parts.slice(1)) {
    if (part.startsWith('L')) {
      level = parseInt(part.slice(1), 10);
    } else if (part === 'M' || part === 'F') {
      gender = part;
    }
  }
  return { species, level, gender };
}

/**
 * Team preview hides some formes behind a "-*" marker (Urshifu-*,
 * Zamazenta-*, Greninja-*, Arceus-*): the marker entry a revealed species
 * belongs to, matched on the base species — null when the team holds none.
 */
export function unknownFormeMarkerFor(pokemonMap: Map<string, RevealedPokemonInfo>, species: string): string | null {
  const dexSpecies = Dex.species.get(species);
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

export function findPokemonByNickname(
  pokemonMap: Map<string, RevealedPokemonInfo>,
  nickname: string,
  lines: string[],
  side: string,
): RevealedPokemonInfo | undefined {
  // Look for a switch line that maps this nickname to a species
  for (const line of lines) {
    if ((line.startsWith(`|switch|${side}`) || line.startsWith(`|drag|${side}`)) &&
        line.includes(`: ${nickname}|`)) {
      const parts = line.split('|');
      const details = parts[3];
      const parsed = parseDetails(details);
      if (parsed) {
        return pokemonMap.get(teamSpecies(pokemonMap, parsed.species));
      }
    }
  }
  return undefined;
}
