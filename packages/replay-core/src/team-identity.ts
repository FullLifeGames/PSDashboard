import { Protocol } from '@pkmn/protocol';
import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { RevealedPokemonInfo } from './types.ts';
import { toId } from './ids.ts';
import { teamSpecies } from './inference/lookup.ts';
import { arg, identOf, type LogLine } from './inference/log-line.ts';

/**
 * Round 72, T238: who a body is to the replay. The simulator writes a body's switch-in line from the name and the flags
 * of its set, so a set built with the replay's own name, shiny flag, level and gender writes the line the game wrote
 * (`|switch|p1a: NOT ICT|Landorus-Therian, L50, M, shiny|`) and the branch log needs no translator between the two
 * halves. Level and gender were already in `RevealedPokemonInfo`; this module books the name, the shiny flag and a
 * genderless body, and puts them on the built set.
 */

/** The entry lines: a body enters the field with its name and details. */
const ENTRY_COMMANDS = new Set(['switch', 'drag', 'replace']);

/**
 * The team entry for a sheet's species: its own id, else its base id before the first hyphen (the preview may carry
 * the base, the sheet the forme). The one match `applyTeamSheet` and the identity pass share.
 */
export function sheetMatcher(pokemonMap: ReadonlyMap<string, RevealedPokemonInfo>): (species: string) => RevealedPokemonInfo | undefined {
  const byId = new Map<string, RevealedPokemonInfo>();
  for (const [species, info] of pokemonMap) {
    byId.set(toId(species), info);
    byId.set(toId(species.split('-')[0]), info);
  }
  return species => byId.get(toId(species)) ?? byId.get(toId(species.split('-')[0]));
}

/** Books the name and the shiny flag of a body once: the first line that shows it wins. */
function bookIdentity(info: RevealedPokemonInfo, name: string, shiny: boolean, noGender = false): void {
  if (info.shiny !== undefined) return;
  info.shiny = shiny;
  if (noGender) info.noGender = true;
  const trimmed = name.trim();
  if (trimmed) info.nickname = trimmed;
}

/**
 * The name and the shiny flag the log shows for each body of the side, from its first `switch`, `drag` or `replace`
 * line. An Illusion's disguise line carries the disguised body's own name and flags and books to that body; the
 * `replace` line that ends the disguise books the Zoroark. Team preview (`|poke|`) is not read: it strips the shiny
 * flag and names no nickname.
 */
export function noteLogIdentities(lines: readonly LogLine[], side: string, pokemonMap: Map<string, RevealedPokemonInfo>): void {
  for (const line of lines) {
    if (!ENTRY_COMMANDS.has(line.cmd)) continue;
    const ident = identOf(arg(line, 1));
    if (!ident || ident.side !== side) continue;
    const details = Protocol.parseDetails(ident.name, arg(line, 1) as Protocol.PokemonIdent, arg(line, 2) as Protocol.PokemonDetails);
    const info = pokemonMap.get(teamSpecies(pokemonMap, details.speciesForme.trim()));
    // A line without a gender for a species that has one (a fixed one included): the game ran the body as genderless.
    const noGender = details.gender === undefined && Dex.species.get(details.speciesForme.trim()).gender !== 'N';
    if (info) bookIdentity(info, ident.name, details.shiny, noGender);
  }
}

/** The name and shiny flag of an Open Team Sheet for a body the log never showed (the log wins when both exist). */
export function noteSheetIdentities(sets: readonly PokemonSet[], pokemonMap: Map<string, RevealedPokemonInfo>): void {
  const infoFor = sheetMatcher(pokemonMap);
  for (const set of sets) {
    const species = set.species || set.name;
    const info = species ? infoFor(Dex.species.get(species).name) : undefined;
    // The server writes the species into the name field of a sheet; a nickname there is the sheet's own.
    if (info) bookIdentity(info, set.species ? set.name : '', !!set.shiny);
  }
}

/**
 * Leaves out a name the simulator would not keep or a lookup could not tell apart. The simulator names a body by its
 * species when the name is the species' own, and a lookup of eval-engine/src/branch takes a name for a species, so a
 * name that is the species (or base species) of any body of the side, its own included, is left out: it would find the
 * wrong body. The body stays under its species name, as the simulator writes it; the shiny flag stays.
 *
 * Names the id function cannot tell apart stay: an id of "" (a Chinese or Japanese name, an emoji), two names of one id
 * (`Rias!` and `Rias?`) or one name on two bodies, and a quote or a backslash. The lookups compare the exact name first and
 * take an empty id for no key (team-order.ts, `sameBodyName`), and the stream line that seats the players is built with
 * `JSON.stringify` (round 72, T238).
 */
export function dropAmbiguousNicknames(pokemonMap: Map<string, RevealedPokemonInfo>): void {
  const speciesIds = new Set<string>();
  for (const [key, info] of pokemonMap) {
    for (const name of [key, info.species]) {
      const bare = name.replace(/-\*$/, '');
      const dex = Dex.species.get(bare);
      speciesIds.add(toId(bare));
      if (dex.exists) speciesIds.add(toId(dex.baseSpecies));
    }
  }
  for (const info of pokemonMap.values()) {
    if (info.nickname !== undefined && speciesIds.has(toId(info.nickname))) delete info.nickname;
  }
}

/**
 * The set with the replay's name and shiny flag. A body the replay (or its sheet) showed takes them over whatever the
 * set carried, a pasted team's nickname included, since the replay's own line outranks it; a body no line showed keeps
 * what its source gave. The name of a body without a nickname is its species: the simulator writes the base species
 * for it, as the game did.
 */
export function withReplayIdentity(set: PokemonSet, info: RevealedPokemonInfo): PokemonSet {
  if (info.shiny === undefined) return set;
  const named: PokemonSet = { ...set, name: info.nickname ?? info.species };
  if (info.shiny) named.shiny = true;
  else delete named.shiny;
  if (info.noGender) named.gender = 'N';
  return named;
}
