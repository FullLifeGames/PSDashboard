import { Dex, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, RevealedPokemonInfo } from './types.ts';
import { guessedField, revealedField, unknownEvs, unknownField } from './team-info.ts';
import { createInferrerState } from './inference/inferrer-state.ts';
import { findPokemonByNickname } from './inference/lookup.ts';
import {
  addFromPreview, addFromSwitch, noteEntry, noteGravity, noteMoveOrBoundary, recordAbilityAttribution, recordItem,
  recordItemDamage, recordMove, recordTera, ruleOutFromDamage,
} from './inference/handlers.ts';
import { recordGigantamax } from './inference/power-moves.ts';
import { watchItemEvidence } from './inference/item-evidence.ts';
import { watchTriggerEvidence } from './inference/trigger-evidence.ts';
import { attachHits, collectHits } from './inference/hits.ts';
import { syncClientFacts } from './inference/client-facts.ts';
import { rocksMayMiss } from './inference/rocks-tell.ts';
import { arg, fromEffect, identOf, readLine, type LogLine } from './inference/log-line.ts';
import { toId } from './ids.ts';
import { normalizeLineEndings } from './line-endings.ts';

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
 * One unpacked sheet entry in the shape the inference reads: the Tera type, level and gender default as the sheet
 * leaves them out. The unpacker splits a packed species it has no Dex for ("Zygarde-10%" would come back as
 * "Zygarde- 10 %"), so the species reads the Dex's name for it, and its own text when the Dex does not know it.
 */
function sheetEntry(set: PokemonSet): SheetPokemon | null {
  const packed = set.species || set.name;
  if (!packed) return null;
  const known = Dex.species.get(packed);
  return {
    species: known.exists ? known.name : packed,
    item: set.item,
    ability: set.ability,
    moves: set.moves,
    teraType: set.teraType ?? '',
    level: set.level ?? 100,
    gender: set.gender === 'M' || set.gender === 'F' ? set.gender : '',
  };
}

/** A full packed entry, NICKNAME|SPECIES|ITEM|ABILITY|MOVES|NATURE|EVS|GENDER|IVS|SHINY|LEVEL|MISC, holds eleven pipes. */
const SHEET_ENTRY_PIPES = 11;

/**
 * One entry of a sheet through the library's unpacker. The unpacker counts fields and runs a short entry into the
 * next one, so each entry goes in alone, padded to the full count: a hand-edited or cut-off entry reads with its
 * missing fields empty (as the hand reader took it) and does not swallow the entries after it.
 */
function unpackEntry(entry: string): PokemonSet | undefined {
  const pipes = entry.split('|').length - 1;
  return Teams.unpack(entry + '|'.repeat(Math.max(0, SHEET_ENTRY_PIPES - pipes)))?.[0];
}

/**
 * Reads the `|showteam|` protocol line of a side (Open Team Sheets) through the library: each entry, closed by `]`,
 * goes to `Teams.unpack` of @pkmn/sim, the call team-builder.ts makes for the built sets. Round 72 (T241): the hand
 * splitter of packed names is gone, so "WillOWisp" reads "Will O Wisp" and not "Will OWisp" (sheet-text.spec.ts holds
 * the reading to the old one).
 */
export function parseShowteamSheet(log: string, side: 'p1' | 'p2'): SheetPokemon[] | null {
  const prefix = `|showteam|${side}|`;
  const line = log.split('\n').find(candidate => candidate.startsWith(prefix));
  if (!line) return null;

  const pokemon: SheetPokemon[] = [];
  for (const entry of line.slice(prefix.length).split(']')) {
    const set = unpackEntry(entry);
    const parsed = set && sheetEntry(set);
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
 * Every line is read once through @pkmn/protocol (round 67, T108 step 1) and
 * runs through the handlers in this fixed order; unlike the protocol parser
 * several of them may fire for one line. The walk's own @pkmn/client battle
 * reads the line last, and its state gives abilities and items the handlers
 * leave to it (T108 step 2, inference/client-facts.ts).
 */
export function inferOpponentTeam(rawLog: string, opponentSide: 'p1' | 'p2' = 'p2'): OpponentTeamInfo {
  const log = normalizeLineEndings(rawLog);
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
    recordItem(state, line);
    recordItemDamage(state, line);
    recordTera(state, line);
    recordGigantamax(state, line);
    recordAbilityAttribution(state, line);
    watchTriggerEvidence(state, line);
    collectHits(state, line);
    syncClientFacts(state, line);
  }
  attachHits(state);

  inferBootsFromHazards(lines, opponentSide, state.pokemonMap, { gen: state.gen, freeAbilities: state.freeAbilities });

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
  legality: { gen: number; freeAbilities: boolean },
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
function canGuessBoots(pokemon: RevealedPokemonInfo, legality: { gen: number; freeAbilities: boolean }): boolean {
  if (pokemon.item.value && pokemon.item.value !== '(has item)') return false;
  // A rocks chip elsewhere in the game disproves Boots outright.
  if (pokemon.ruledOut?.items.includes('heavydutyboots')) return false;
  return !rocksMayMiss(pokemon, legality.gen, legality.freeAbilities);
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
