import { Dex } from '@pkmn/sim';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

// Battle-only formes must merge into the base species instead of creating a
// seventh team card (B16). Longer suffixes first ('-Mega-X' before '-Mega').
const BATTLE_ONLY_FORME_SUFFIXES = [
  '-Terastal', '-Stellar', '-Tera',
  '-Mega-X', '-Mega-Y', '-Mega',
  '-Primal', '-Ultra', '-Gmax',
];

function normalizeBattleOnlyForme(species: string): string {
  for (const suffix of BATTLE_ONLY_FORME_SUFFIXES) {
    if (species.endsWith(suffix)) return species.slice(0, -suffix.length);
  }
  return species;
}

export function parseDetails(details: string): { species: string; level: number; gender: string } | null {
  if (!details) return null;
  const parts = details.split(', ');
  const species = normalizeBattleOnlyForme(parts[0].trim());
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
        return pokemonMap.get(parsed.species);
      }
    }
  }
  return undefined;
}
