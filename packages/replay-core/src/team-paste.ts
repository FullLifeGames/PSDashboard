import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, PokemonEvs } from './types.ts';
import { itemSetValue, manualEvs, manualField, manualMove } from './team-info.ts';
import { toId } from './ids.ts';
import { normalizeLineEndings } from './line-endings.ts';

/**
 * Pasted-team reader (G15). Round 72 (T241): the text goes through the library, `Teams.import` of @pkmn/sim (which
 * delegates to @pkmn/sets), and this file keeps only what the app's shape needs on top: the set without a move line is
 * no set (that rejects garbage like "asdf asdf"), at most four moves, `evs` and `ivs` absent when the paste has no such
 * line, the item without its placeholders. packages/replay-core/test/team-text.spec.ts holds the reading to the hand
 * parser it replaced.
 */
export interface PastedSet {
  species: string;
  nickname?: string;
  item?: string;
  ability?: string;
  teraType?: string;
  evs?: PokemonEvs;
  nature?: string;
  ivs?: PokemonEvs;
  level?: number;
  moves: string[];
}

/** The listed stats clamp to [0, max]: the library keeps what the paste says, the sim's own limit comes later. */
function clampStats(stats: Partial<PokemonEvs>, max: number): PokemonEvs {
  const clamp = (value: number | undefined) => Math.min(max, Math.max(0, value ?? 0));
  return { hp: clamp(stats.hp), atk: clamp(stats.atk), def: clamp(stats.def), spa: clamp(stats.spa), spd: clamp(stats.spd), spe: clamp(stats.spe) };
}

function pastedSetOf(set: PokemonSet): PastedSet {
  return {
    species: set.species,
    nickname: set.name && set.name !== set.species ? set.name : undefined,
    item: set.item ? itemSetValue(set.item) || undefined : undefined,
    ability: set.ability || undefined,
    teraType: set.teraType || undefined,
    evs: set.evs ? clampStats(set.evs, 252) : undefined,
    nature: set.nature || undefined,
    ivs: set.ivs ? clampStats(set.ivs, 31) : undefined,
    level: set.level,
    moves: set.moves.slice(0, 4),
  };
}

export function parsePastedTeam(teamText: string): PastedSet[] {
  const team = Teams.import(normalizeLineEndings(teamText)) ?? [];
  // A set with no move line comes back without a `moves` array, whatever the type says.
  return team.filter(set => (set.moves?.length ?? 0) > 0).map(pastedSetOf);
}

/**
 * Overlays a pasted team onto the revealed/guessed team info so the stats
 * panel shows the paste as green "manual" knowledge (G15).
 */
export function applyPastedTeam(
  info: OpponentTeamInfo,
  sets: PastedSet[],
): { info: OpponentTeamInfo; matched: number } {
  const byId = new Map<string, PastedSet>();
  for (const set of sets) {
    byId.set(toId(set.species), set);
    byId.set(toId(set.species.split('-')[0]), set);
  }

  let matched = 0;
  const pokemon = info.pokemon.map(entry => {
    const set = byId.get(toId(entry.species)) ?? byId.get(toId(entry.species.split('-')[0]));
    if (!set) return entry;
    matched += 1;
    return {
      ...entry,
      moves: set.moves.map(manualMove),
      ability: set.ability ? manualField(set.ability) : entry.ability,
      item: set.item ? manualField(set.item) : entry.item,
      teraType: set.teraType ? manualField(set.teraType) : entry.teraType,
      evs: set.evs ? manualEvs(set.evs) : entry.evs,
      nature: set.nature ? manualField(set.nature) : entry.nature,
      ivs: set.ivs ? manualEvs(set.ivs) : entry.ivs,
      level: set.level ?? entry.level,
    };
  });

  return { info: { pokemon }, matched };
}

export function countMatchingSpecies(info: OpponentTeamInfo | null, sets: PastedSet[]): number {
  if (!info) return 0;
  const teamIds = new Set(info.pokemon.flatMap(entry => [toId(entry.species), toId(entry.species.split('-')[0])]));
  return sets.filter(set => teamIds.has(toId(set.species)) || teamIds.has(toId(set.species.split('-')[0]))).length;
}
