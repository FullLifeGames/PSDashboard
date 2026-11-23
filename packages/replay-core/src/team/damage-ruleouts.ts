import type { SmogonUsageStats } from '../smogon/stats-types.ts';
import { getSpeciesSetAssumption, type SmogonSetAssumptions } from '../smogon/sets-lookup.ts';
import { getSpeciesUsageStats } from '../smogon/usage-lookup.ts';
import { enrichPokemonInfo, enrichTeamInfo, itemSetValue, unknownField } from '../team-info.ts';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '../types.ts';
import { toId } from '../ids.ts';

/** One decision for panel and build: both sides enriched, every open item judged against the hits, the refuted ones ruled out, the side enriched again. */

type SideInfos = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };
type HpTypeResolver = (species: string) => string | null;

/** The holder is the defender of the hits it took: `side` is its side, `attackerItems` the items an unproven attacker of the other side could hold. */
export interface DefenderRole {
  side: 'p1' | 'p2';
  attackerItems: (attacker: RevealedPokemonInfo) => string[];
}

/** The judge's signature: ids of the candidate items that a logged hit refutes (the hits the holder dealt, or with a role the hits it took). */
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

function judged(
  raw: RevealedPokemonInfo, enriched: RevealedPokemonInfo, ctx: JudgeContext, side: 'p1' | 'p2', hpTypeResolver?: HpTypeResolver,
): RevealedPokemonInfo {
  if (!itemOpen(raw)) return enriched;
  const known = raw.ruledOut?.items ?? [];
  const candidates = itemCandidates(enriched, ctx.usageStats, ctx.setAssumptions);
  // Both directions: the hits the Pokemon dealt refute the items that would not have let it deal them, the hits it took the items that would
  // have let it take less. An attacker of the other side whose item is open is ranged over its candidates.
  const role: DefenderRole = { side, attackerItems: mon => itemCandidates(mon, ctx.usageStats, ctx.setAssumptions) };
  const dealt = raw.hits?.length ? ctx.judge(raw, candidates, ctx.first) : [];
  const refuted = [...new Set([...dealt, ...ctx.judge(raw, candidates, ctx.first, role)])].filter(id => !known.includes(id));
  if (refuted.length === 0) return enriched;
  // A guess of the inference itself (the Boots tell) that a hit refutes leaves the item open again.
  const item = refuted.includes(toId(itemSetValue(raw.item.value))) ? unknownField() : raw.item;
  const ruledOut = { abilities: raw.ruledOut?.abilities ?? [], items: [...known, ...refuted] };
  return enrichPokemonInfo({ ...raw, item, ruledOut }, ctx.usageStats, ctx.setAssumptions, hpTypeResolver);
}

/** Both sides enriched as `enrichTeamInfo` does; with a judge, every open item is judged against the other side's first enrichment. */
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
  // The judge comes in as a function: this module stays free of the calculator, which the app's entry chunk reaches.
  if (!judge) return first;
  const ctx: JudgeContext = { first, usageStats, setAssumptions, judge };
  const side = (id: 'p1' | 'p2'): OpponentTeamInfo => ({
    pokemon: raw[id].pokemon.map((mon, index) => judged(mon, first[id].pokemon[index], ctx, id, hpTypeResolvers[id])),
  });
  return { p1: side('p1'), p2: side('p2') };
}
