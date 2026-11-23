import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, RevealedPokemonInfo } from './types.ts';
import { guessedField, revealedField, unknownEvs, unknownField } from './team-info.ts';
import { createInferrerState } from './inference/inferrer-state.ts';
import { findPokemonByNickname } from './inference/lookup.ts';
import {
  addFromPreview, addFromSwitch, noteEntry, noteMoveOrBoundary, recordAbilityAttribution, recordItem,
  recordItemDamage, recordMove, recordTera, ruleOutFromDamage,
} from './inference/handlers.ts';
import { recordGigantamax } from './inference/power-moves.ts';
import { watchItemEvidence } from './inference/item-evidence.ts';
import { watchScreenEvidence } from './inference/screen-evidence.ts';
import { watchFieldEvidence } from './inference/field-evidence.ts';
import { watchTriggerEvidence } from './inference/trigger-evidence.ts';
import { attachHits, collectHits } from './inference/hits.ts';
import { syncClientFacts } from './inference/client-facts.ts';
import { watchBlockedEffects } from './inference/blocked-effects.ts';
import { rocksMayMiss } from './inference/rocks-tell.ts';
import { arg, fromEffect, identOf, readLine, type LogLine } from './inference/log-line.ts';
import { toId } from './ids.ts';
import { dexOf, logRules, type RulesDex } from './rules-dex.ts';
import type { LegalityContext } from './team/dex-legal.ts';
import { normalizeLineEndings } from './line-endings.ts';
import { dropAmbiguousNicknames, noteLogIdentities, noteSheetIdentities, sheetMatcher } from './team-identity.ts';

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
 * One unpacked sheet entry as the inference reads it: Tera type, level and gender default as the sheet leaves them out. A species the
 * sheet writes in the name field reads the Dex's name for it, else its own text.
 */
function sheetEntry(dex: RulesDex, set: PokemonSet): SheetPokemon | null {
  const packed = set.species || set.name;
  if (!packed) return null;
  const known = dex.species.get(packed);
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

type NameTable = { get(name: string): { exists: boolean } };

/** The unpacker's spelling where the Dex knows the id; the text as written where it does not (the unpacker would split it at its capitals). */
function asWritten(raw: string | undefined, read: string, table: NameTable): string {
  const text = raw?.trim();
  return text && !table.get(text).exists && toId(text) === toId(read) ? text : read;
}

/** The unpacked entry with the species, item, ability and moves its packed text names but the Dex does not know put back as written. */
function writtenNames(dex: RulesDex, set: PokemonSet, entry: string): PokemonSet {
  const fields = entry.split('|');
  const moves = (fields[4] ?? '').split(',').filter(move => move);
  return {
    ...set,
    species: asWritten(fields[1], set.species, dex.species),
    item: asWritten(fields[2], set.item, dex.items),
    ability: asWritten(fields[3], set.ability, dex.abilities),
    moves: set.moves.map((move, index) => (moves.length === set.moves.length ? asWritten(moves[index], move, dex.moves) : move)),
  };
}

/**
 * One entry through the library's unpacker (`Teams.import`), handed the Dex tables so a name reads as the Dex spells it ("WillOWisp" is
 * "Will-O-Wisp"). The unpacker runs a short entry into the next one, so each entry goes in alone, padded to the full count.
 */
function unpackEntry(dex: RulesDex, entry: string): PokemonSet | undefined {
  const pipes = entry.split('|').length - 1;
  const set = Teams.import(entry + '|'.repeat(Math.max(0, SHEET_ENTRY_PIPES - pipes)))?.[0];
  return set && writtenNames(dex, set, entry);
}

/** The sets of one packed sheet (the part of a `|showteam|` line after the side): the one reader of the parser and of `extractTeamSheets`. */
export function unpackSheetSets(packed: string, dex: RulesDex): PokemonSet[] {
  const sets: PokemonSet[] = [];
  for (const entry of packed.split(']')) {
    const set = unpackEntry(dex, entry);
    if (set && (set.species || set.name)) sets.push(set);
  }
  return sets;
}

/** The sets of the `|showteam|` line of a side (Open Team Sheets), null without one: `unpackSheetSets` of its packed part. */
function sheetSetsOf(log: string, side: 'p1' | 'p2', dex: RulesDex): PokemonSet[] | null {
  const prefix = `|showteam|${side}|`;
  const line = log.split('\n').find(candidate => candidate.startsWith(prefix));
  return line ? unpackSheetSets(line.slice(prefix.length), dex) : null;
}

/** Reads the `|showteam|` line of a side (Open Team Sheets) through `unpackSheetSets`; null without one. */
export function parseShowteamSheet(log: string, side: 'p1' | 'p2'): SheetPokemon[] | null {
  const dex = dexOf(logRules(log));
  const pokemon = (sheetSetsOf(log, side, dex) ?? []).map(set => sheetEntry(dex, set)).filter((mon): mon is SheetPokemon => mon !== null);
  return pokemon.length > 0 ? pokemon : null;
}

/** Applies an Open Team Sheet onto the revealed data: a sheet is public, so its moves, items and abilities count as revealed, not as Smogon guesses. */
function applyTeamSheet(pokemonMap: Map<string, RevealedPokemonInfo>, sheet: SheetPokemon[]) {
  const infoFor = sheetMatcher(pokemonMap);

  for (const sheetMon of sheet) {
    const info = infoFor(sheetMon.species);
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

    // The sheet names the forme a "-*" preview marker hid, and the battle may never show it (the mon stayed benched).
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

/** The revealed team of the opponent: every line runs through the handlers in this fixed order, several may fire for one line, and the walk's @pkmn/client battle reads it last. */
export function inferOpponentTeam(rawLog: string, opponentSide: 'p1' | 'p2' = 'p2'): OpponentTeamInfo {
  const log = normalizeLineEndings(rawLog);
  const lines = log.split('\n').map(readLine);
  const state = createInferrerState(lines, opponentSide);

  for (const line of lines) {
    watchItemEvidence(state, line);
    watchScreenEvidence(state, line);
    watchFieldEvidence(state, line);
    noteMoveOrBoundary(state, line);
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
    watchBlockedEffects(state, line);
  }
  attachHits(state);

  inferBootsFromHazards(lines, opponentSide, state.pokemonMap, { gen: state.gen, mod: state.mod, freeAbilities: state.freeAbilities });

  const dex = dexOf(state);
  const sheet = parseShowteamSheet(log, opponentSide);
  if (sheet) applyTeamSheet(state.pokemonMap, sheet);
  noteLogIdentities(dex, lines, opponentSide, state.pokemonMap);
  noteSheetIdentities(dex, sheetSetsOf(log, opponentSide, dex) ?? [], state.pokemonMap);
  dropAmbiguousNicknames(dex, state.pokemonMap);

  return { pokemon: Array.from(state.pokemonMap.values()) };
}

/** Switching into Stealth Rock without chip damage is a Heavy-Duty Boots tell; gen 8 on (the item's debut), and not for a holder an ability it may have explains. */
function inferBootsFromHazards(
  lines: readonly LogLine[],
  side: 'p1' | 'p2',
  pokemonMap: Map<string, RevealedPokemonInfo>,
  legality: LegalityContext,
) {
  if (legality.gen < 8) return;

  let rocksUp = false;
  for (let index = 0; index < lines.length; index++) {
    rocksUp = rocksAfter(lines[index], side, rocksUp);
    const nickname = rocksUp ? entrantOf(lines[index], side) : null;
    if (!nickname || tookRockDamageOnEntry(lines, index, nickname)) continue;

    const pokemon = findPokemonByNickname(dexOf(legality), pokemonMap, nickname, lines, side);
    if (!pokemon || !canGuessBoots(pokemon, legality)) continue;
    pokemon.item = guessedField('Heavy-Duty Boots', undefined, 'No Stealth Rock damage on switch-in');
  }
}

function rocksAfter(line: LogLine, side: string, up: boolean): boolean {
  if (identOf(arg(line, 1))?.side !== side || !arg(line, 2).includes('Stealth Rock')) return up;
  if (line.cmd === '-sidestart') return true;
  return line.cmd === '-sideend' ? false : up;
}

function entrantOf(line: LogLine, side: string): string | null {
  if (line.cmd !== 'switch' && line.cmd !== 'drag') return null;
  const ident = identOf(arg(line, 1));
  return ident && ident.side === side && ident.slot ? ident.name.trim() : null;
}

/**
 * Boots stay a guess only while nothing known about the holder rules them out and no ability it may have keeps the rock damage off, asked
 * of the simulator as the build asks it (the panel never shows a guess the build refuses).
 */
function canGuessBoots(pokemon: RevealedPokemonInfo, legality: LegalityContext): boolean {
  if (pokemon.item.value && pokemon.item.value !== '(has item)') return false;
  // A rocks chip elsewhere in the game disproves Boots outright.
  if (pokemon.ruledOut?.items.includes('heavydutyboots')) return false;
  return !rocksMayMiss(pokemon, dexOf(legality), legality.freeAbilities);
}

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
