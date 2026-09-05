import type { PokemonSet } from '@pkmn/sim';
import type { SmogonUsageStats } from '../smogon/stats-types.ts';
import type { SmogonSetAssumptions } from '../smogon/sets-lookup.ts';
import { getSpeciesUsageStats } from '../smogon/usage-lookup.ts';
import type { SpeedKnowledgeMap } from '../spreads/scarf.ts';
import type { SpreadCandidate } from '../spreads/ladder.ts';
import { findUserMatch, resolveItemWithout } from './set-resolvers.ts';
import type { KnowledgeSource, OpponentTeamInfo } from '../types.ts';
import { toId } from '../ids.ts';

/**
 * The bridge between the team builder and the solver's Choice Scarf
 * decisions (round 37): what each mon's item and Speed may be assumed to
 * be, and the concrete item a dropped Scarf gives way to.
 */

type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };
type SideTeams = { p1: PokemonSet[] | null; p2: PokemonSet[] | null };

const KNOWN_SOURCES = new Set<KnowledgeSource>(['revealed', 'manual', 'sheet']);

const hasEvs = (set: PokemonSet) => Object.values(set.evs ?? {}).some(value => (value ?? 0) > 0);

/**
 * What the solver may assume per mon: a sheet or pasted set fixes the item
 * (and the spread when it carries EVs; Open Team Sheets omit them),
 * protocol evidence and user edits fix what they revealed, and the usage
 * spreads of the species are the plausible configurations.
 */
export function speedKnowledgeFor(
  infos: SideInfos, knownTeams: SideTeams, usageStats: SmogonUsageStats | null | undefined,
): SpeedKnowledgeMap {
  const knowledge: SpeedKnowledgeMap = new Map();
  for (const side of ['p1', 'p2'] as const) {
    for (const mon of infos[side].pokemon) {
      const sheet = findUserMatch(knownTeams[side], mon.species);
      knowledge.set(`${side}:${toId(mon.species)}`, {
        itemKnown: !!sheet || KNOWN_SOURCES.has(mon.item.source),
        scarfRuledOut: (mon.ruledOut?.items ?? []).includes('choicescarf'),
        spreadKnown: (!!sheet && hasEvs(sheet)) || KNOWN_SOURCES.has(mon.evs.source),
        spreads: (getSpeciesUsageStats(mon.species, usageStats)?.spreads ?? [])
          .map(spread => ({ nature: spread.nature, evs: spread.evs, probability: spread.probability })),
      });
    }
  }
  return knowledge;
}

/** A dropped Scarf ('' from the solver) becomes the build's next item choice, so panel and sim agree. */
export function resolveInferredItems(
  inferred: Map<string, SpreadCandidate>, infos: SideInfos,
  usageStats: SmogonUsageStats | null | undefined, setAssumptions: SmogonSetAssumptions | null | undefined,
): Map<string, SpreadCandidate> {
  const resolved = new Map(inferred);
  for (const [key, candidate] of inferred) {
    if (candidate.item !== '') continue;
    const [side, speciesId] = key.split(':') as ['p1' | 'p2', string];
    const info = infos[side].pokemon.find(mon => toId(mon.species) === speciesId);
    if (!info) continue;
    resolved.set(key, { ...candidate, item: resolveItemWithout(info, usageStats, setAssumptions, 'choicescarf') });
  }
  return resolved;
}
