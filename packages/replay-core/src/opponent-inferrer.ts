import type { OpponentTeamInfo, RevealedPokemonInfo } from './types.ts';
import { guessedField, revealedField, unknownEvs, unknownField } from './team-info.ts';
import { createInferrerState } from './inference/inferrer-state.ts';
import { findPokemonByNickname } from './inference/lookup.ts';
import {
  addFromPreview, addFromSwitch, noteEntry, noteGravity, noteMoveOrBoundary, recordAbility, recordAbilityAttribution,
  recordConsumedItem, recordHealItem, recordItem, recordItemDamage, recordMega, recordMove, recordTera, ruleOutFromDamage,
} from './inference/handlers.ts';
import { watchItemEvidence } from './inference/item-evidence.ts';
import { watchTriggerEvidence } from './inference/trigger-evidence.ts';
import { attachHits, collectHits } from './inference/hits.ts';
import { syncClientFacts } from './inference/client-facts.ts';
import { rocksMayMiss } from './inference/rocks-tell.ts';
import { arg, fromEffect, identOf, readLine, type LogLine } from './inference/log-line.ts';
import { toId } from './ids.ts';

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

    // The sheet names the forme a "-*" preview marker hid, and the battle
    // may never show it (the mon stayed benched).
    if (info.species.endsWith('-*')) info.species = sheetMon.species;
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
 * Every line is read once through @pkmn/protocol (round 67, T108 step 1) and
 * runs through the handlers in this fixed order; unlike the protocol parser
 * several of them may fire for one line.
 */
export function inferOpponentTeam(log: string, opponentSide: 'p1' | 'p2' = 'p2'): OpponentTeamInfo {
  const lines = log.split('\n').map(readLine);
  const state = createInferrerState(lines, opponentSide);

  for (const line of lines) {
    watchItemEvidence(state, line);
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
    watchTriggerEvidence(state, line);
    collectHits(state, line);
    syncClientFacts(state, line);
  }
  attachHits(state);

  inferBootsFromHazards(lines, opponentSide, state.pokemonMap, { gen: state.gen, custom: state.custom });

  const sheet = parseShowteamSheet(log, opponentSide);
  if (sheet) applyTeamSheet(state.pokemonMap, sheet);

  return { pokemon: Array.from(state.pokemonMap.values()) };
}

/**
 * Switching into Stealth Rock without taking chip damage is a strong
 * Heavy-Duty Boots tell (N2). Only applies from gen 8 on (the item's debut)
 * and skips holders an ability they may have explains as well (T130).
 */
function inferBootsFromHazards(
  lines: readonly LogLine[],
  side: 'p1' | 'p2',
  pokemonMap: Map<string, RevealedPokemonInfo>,
  legality: { gen: number; custom: boolean },
) {
  if (legality.gen < 8) return;

  let rocksUp = false;
  for (let index = 0; index < lines.length; index++) {
    rocksUp = rocksAfter(lines[index], side, rocksUp);
    const nickname = rocksUp ? entrantOf(lines[index], side) : null;
    if (!nickname || tookRockDamageOnEntry(lines, index, nickname)) continue;

    const pokemon = findPokemonByNickname(pokemonMap, nickname, lines, side);
    if (!pokemon || !canGuessBoots(pokemon, legality)) continue;
    pokemon.item = guessedField('Heavy-Duty Boots', undefined, 'No Stealth Rock damage on switch-in');
  }
}

/** Stealth Rock on the side: set by its -sidestart, lifted by its -sideend; every other line leaves it. */
function rocksAfter(line: LogLine, side: string, up: boolean): boolean {
  if (identOf(arg(line, 1))?.side !== side || !arg(line, 2).includes('Stealth Rock')) return up;
  if (line.cmd === '-sidestart') return true;
  return line.cmd === '-sideend' ? false : up;
}

/** The nickname of a Pokémon of the side entering a position ("|switch|p2a: Nick|..."), else null. */
function entrantOf(line: LogLine, side: string): string | null {
  if (line.cmd !== 'switch' && line.cmd !== 'drag') return null;
  const ident = identOf(arg(line, 1));
  return ident && ident.side === side && ident.slot ? ident.name.trim() : null;
}

/**
 * Boots stay a guess only while nothing known about the holder rules them
 * out, and while no ability it may have keeps the rock damage off, asked of
 * the simulator as the build asks it (T130: a Magic Guard Clefable showed the
 * guess in the panel while the build refused it).
 */
function canGuessBoots(pokemon: RevealedPokemonInfo, legality: { gen: number; custom: boolean }): boolean {
  if (pokemon.item.value && pokemon.item.value !== '(has item)') return false;
  // A rocks chip elsewhere in the game disproves Boots outright.
  if (pokemon.ruledOut?.items.includes('heavydutyboots')) return false;
  return !rocksMayMiss(pokemon, legality.gen, legality.custom);
}

/** Entry-hazard damage resolves before the next action — scan until then. */
function tookRockDamageOnEntry(lines: readonly LogLine[], index: number, nickname: string): boolean {
  for (let lookahead = index + 1; lookahead < lines.length; lookahead++) {
    const next = lines[lookahead];
    if (next.cmd === 'move' || next.cmd === 'turn' || next.cmd === 'upkeep') break;
    const from = fromEffect(next);
    if (!from.type && from.name === 'Stealth Rock' && identOf(arg(next, 1))?.name === nickname) {
      return true;
    }
  }
  return false;
}
