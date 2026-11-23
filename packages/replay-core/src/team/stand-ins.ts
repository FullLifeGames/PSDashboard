import { TeamValidator, type PokemonSet } from '@pkmn/sim';
import type { SmogonUsageStats } from '../smogon/stats-types.ts';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types.ts';
import { inferReplayFormatId, teamSizes } from '../replay-format.ts';
import { dexOf, logRules, simFormats, type RulesDex } from '../rules-dex.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import { guessedField, unknownEvs, unknownField } from '../team-info.ts';
import { toId } from '../ids.ts';

/** The bodies a side never showed (ARCHITECTURE.md, "Stand-ins"): every build path calls `withStandIns` before it enriches the infos. */
export type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };
type Side = 'p1' | 'p2';
const SIDES: Side[] = ['p1', 'p2'];

/** A role of the published random-set file, or the species itself where the file lists no roles (Generation 1). */
export interface RandomSetRole { abilities?: string[]; items?: string[]; moves?: string[] }
/** A format's published random-set file (data.pkmn.cc/random/<formatid>.json): species, level and roles with their moves, abilities and items. */
export type RandomSetFile = Record<string, RandomSetRole & { level?: number; roles?: Record<string, RandomSetRole> }>;

/** The provenance the filled bodies carry on their moves, ability and item; the stand-in mark reads it to word the guess. */
export const RANDOM_SET_DETAIL = 'random-set data';

/** A pasted body the user's team lists: its species is all the fill reads (the set itself overlays through the paste's own path). */
export type PastedBody = { species: string };

/** Whether a body of the side already is this pasted species (the paste overlay's own matching: the id, or the id before the first hyphen). */
function sameBody(info: RevealedPokemonInfo, pasted: PastedBody): boolean {
  const ids = (name: string) => [toId(name), toId(name.split('-')[0])];
  const shown = ids(info.species);
  return ids(pasted.species).some(id => shown.includes(id));
}

const blankBody = (species: string, level: number): RevealedPokemonInfo => ({
  species, moves: [], ability: unknownField(), item: unknownField(), teraType: unknownField(), evs: unknownEvs(), level, gender: '',
});

/** Whether the log's side listed its bodies at a team preview: the preview already says everything the log will show. */
const hasPreview = (log: string, side: Side) => log.includes(`\n|poke|${side}|`);

/** How many bodies a side still lacks: its `|teamsize|` minus the bodies built; 0 with a team preview, without a size, or when the side is not short. */
export function missingBodies(log: string, built: number, side: Side): number {
  const lf = normalizeLineEndings(log);
  const size = teamSizes(lf)[side];
  if (size === null || hasPreview(`\n${lf}`, side)) return 0;
  return Math.max(0, size - built);
}

/** Whether the format's Dex entry generates the team (Random Battle, Hackmons Cup): the rule of `withStandIns`, read from the Dex, never from a name. */
export function generatesTeam(formatId: string): boolean {
  const format = simFormats().get(formatId);
  return format.exists && !!format.team;
}

/** teammates[species] as id maps, once per stats object: the greedy step asks per body per candidate. */
const mateMaps = new WeakMap<SmogonUsageStats, Map<string, Map<string, number>>>();
function mateMap(stats: SmogonUsageStats, speciesId: string): Map<string, number> | undefined {
  let byEntry = mateMaps.get(stats);
  if (!byEntry) {
    byEntry = new Map();
    mateMaps.set(stats, byEntry);
  }
  let map = byEntry.get(speciesId);
  if (!map) {
    const rows = stats.pokemon[speciesId]?.teammates;
    if (!rows) return undefined;
    map = new Map(rows.map(row => [toId(row.value), row.probability]));
    byEntry.set(speciesId, map);
  }
  return map;
}

/** Whether the species may stand on a team of this format: the game's Dex knows it and the format's rule table lets it in. */
function legalIn(dex: RulesDex, validator: TeamValidator | null, name: string): { name: string; base: string } | null {
  const species = dex.species.get(name);
  if (!species.exists || species.gen > dex.gen) return null;
  if (validator) {
    const set = { name: species.name, species: species.name, ability: '', moves: [] } as unknown as PokemonSet;
    if (validator.checkSpecies(set, species, species, {})) return null;
  }
  return { name: species.name, base: species.baseSpecies || species.name };
}

/**
 * `count` guesses for a side that holds `known`, most likely first: greedy by the summed share of teams that carry the candidate with each body
 * the side already has, one per base species (Species Clause), legal in the game's format.
 */
function guessBodies(stats: SmogonUsageStats, known: RevealedPokemonInfo[], count: number, log: string, formatId: string): RevealedPokemonInfo[] {
  const dex = dexOf(logRules(log));
  const format = simFormats().get(formatId);
  const validator = format.exists ? new TeamValidator(format) : null;
  const level = known[0]?.level ?? 100;
  const taken = new Set(known.map(info => {
    const species = dex.species.get(info.species);
    return species.exists ? species.baseSpecies || species.name : info.species;
  }));
  const team = known.map(info => info.species);
  const chosen: RevealedPokemonInfo[] = [];
  const pool = Object.entries(stats.pokemon).map(([id, entry]) => ({ id, entry }));
  for (let step = 0; step < count; step++) {
    let best: { species: { name: string; base: string }; score: number; count: number } | null = null;
    for (const { id, entry } of pool) {
      const legal = legalIn(dex, validator, entry.species);
      if (!legal || taken.has(legal.base)) continue;
      const score = team.reduce((sum, mate) => sum + (mateMap(stats, toId(mate))?.get(id) ?? 0), 0);
      const better = !best || score > best.score || (score === best.score
        && (entry.rawCount > best.count || (entry.rawCount === best.count && legal.name < best.species.name)));
      if (better) best = { species: legal, score, count: entry.rawCount };
    }
    if (!best) break;
    taken.add(best.species.base);
    team.push(best.species.name);
    chosen.push({ ...blankBody(best.species.name, level), standIn: true });
  }
  return chosen;
}

/** mulberry32 over an FNV-1a hash of the text: the draw's deterministic source. */
function seededDraw(text: string): () => number {
  let state = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) state = Math.imul(state ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** One body of the file: its level, and one drawn role's first ability and item with four of its moves (all of them when it lists four or fewer). */
function randomBody(name: string, entry: RandomSetFile[string], below: (limit: number) => number): RevealedPokemonInfo {
  const roles = Object.values(entry.roles ?? {});
  const role = roles.length > 0 ? roles[below(roles.length)] : entry;
  const moves = [...(role.moves ?? entry.moves ?? [])];
  while (moves.length > 4) moves.splice(below(moves.length), 1);
  const ability = (role.abilities ?? entry.abilities ?? [])[0];
  const item = (role.items ?? entry.items ?? [])[0];
  return {
    ...blankBody(name, entry.level ?? 100),
    moves: moves.map(move => ({ name: move, source: 'guessed' as const, sourceDetail: RANDOM_SET_DETAIL })),
    ability: ability ? guessedField(ability, undefined, RANDOM_SET_DETAIL) : unknownField(),
    item: item ? guessedField(item, undefined, RANDOM_SET_DETAIL) : unknownField(),
    standIn: true,
  };
}

/**
 * `count` guesses for a side of a generated-team game: a draw seeded by the log's header (its players, rules and sizes, which one replay never
 * changes) and the side, so a game keeps its guess on every build path. Candidates are the file's species the game's Dex knows and the format lets
 * in, one per base species, none of them a base the side shows; each draws one role and four of its moves, and takes that role's first ability and item.
 */
function randomBodies(
  file: RandomSetFile, known: RevealedPokemonInfo[], count: number, log: string, formatId: string, side: Side,
): RevealedPokemonInfo[] {
  const dex = dexOf(logRules(log));
  const format = simFormats().get(formatId);
  const validator = format.exists ? new TeamValidator(format) : null;
  const header = log.includes('\n|start') ? log.slice(0, log.indexOf('\n|start')) : log;
  const draw = seededDraw(`${header}\n${side}\n${formatId}`);
  const below = (limit: number) => Math.min(limit - 1, Math.floor(draw() * limit));
  const taken = new Set(known.map(info => {
    const species = dex.species.get(info.species);
    return species.exists ? species.baseSpecies || species.name : info.species;
  }));
  const pool = Object.keys(file).sort().flatMap(name => {
    const legal = legalIn(dex, validator, name);
    return legal ? [{ ...legal, entry: file[name] }] : [];
  });
  const chosen: RevealedPokemonInfo[] = [];
  for (let step = 0; step < count; step++) {
    const open = pool.filter(candidate => !taken.has(candidate.base));
    if (open.length === 0) break;
    const { name, base, entry } = open[below(open.length)];
    taken.add(base);
    chosen.push(randomBody(name, entry, below));
  }
  return chosen;
}

/** One side filled up to `lacking` bodies: the pasted ones it does not show yet, then stand-ins; null when nothing was added. */
function filledSide(
  info: OpponentTeamInfo, lacking: number, lf: string, formatId: string,
  usageStats: SmogonUsageStats | null | undefined, pasted: readonly PastedBody[], side: Side, randomSets: RandomSetFile | null,
): OpponentTeamInfo | null {
  const bodies = [...info.pokemon];
  const level = bodies[0]?.level ?? 100;
  const dex = dexOf(logRules(lf));
  for (const body of pasted) {
    if (bodies.length - info.pokemon.length >= lacking) break;
    if (bodies.some(shown => sameBody(shown, body))) continue;
    const species = dex.species.get(body.species);
    bodies.push(blankBody(species.exists ? species.name : body.species, level));
  }
  const stillLacking = lacking - (bodies.length - info.pokemon.length);
  if (stillLacking > 0 && randomSets) {
    bodies.push(...randomBodies(randomSets, bodies, stillLacking, lf, formatId, side));
  } else if (stillLacking > 0 && usageStats && Object.keys(usageStats.pokemon).length > 0) {
    bodies.push(...guessBodies(usageStats, bodies, stillLacking, lf, formatId));
  }
  return bodies.length === info.pokemon.length ? null : { ...info, pokemon: bodies };
}

/** Fills every short side up to its `|teamsize|` with pasted bodies, then stand-ins (`randomSets` for generated teams); `raw` itself when nothing changes. */
export function withStandIns(
  raw: SideInfos,
  log: string,
  usageStats: SmogonUsageStats | null | undefined,
  pasted?: Partial<Record<Side, readonly PastedBody[]>>,
  randomSets?: RandomSetFile | null,
): SideInfos {
  // The build maps the bodies the log shows one to one onto sets: a side that showed 3 of its 6 would play the engine as a 3 against 6 game.
  const lf = normalizeLineEndings(log);
  const formatId = inferReplayFormatId({ log: lf });
  const generated = generatesTeam(formatId);
  if (generated && !randomSets) return raw;
  const fileOf = generated ? randomSets ?? null : null;
  const next: SideInfos = { ...raw };
  let changed = false;
  for (const side of SIDES) {
    const lacking = missingBodies(lf, raw[side].pokemon.length, side);
    const filled = lacking > 0 ? filledSide(raw[side], lacking, lf, formatId, usageStats, pasted?.[side] ?? [], side, fileOf) : null;
    if (filled) {
      next[side] = filled;
      changed = true;
    }
  }
  return changed ? next : raw;
}
