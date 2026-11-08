import { TeamValidator, type PokemonSet } from '@pkmn/sim';
import type { SmogonUsageStats } from '../smogon/stats-types.ts';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types.ts';
import { inferReplayFormatId, teamSizes } from '../replay-format.ts';
import { dexOf, logRules, simFormats, type RulesDex } from '../rules-dex.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import { unknownEvs, unknownField } from '../team-info.ts';
import { toId } from '../ids.ts';

/**
 * Round 88 (F, #101): the bodies a side never showed. A game without team preview lets a side win with the bodies that entered,
 * and the build maps the bodies the log shows one to one onto sets, so a side that showed 3 of its 6 played the engine as a
 * 3 against 6 game (smogtours-gen4ou-544639 read -0.750 at turn 1). `|teamsize|` is the side's real count (teamSizes), so a side
 * whose built count falls short of it gets the difference as stand-ins, guessed from the format's teammate statistics: greedy by
 * the sum of the share of teams that carry the candidate with each body the side already has, a distinct base species (Species
 * Clause), legal in the game's format. A pasted team fills the user's open slots before any guess. Every build path calls this one
 * function before it enriches the infos: the app's panel and live build, `buildAppTeams` of the bank, the builder itself.
 *
 * Nothing changes for a side with a team preview (the preview lists every body; a bring-limited format lists more than it
 * brings), for a log without `|teamsize|`, for a format whose Dex entry generates the team (Random Battle, Hackmons Cup: no stats
 * file; the panel says so), and for a side that is not short.
 */
export type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };
type Side = 'p1' | 'p2';
const SIDES: Side[] = ['p1', 'p2'];

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

/**
 * How many bodies a side still lacks: its `|teamsize|` minus the bodies built, 0 for a side with a team preview, a log without a
 * size, or a side that is not short. The panel's notice reads it for a format the step cannot fill.
 */
export function missingBodies(log: string, built: number, side: Side): number {
  const lf = normalizeLineEndings(log);
  const size = teamSizes(lf)[side];
  if (size === null || hasPreview(`\n${lf}`, side)) return 0;
  return Math.max(0, size - built);
}

/** The game's format, when its Dex entry generates the team: such a game has no stats file and no stand-ins. */
function generatedTeam(formatId: string): boolean {
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

/** `count` guesses for a side that holds `known`, most likely first. */
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

/** One side filled up to `lacking` bodies: the pasted ones it does not show yet, then stand-ins; null when nothing was added. */
function filledSide(
  info: OpponentTeamInfo, lacking: number, lf: string, formatId: string,
  usageStats: SmogonUsageStats | null | undefined, pasted: readonly PastedBody[],
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
  if (stillLacking > 0 && usageStats && Object.keys(usageStats.pokemon).length > 0) {
    bodies.push(...guessBodies(usageStats, bodies, stillLacking, lf, formatId));
  }
  return bodies.length === info.pokemon.length ? null : { ...info, pokemon: bodies };
}

/**
 * The infos with every short side filled up to its `|teamsize|`: first by the pasted bodies the side does not show yet (the user's
 * own team, `pasted.p1`), then by stand-ins from the statistics. Returns `raw` itself when no side changes.
 */
export function withStandIns(
  raw: SideInfos,
  log: string,
  usageStats: SmogonUsageStats | null | undefined,
  pasted?: Partial<Record<Side, readonly PastedBody[]>>,
): SideInfos {
  const lf = normalizeLineEndings(log);
  const formatId = inferReplayFormatId({ log: lf });
  if (generatedTeam(formatId)) return raw;
  const next: SideInfos = { ...raw };
  let changed = false;
  for (const side of SIDES) {
    const lacking = missingBodies(lf, raw[side].pokemon.length, side);
    const filled = lacking > 0 ? filledSide(raw[side], lacking, lf, formatId, usageStats, pasted?.[side] ?? []) : null;
    if (filled) {
      next[side] = filled;
      changed = true;
    }
  }
  return changed ? next : raw;
}
