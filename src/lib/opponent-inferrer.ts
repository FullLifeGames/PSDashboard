import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types';
import { guessedField, revealedField, unknownEvs, unknownField } from './team-info';
import { createInferrerState } from './inference/inferrer-state';
import { findPokemonByNickname } from './inference/lookup';
import {
  addFromPreview, addFromSwitch, noteEntry, noteGravity, noteMoveOrBoundary, recordAbility, recordAbilityAttribution,
  recordConsumedItem, recordHealItem, recordItem, recordItemDamage, recordMega, recordMove, recordTera, ruleOutFromDamage,
} from './inference/handlers';
import { toId } from './ids';

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
/** The packed entry's trailing fields: tera type from MISC, level, gender. */
function sheetEntryDetails(fields: string[]): Pick<SheetPokemon, 'teraType' | 'level' | 'gender'> {
  const misc = (fields[11] ?? '').split(',');
  return {
    teraType: misc[5]?.trim() ?? '',
    level: parseInt(fields[10] ?? '', 10) || 100,
    gender: fields[7] === 'M' || fields[7] === 'F' ? fields[7] : '',
  };
}

/** One packed sheet entry; null when it names no species. */
function sheetEntry(entry: string): SheetPokemon | null {
  const fields = entry.split('|');
  const nickname = fields[0]?.trim() ?? '';
  const species = (fields[1]?.trim() || nickname);
  if (!species) return null;
  return {
    species: splitPackedName(species),
    item: splitPackedName(fields[2] ?? ''),
    ability: splitPackedName(fields[3] ?? ''),
    moves: (fields[4] ?? '')
      .split(',')
      .map(move => splitPackedName(move))
      .filter(Boolean),
    ...sheetEntryDetails(fields),
  };
}

export function parseShowteamSheet(log: string, side: 'p1' | 'p2'): SheetPokemon[] | null {
  const prefix = `|showteam|${side}|`;
  const line = log.split('\n')
    .map(rawLine => rawLine.replace(/\r$/, ''))
    .find(candidate => candidate.startsWith(prefix));
  if (!line) return null;

  const entries = line.slice(prefix.length).split(']');
  const pokemon: SheetPokemon[] = [];

  for (const entry of entries) {
    const parsed = sheetEntry(entry);
    if (parsed) pokemon.push(parsed);
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

/**
 * Extracts revealed information about the opponent's team from the replay log.
 * Parses |poke|, |switch|, |move|, |-ability|, |-item|, |-terastallize| lines for p2.
 * Every line runs through the handlers in this fixed order; unlike the
 * protocol parser several of them may fire for one line.
 */
export function inferOpponentTeam(log: string, opponentSide: 'p1' | 'p2' = 'p2'): OpponentTeamInfo {
  const lines = log.split('\n');
  const state = createInferrerState(lines, opponentSide);

  for (const line of lines) {
    noteMoveOrBoundary(state, line);
    noteGravity(state, line);
    noteEntry(state, line);
    ruleOutFromDamage(state, line);
    addFromPreview(state, line);
    addFromSwitch(state, line);
    recordMove(state, line);
    recordAbility(state, line);
    recordItem(state, line);
    recordConsumedItem(state, line);
    recordHealItem(state, line);
    recordItemDamage(state, line);
    recordMega(state, line);
    recordTera(state, line);
    recordAbilityAttribution(state, line);
  }

  inferBootsFromHazards(lines, opponentSide, state.pokemonMap);

  const sheet = parseShowteamSheet(log, opponentSide);
  if (sheet) applyTeamSheet(state.pokemonMap, sheet);

  return { pokemon: Array.from(state.pokemonMap.values()) };
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

    if (tookRockDamageOnEntry(lines, index, nickname)) continue;

    const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, side);
    if (!pokemon || !canGuessBoots(pokemon)) continue;
    pokemon.item = guessedField('Heavy-Duty Boots', undefined, 'No Stealth Rock damage on switch-in');
  }
}

/** Boots stay a guess only while nothing known about the holder rules them out. */
function canGuessBoots(pokemon: RevealedPokemonInfo): boolean {
  if (pokemon.item.value && pokemon.item.value !== '(has item)') return false;
  if (toId(pokemon.ability.value) === 'magicguard') return false;
  // A rocks chip elsewhere in the game disproves Boots outright.
  if (pokemon.ruledOut?.items.includes('heavydutyboots')) return false;
  return true;
}

/** Entry-hazard damage resolves before the next action — scan until then. */
function tookRockDamageOnEntry(lines: string[], index: number, nickname: string): boolean {
  for (let lookahead = index + 1; lookahead < lines.length; lookahead++) {
    const next = lines[lookahead];
    if (next.startsWith('|move|') || next.startsWith('|turn|') || next.startsWith('|upkeep')) break;
    if (next.includes('[from] Stealth Rock') && next.includes(`: ${nickname}|`)) {
      return true;
    }
  }
  return false;
}
