import { Dex } from '@pkmn/sim';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types';
import { guessedField, revealedField, unknownEvs, unknownField } from './team-info';

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

function toId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "SitrusBerry" / "HighHorsepower" (packed names) → "Sitrus Berry" / "High Horsepower". */
function splitPackedName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

interface SheetPokemon {
  species: string;
  item: string;
  ability: string;
  moves: string[];
  teraType: string;
  level: number;
  gender: string;
}

/**
 * Parses `|showteam|` protocol lines (Open Team Sheets) without pulling in
 * @pkmn/sim — this module is loaded on every replay load, the sim only when
 * branching. Packed entry layout:
 * NICKNAME|SPECIES|ITEM|ABILITY|MOVES|NATURE|EVS|GENDER|IVS|SHINY|LEVEL|MISC
 * where MISC = HAPPINESS,HPTYPE,POKEBALL,GMAX,DMAXLEVEL,TERATYPE.
 */
export function parseShowteamSheet(log: string, side: 'p1' | 'p2'): SheetPokemon[] | null {
  const prefix = `|showteam|${side}|`;
  const line = log.split('\n')
    .map(rawLine => rawLine.replace(/\r$/, ''))
    .find(candidate => candidate.startsWith(prefix));
  if (!line) return null;

  const entries = line.slice(prefix.length).split(']');
  const pokemon: SheetPokemon[] = [];

  for (const entry of entries) {
    const fields = entry.split('|');
    const nickname = fields[0]?.trim() ?? '';
    const species = (fields[1]?.trim() || nickname);
    if (!species) continue;
    const misc = (fields[11] ?? '').split(',');

    pokemon.push({
      species: splitPackedName(species),
      item: splitPackedName(fields[2] ?? ''),
      ability: splitPackedName(fields[3] ?? ''),
      moves: (fields[4] ?? '')
        .split(',')
        .map(move => splitPackedName(move))
        .filter(Boolean),
      teraType: misc[5]?.trim() ?? '',
      level: parseInt(fields[10] ?? '', 10) || 100,
      gender: fields[7] === 'M' || fields[7] === 'F' ? fields[7] : '',
    });
  }

  return pokemon.length > 0 ? pokemon : null;
}

/**
 * Applies an Open Team Sheet (`|showteam|`) onto protocol-revealed data: team
 * sheets are public information, so moves/items/abilities from them count as
 * revealed instead of being replaced by Smogon guesses (B3).
 */
function applyTeamSheet(pokemonMap: Map<string, RevealedPokemonInfo>, sheet: SheetPokemon[]) {
  const byId = new Map<string, RevealedPokemonInfo>();
  for (const [species, info] of pokemonMap) {
    byId.set(toId(species), info);
    byId.set(toId(species.split('-')[0]), info);
  }

  for (const sheetMon of sheet) {
    const info = byId.get(toId(sheetMon.species)) ?? byId.get(toId(sheetMon.species.split('-')[0]));
    if (!info) {
      pokemonMap.set(sheetMon.species, {
        species: sheetMon.species,
        moves: sheetMon.moves.map(name => ({ name, source: 'revealed' as const })),
        ability: sheetMon.ability ? revealedField(sheetMon.ability) : unknownField(),
        item: sheetMon.item ? revealedField(sheetMon.item) : unknownField(),
        teraType: sheetMon.teraType ? revealedField(sheetMon.teraType) : unknownField(),
        evs: unknownEvs(),
        level: sheetMon.level,
        gender: sheetMon.gender,
      });
      continue;
    }

    const knownMoveIds = new Set(info.moves.map(move => toId(move.name)));
    for (const move of sheetMon.moves) {
      if (knownMoveIds.has(toId(move))) continue;
      info.moves.push({ name: move, source: 'revealed' });
    }
    if (sheetMon.ability) info.ability = revealedField(sheetMon.ability);
    if (sheetMon.item) info.item = revealedField(sheetMon.item);
    if (sheetMon.teraType && !info.teraType.value) info.teraType = revealedField(sheetMon.teraType);
  }
}

/** Items whose `[from] item:` damage hits the attacker instead of the holder. */
const ATTACKER_PUNISH_ITEMS = new Set(['rockyhelmet', 'jabocaberry', 'rowapberry']);

/**
 * Extracts revealed information about the opponent's team from the replay log.
 * Parses |poke|, |switch|, |move|, |-ability|, |-item|, |-terastallize| lines for p2.
 */
export function inferOpponentTeam(log: string, opponentSide: 'p1' | 'p2' = 'p2'): OpponentTeamInfo {
  const lines = log.split('\n');
  const pokemonMap = new Map<string, RevealedPokemonInfo>();
  // Each ident's latest move + target — resolves Rocky Helmet reveals in
  // video-reconstructed logs that drop the [of] attribution, and attributes
  // landed moves for the Levitate rule-out.
  const lastMove = new Map<string, { target: string; move: string }>();
  // Latest attack aimed AT an ident: `|-damage|` lines carry the victim, so
  // rule-outs need the reverse index.
  const lastMoveAt = new Map<string, string>();

  const ruleOut = (nickname: string, kind: 'abilities' | 'items', id: string) => {
    const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
    if (!pokemon) return;
    const ruledOut = (pokemon.ruledOut ??= { abilities: [], items: [] });
    if (!ruledOut[kind].includes(id)) ruledOut[kind].push(id);
  };

  for (const line of lines) {
    if (line.startsWith('|move|')) {
      const parts = line.split('|');
      if (parts[2] && parts[4] && /^p[12][a-d]?:/.test(parts[4])) {
        lastMove.set(parts[2], { target: parts[4], move: parts[3] ?? '' });
        lastMoveAt.set(parts[4], parts[3] ?? '');
      }
    }

    // Disproving evidence: a Pokémon that TAKES hazard/status/weather/recoil
    // damage cannot be Magic Guard; rocks chip rules out Heavy-Duty Boots; a
    // landed Ground move rules out Levitate (T25 — Clefable was simmed with
    // Magic Guard while visibly taking Stealth Rock damage).
    if (line.startsWith(`|-damage|${opponentSide}`)) {
      const nickname = line.split('|')[2]?.split(': ')[1]?.trim();
      if (nickname) {
        if (/\[from\] (Stealth Rock|Spikes)\b/.test(line)) {
          ruleOut(nickname, 'abilities', 'magicguard');
          ruleOut(nickname, 'items', 'heavydutyboots');
        } else if (/\[from\] (psn|tox|brn|Sandstorm|Hail)\b/.test(line) || line.includes('[from] item: Life Orb')) {
          ruleOut(nickname, 'abilities', 'magicguard');
        } else if (!line.includes('[from]')) {
          const ident = line.split('|')[2];
          const incoming = ident ? lastMoveAt.get(ident) : undefined;
          if (incoming && Dex.moves.get(incoming).type === 'Ground') {
            ruleOut(nickname, 'abilities', 'levitate');
          }
        }
      }
    }
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
          ability: unknownField(),
          item: hasItem ? revealedField('(has item)') : unknownField(),
          teraType: unknownField(),
          evs: unknownEvs(),
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
          ability: unknownField(),
          item: unknownField(),
          teraType: unknownField(),
          evs: unknownEvs(),
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
      if (pokemon && !pokemon.moves.some(move => move.name === moveName)) {
        pokemon.moves.push({ name: moveName, source: 'revealed' });
      }
    }

    // Ability: |-ability|p2a: Nickname|Ability Name
    if (line.startsWith(`|-ability|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const abilityName = parts[3];
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && !pokemon.ability.value) {
        pokemon.ability = revealedField(abilityName);
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
        pokemon.item = revealedField(itemName);
      }
    }

    // End item (consumed): |-enditem|p2a: Nickname|Item Name
    if (line.startsWith(`|-enditem|${opponentSide}`)) {
      const parts = line.split('|');
      const identParts = parts[2].split(': ');
      const nickname = identParts[1];
      const itemName = parts[3];
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && !pokemon.item.value) {
        pokemon.item = revealedField(`${itemName} (consumed)`);
      }
    }

    // Heal messages reveal held items: |-heal|p2a: Nick|50/100|[from] item: Leftovers (G19)
    if (line.startsWith(`|-heal|${opponentSide}`) && line.includes('[from] item:')) {
      const parts = line.split('|');
      const nickname = parts[2].split(': ')[1];
      const itemName = line.match(/\[from\] item:\s*([^|\n]+)/)?.[1]?.trim();
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && itemName && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
        pokemon.item = revealedField(itemName);
      }
    }

    // Item damage reveals the holder: Life Orb/Black Sludge recoil hurts the
    // holder itself, but Rocky Helmet hurts the ATTACKER — its holder is the
    // [of] Pokémon, or in video-reconstructed logs that drop [of], the target
    // of the damaged Pokémon's own move.
    if (line.startsWith('|-damage|') && line.includes('[from] item:')) {
      const damagedIdent = line.split('|')[2] ?? '';
      const itemName = line.match(/\[from\] item:\s*([^|\n[]+)/)?.[1]?.trim();
      const ofIdent = line.match(/\[of\]\s*(p[12][a-d]?):\s*([^|\n]+)/);
      let owner: string | null = damagedIdent;
      if (ofIdent) {
        owner = `${ofIdent[1]}: ${ofIdent[2].trim()}`;
      } else if (itemName && ATTACKER_PUNISH_ITEMS.has(toId(itemName))) {
        owner = lastMove.get(damagedIdent)?.target ?? null;
      }
      const ownerMatch = owner?.match(/^(p[12])[a-d]?:\s*(.+)$/);
      if (itemName && ownerMatch && ownerMatch[1] === opponentSide) {
        const pokemon = findPokemonByNickname(pokemonMap, ownerMatch[2].trim(), lines, opponentSide);
        if (pokemon && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
          pokemon.item = revealedField(itemName);
        }
      }
    }

    // Mega evolution reveals the stone: |-mega|p2a: Nick|Lopunny|Lopunnite (G19)
    if (line.startsWith(`|-mega|${opponentSide}`)) {
      const parts = line.split('|');
      const nickname = parts[2].split(': ')[1];
      const stone = parts[4]?.trim();
      const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, opponentSide);
      if (pokemon && stone && (!pokemon.item.value || pokemon.item.value === '(has item)')) {
        pokemon.item = revealedField(stone);
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
        pokemon.teraType = revealedField(teraType);
      }
    }

    // Effect attributions reveal abilities: `[from] ability: Poison Heal` on
    // heal/damage/status lines (N1). With `[of] pXa: Nick` the ability belongs
    // to that Pokémon (e.g. Rough Skin recoil), otherwise to the affected one.
    const abilityAttribution = line.match(/\[from\] ability:\s*([^|\n[]+)/);
    if (abilityAttribution) {
      const abilityName = abilityAttribution[1].trim();
      const ofIdent = line.match(/\[of\]\s*(p[12])[a-d]?:\s*([^|\n]+)/);
      let ownerNickname: string | null = null;
      if (ofIdent) {
        if (ofIdent[1] === opponentSide) ownerNickname = ofIdent[2].trim();
      } else {
        const subject = line.match(/^\|-[a-z]+\|(p[12])[a-d]?:\s*([^|]+)\|/);
        if (subject && subject[1] === opponentSide) ownerNickname = subject[2].trim();
      }
      if (ownerNickname) {
        const pokemon = findPokemonByNickname(pokemonMap, ownerNickname, lines, opponentSide);
        if (pokemon && !pokemon.ability.value) {
          pokemon.ability = revealedField(abilityName);
        }
      }
    }
  }

  inferBootsFromHazards(lines, opponentSide, pokemonMap);

  const sheet = parseShowteamSheet(log, opponentSide);
  if (sheet) applyTeamSheet(pokemonMap, sheet);

  return { pokemon: Array.from(pokemonMap.values()) };
}

/**
 * Switching into Stealth Rock without taking chip damage is a strong
 * Heavy-Duty Boots tell (N2). Only applies from gen 8 on (the item's debut)
 * and skips known Magic Guard holders.
 */
function inferBootsFromHazards(
  lines: string[],
  side: 'p1' | 'p2',
  pokemonMap: Map<string, RevealedPokemonInfo>,
) {
  const gen = parseInt(lines.find(line => line.startsWith('|gen|'))?.split('|')[2] ?? '9', 10) || 9;
  if (gen < 8) return;

  let rocksUp = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith(`|-sidestart|${side}:`) && line.includes('Stealth Rock')) rocksUp = true;
    if (line.startsWith(`|-sideend|${side}:`) && line.includes('Stealth Rock')) rocksUp = false;
    if (!rocksUp) continue;

    const switchMatch = line.match(new RegExp(`^\\|(?:switch|drag)\\|${side}[a-d]:\\s*([^|]+)\\|`));
    if (!switchMatch) continue;
    const nickname = switchMatch[1].trim();

    // Entry-hazard damage resolves before the next action — scan until then.
    let tookRockDamage = false;
    for (let lookahead = index + 1; lookahead < lines.length; lookahead++) {
      const next = lines[lookahead];
      if (next.startsWith('|move|') || next.startsWith('|turn|') || next.startsWith('|upkeep')) break;
      if (next.includes('[from] Stealth Rock') && next.includes(`: ${nickname}|`)) {
        tookRockDamage = true;
        break;
      }
    }
    if (tookRockDamage) continue;

    const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, side);
    if (!pokemon) continue;
    if (pokemon.item.value && pokemon.item.value !== '(has item)') continue;
    if (toId(pokemon.ability.value) === 'magicguard') continue;
    // A rocks chip elsewhere in the game disproves Boots outright.
    if (pokemon.ruledOut?.items.includes('heavydutyboots')) continue;
    pokemon.item = guessedField('Heavy-Duty Boots', undefined, 'No Stealth Rock damage on switch-in');
  }
}

function parseDetails(details: string): { species: string; level: number; gender: string } | null {
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
