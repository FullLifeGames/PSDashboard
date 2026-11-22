import type { PokemonSet } from '@pkmn/sim';
import type { SmogonUsageStats } from '../smogon/stats-types.ts';
import type { SmogonSetAssumptions } from '../smogon/sets-lookup.ts';
import { getSpeciesUsageStats } from '../smogon/usage-lookup.ts';
import type { SpeedKnowledgeMap } from '../spreads/scarf.ts';
import type { SpreadCandidate } from '../spreads/ladder.ts';
import { simFormats, type RulesDex } from '../rules-dex.ts';
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
 * The format's Item Clause (round 89, #75): how many Pokémon of a team may hold the same item, undefined when the format has no clause. The log's
 * own `|rule|` line says it first (the game announced it, two spellings: "Limit 1 of each item" and "Limit one of each item"); a log without the
 * line asks the simulator's rule table of the `|tier|`; a Custom Game and a format the simulator does not know have none.
 */
export function itemClauseLimit(log: string): number | undefined {
  const line = log.match(/^\|rule\|Item Clause: Limit (\w+) of each item/m)?.[1];
  if (line) return line === 'one' ? 1 : Number(line) || 1;
  const format = simFormats().get(log.match(/^\|tier\|(.*)$/m)?.[1] ?? '');
  if (!format.exists || format.id.endsWith('customgame')) return undefined;
  try {
    const rules = simFormats().getRuleTable(format);
    return rules.has('itemclause') ? Number(rules.valueRules.get('itemclause')) || 1 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the solver may assume per mon: a sheet or pasted set fixes the item
 * (and the spread when it carries EVs; Open Team Sheets omit them),
 * protocol evidence and user edits fix what they revealed, and the usage
 * spreads of the species are the plausible configurations. Since round 89
 * (#75) the usage items the log does not refute ride along in usage order
 * (`itemOffers`) with the format's Item Clause (`itemLimit`): what the
 * solver's item rung may swap in for a knockout no spread reaches.
 */
export function speedKnowledgeFor(
  infos: SideInfos, knownTeams: SideTeams, usageStats: SmogonUsageStats | null | undefined, itemLimit?: number,
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
        itemOffers: (getSpeciesUsageStats(mon.species, usageStats)?.items ?? []).map(entry => entry.value)
          .filter(name => !!name && !(mon.ruledOut?.items ?? []).includes(toId(name))),
        ...(itemLimit === undefined ? {} : { itemLimit }),
      });
    }
  }
  return knowledge;
}

/** A dropped Scarf ('' from the solver) becomes the build's next item choice, so panel and sim agree. */
export function resolveInferredItems(
  dex: RulesDex, inferred: Map<string, SpreadCandidate>, infos: SideInfos,
  usageStats: SmogonUsageStats | null | undefined, setAssumptions: SmogonSetAssumptions | null | undefined,
): Map<string, SpreadCandidate> {
  const resolved = new Map(inferred);
  for (const [key, candidate] of inferred) {
    if (candidate.item !== '') continue;
    const [side, speciesId] = key.split(':') as ['p1' | 'p2', string];
    const info = infos[side].pokemon.find(mon => toId(mon.species) === speciesId);
    if (!info) continue;
    resolved.set(key, { ...candidate, item: resolveItemWithout(dex, info, usageStats, setAssumptions, 'choicescarf') });
  }
  return resolved;
}
