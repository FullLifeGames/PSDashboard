import { Protocol } from '@pkmn/protocol';
import type { RulesDex } from './rules-dex.ts';
import type { PokemonSet } from '@pkmn/sim';
import type { RevealedPokemonInfo } from './types.ts';
import { toId } from './ids.ts';
import { teamSpecies } from './inference/lookup.ts';
import { arg, identOf, type LogLine } from './inference/log-line.ts';

/** Books each body's name, shiny flag and genderlessness so the simulator writes the game's switch-in line. */

const ENTRY_COMMANDS = new Set(['switch', 'drag', 'replace']);

/** The team entry for a sheet's species: its own id, else its base id before the first hyphen. */
export function sheetMatcher(pokemonMap: ReadonlyMap<string, RevealedPokemonInfo>): (species: string) => RevealedPokemonInfo | undefined {
  const byId = new Map<string, RevealedPokemonInfo>();
  for (const [species, info] of pokemonMap) {
    byId.set(toId(species), info);
    byId.set(toId(species.split('-')[0]), info);
  }
  return species => byId.get(toId(species)) ?? byId.get(toId(species.split('-')[0]));
}

function bookIdentity(info: RevealedPokemonInfo, name: string, shiny: boolean, noGender = false): void {
  if (info.shiny !== undefined) return;
  info.shiny = shiny;
  if (noGender) info.noGender = true;
  const trimmed = name.trim();
  if (trimmed) info.nickname = trimmed;
}

// Team preview (`|poke|`) strips the shiny flag and names no nickname; an Illusion's disguise books to the disguised.
/** The name and shiny flag the log shows per body, from its first `switch`, `drag` or `replace` line. */
export function noteLogIdentities(dex: RulesDex, lines: readonly LogLine[], side: string, pokemonMap: Map<string, RevealedPokemonInfo>): void {
  for (const line of lines) {
    if (!ENTRY_COMMANDS.has(line.cmd)) continue;
    const ident = identOf(arg(line, 1));
    if (!ident || ident.side !== side) continue;
    const details = Protocol.parseDetails(ident.name, arg(line, 1) as Protocol.PokemonIdent, arg(line, 2) as Protocol.PokemonDetails);
    const info = pokemonMap.get(teamSpecies(dex, pokemonMap, details.speciesForme.trim()));
    // A line without a gender for a species that has one: the game ran the body as genderless.
    const noGender = details.gender === undefined && dex.species.get(details.speciesForme.trim()).gender !== 'N';
    if (info) bookIdentity(info, ident.name, details.shiny, noGender);
  }
}

/** The name and shiny flag of an Open Team Sheet for a body the log never showed (the log wins when both exist). */
export function noteSheetIdentities(dex: RulesDex, sets: readonly PokemonSet[], pokemonMap: Map<string, RevealedPokemonInfo>): void {
  const infoFor = sheetMatcher(pokemonMap);
  for (const set of sets) {
    const species = set.species || set.name;
    const info = species ? infoFor(dex.species.get(species).name) : undefined;
    // The server writes the species into the name field of a sheet; a nickname there is the sheet's own.
    if (info) bookIdentity(info, set.species ? set.name : '', !!set.shiny);
  }
}

// Names the id cannot tell apart stay (an id of "", one name on two bodies, a quote): lookups compare names first.
/** Drops a name that is a species of the side's bodies (the sim would not keep it); the body keeps its species. */
export function dropAmbiguousNicknames(dex: RulesDex, pokemonMap: Map<string, RevealedPokemonInfo>): void {
  const speciesIds = new Set<string>();
  for (const [key, info] of pokemonMap) {
    for (const name of [key, info.species]) {
      const bare = name.replace(/-\*$/, '');
      const entry = dex.species.get(bare);
      speciesIds.add(toId(bare));
      if (entry.exists) speciesIds.add(toId(entry.baseSpecies));
    }
  }
  for (const info of pokemonMap.values()) {
    if (info.nickname !== undefined && speciesIds.has(toId(info.nickname))) delete info.nickname;
  }
}

/** The set with the replay's name and shiny flag: the replay's own line outranks a pasted team's nickname. */
export function withReplayIdentity(set: PokemonSet, info: RevealedPokemonInfo): PokemonSet {
  if (info.shiny === undefined) return set;
  const named: PokemonSet = { ...set, name: info.nickname ?? info.species };
  if (info.shiny) named.shiny = true;
  else delete named.shiny;
  if (info.noGender) named.gender = 'N';
  return named;
}
