import type { RevealedPokemonInfo } from '../../types';

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
