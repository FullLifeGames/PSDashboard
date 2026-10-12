import type { SmogonUsageStats } from '../smogon/stats-types.ts';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from '../smogon/sets-lookup.ts';
import { getSpeciesUsageStats } from '../smogon/usage-lookup.ts';
import { enrichPokemonInfo, enrichTeamInfo, itemSetValue, unknownField } from '../team-info.ts';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

/**
 * One decision for panel and build (round 67, T130, spec decision 18): both
 * sides are enriched, then each Pokémon whose item is still open has every
 * item the build could play judged against the hits it dealt into the other
 * side as the panel builds it. The refuted candidates join its rule-outs and
 * it is enriched again, so the existing chain picks the replacement: the
 * next option of a published item slot, else the next set, else the usage
 * majority among the items the log allows. The build reads the same infos.
 * This module stays free of the calculator (the app's entry chunk reaches
 * it); the judge comes in as a function (team/item-damage.ts, loaded lazily
 * with the inference), the way the Hidden Power resolver does.
 */

type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };
type HpTypeResolver = (species: string) => string | null;

/**
 * The holder is the defender of the hits it took (round 69, T169, spec decision 35): `side` is the side it stands on,
 * `attackerItems` gives the items an attacker of the other side whose item is not proven could hold.
 */
export interface DefenderRole {
  side: 'p1' | 'p2';
  attackerItems: (attacker: RevealedPokemonInfo) => string[];
}

/**
 * The judge's signature: the candidate names a logged hit refutes, as ids. Without a role the hits the holder dealt (it is the
 * attacker); with one, the hits it took.
 */
export type ItemDamageJudge = (holder: RevealedPokemonInfo, candidates: string[], teams: SideInfos, role?: DefenderRole) => string[];

/** An item still open to judgment: unknown, only the preview's marker, or a guess. Revealed, manual and sheet items are proof. */
const itemOpen = (info: RevealedPokemonInfo) =>
  info.item.source === 'guessed' || info.item.source === 'unknown' || info.item.value === '(has item)';

/** Every item the build could play: each option of each published set of the species, its usage items, the current guess. */
export function itemCandidates(
  info: RevealedPokemonInfo, usageStats: SmogonUsageStats | null | undefined, setAssumptions: SmogonSetAssumptions | null | undefined,
): string[] {
  const first = getSpeciesSetAssumption(setAssumptions, info.species);
  const published = [first, ...(first?.alternatives ?? [])].flatMap(set => (set?.item ? set.item.options ?? [set.item.value] : []));
  const usage = (getSpeciesUsageStats(info.species, usageStats)?.items ?? []).map(item => item.value);
  const guess = info.item.source === 'guessed' ? [itemSetValue(info.item.value)] : [];
  return [...new Set([...published, ...usage, ...guess].filter(Boolean))];
}

interface JudgeContext {
  first: SideInfos;
  usageStats: SmogonUsageStats | null | undefined;
  setAssumptions: SmogonSetAssumptions | null | undefined;
  judge: ItemDamageJudge;
}

/** One Pokémon after the judgment: its first enrichment, or the enrichment again with the refuted items ruled out. */
function judged(
  raw: RevealedPokemonInfo, enriched: RevealedPokemonInfo, ctx: JudgeContext, side: 'p1' | 'p2', hpTypeResolver?: HpTypeResolver,
): RevealedPokemonInfo {
  if (!itemOpen(raw)) return enriched;
  const known = raw.ruledOut?.items ?? [];
  const candidates = itemCandidates(enriched, ctx.usageStats, ctx.setAssumptions);
  // Both directions (T169): the hits the Pokemon dealt refute the items that would not have let it deal them, the hits it
  // took the items that would have let it take less. An attacker of the other side whose item is open is ranged over its candidates.
  const role: DefenderRole = { side, attackerItems: mon => itemCandidates(mon, ctx.usageStats, ctx.setAssumptions) };
  const dealt = raw.hits?.length ? ctx.judge(raw, candidates, ctx.first) : [];
  const refuted = [...new Set([...dealt, ...ctx.judge(raw, candidates, ctx.first, role)])].filter(id => !known.includes(id));
  if (refuted.length === 0) return enriched;
  // A guess of the inference itself (the Boots tell) that a hit refutes leaves the item open again.
  const item = refuted.includes(toId(itemSetValue(raw.item.value))) ? unknownField() : raw.item;
  const ruledOut = { abilities: raw.ruledOut?.abilities ?? [], items: [...known, ...refuted] };
  return enrichPokemonInfo({ ...raw, item, ruledOut }, ctx.usageStats, ctx.setAssumptions, hpTypeResolver);
}

/**
 * Both sides enriched as `enrichTeamInfo` does; with a judge, every open
 * item is judged against the other side's first enrichment (pair
 * consistency, ruling R1). Without a judge the result equals two separate
 * `enrichTeamInfo` calls.
 */
export function enrichTeamInfos(
  raw: SideInfos,
  usageStats: SmogonUsageStats | null | undefined,
  setAssumptions: SmogonSetAssumptions | null | undefined,
  hpTypeResolvers: { p1?: HpTypeResolver; p2?: HpTypeResolver } = {},
  judge?: ItemDamageJudge,
): SideInfos {
  const first: SideInfos = {
    p1: enrichTeamInfo(raw.p1, usageStats, setAssumptions, hpTypeResolvers.p1),
    p2: enrichTeamInfo(raw.p2, usageStats, setAssumptions, hpTypeResolvers.p2),
  };
  if (!judge) return first;
  const ctx: JudgeContext = { first, usageStats, setAssumptions, judge };
  const side = (id: 'p1' | 'p2'): OpponentTeamInfo => ({
    pokemon: raw[id].pokemon.map((mon, index) => judged(mon, first[id].pokemon[index], ctx, id, hpTypeResolvers[id])),
  });
  return { p1: side('p1'), p2: side('p2') };
}
