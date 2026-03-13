import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types';

/**
 * Extracts revealed information about the opponent's team from the replay log.
 * Parses |poke|, |switch|, |move|, |-ability|, |-item|, |-terastallize| lines for p2.
 */
export function inferOpponentTeam(log: string, opponentSide: 'p1' | 'p2' = 'p2'): OpponentTeamInfo {
  const lines = log.split('\n');
  const pokemonMap = new Map<string, RevealedPokemonInfo>();

  for (const line of lines) {
    // Team preview: |poke|p2|Species, L50, M|item
    if (line.startsWith(`|poke|${opponentSide}|`)) {
      const parts = line.split('|');
      const details = parts[3];
      const hasItem = parts[4] === 'item';
      const parsed = parseDetails(details);
      if (parsed && !pokemonMap.has(parsed.species)) {
        pokemonMap.set(parsed.species, {
          species: parsed.species,
          moves: [],
          ability: '',
          item: hasItem ? '(has item)' : '',
          teraType: '',
          level: parsed.level,
          gender: parsed.gender,
        });
      }
    }

    // Switch: |switch|p2a: Nickname|Species, L50, M|100/100
    if (line.startsWith(`|switch|${opponentSide}`) || line.startsWith(`|drag|${opponentSide}`)) {
      const parts = line.split('|');
      const details = parts[3];
      const parsed = parseDetails(details);
      if (parsed && !pokemonMap.has(parsed.species)) {
        pokemonMap.set(parsed.species, {
          species: parsed.species,
          moves: [],
          ability: '',
          item: '',
          teraType: '',
          level: parsed.level,
          gender: parsed.gender,
        });
      }
    }

    // Move: |move|p2a: Nickname|Move Name|target
    if (line.startsWith(`|move|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const moveName = parts[3];

      // Find which pokemon this is by looking at current active
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && !pokemon.moves.includes(moveName)) {
        pokemon.moves.push(moveName);
      }
    }

    // Ability: |-ability|p2a: Nickname|Ability Name
    if (line.startsWith(`|-ability|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const abilityName = parts[3];
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && !pokemon.ability) {
        pokemon.ability = abilityName;
      }
    }

    // Item: |-item|p2a: Nickname|Item Name
    if (line.startsWith(`|-item|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const itemName = parts[3];
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon) {
        pokemon.item = itemName;
      }
    }

    // End item (consumed): |-enditem|p2a: Nickname|Item Name
    if (line.startsWith(`|-enditem|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const itemName = parts[3];
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && !pokemon.item) {
        pokemon.item = `${itemName} (consumed)`;
      }
    }

    // Terastallize: |-terastallize|p2a: Nickname|Type
    if (line.startsWith(`|-terastallize|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const teraType = parts[3];
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon) {
        pokemon.teraType = teraType;
      }
    }
  }

  return { pokemon: Array.from(pokemonMap.values()) };
}

function parseDetails(details: string): { species: string; level: number; gender: string } | null {
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

function findPokemonByNickname(
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
