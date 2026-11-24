import type { RulesDex } from '../rules-dex.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';
import { arg, detailsOf, identOf, type LogLine } from './log-line.ts';

// One origin for a Mega, Mimikyu-Busted or Ogerpon-Teal-Tera; two for Zygarde-Complete and Necrozma-Ultra (the team
// decides); a Gigantamax forme changes from its base; none for every other species.
function battleOrigins(dex: RulesDex, species: string): string[] {
  const entry = dex.species.get(species);
  if (entry.battleOnly) return ([] as string[]).concat(entry.battleOnly);
  return entry.forme === 'Gmax' && entry.changesFrom ? [entry.changesFrom] : [];
}

/** The team entry a seen species belongs to, so a battle-only forme never makes a seventh card (Zygarde-Complete). */
export function teamSpecies(dex: RulesDex, pokemonMap: Map<string, RevealedPokemonInfo>, species: string): string {
  if (pokemonMap.has(species) || unknownFormeMarkerFor(dex, pokemonMap, species)) return species;
  const origins = battleOrigins(dex, species);
  if (origins.length === 0) return species;
  const num = dex.species.get(species).num;
  return origins.find(origin => pokemonMap.has(origin)) ??
    [...pokemonMap.keys()].find(key => !key.endsWith('-*') && dex.species.get(key).num === num) ??
    origins[0];
}

/** The "-*" marker entry (Urshifu-*, Arceus-*) a revealed species belongs to, by base species; null when none. */
export function unknownFormeMarkerFor(dex: RulesDex, pokemonMap: Map<string, RevealedPokemonInfo>, species: string): string | null {
  const dexSpecies = dex.species.get(species);
  const base = toId(dexSpecies.exists ? dexSpecies.baseSpecies : species.split('-')[0]);
  for (const key of pokemonMap.keys()) {
    if (key.endsWith('-*') && toId(key.slice(0, -2)) === base) return key;
  }
  return null;
}

/** The entry keeps its preview position and everything booked on it; only its identity becomes the revealed forme. */
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
