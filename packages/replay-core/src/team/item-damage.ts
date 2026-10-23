import type { LoggedHit, OpponentTeamInfo, RevealedPokemonInfo } from '../types.ts';
import { calcGenerationFor, calcModOf, type CalcGeneration } from '../calc-gen.ts';
import type { ItemDamageJudge } from './damage-ruleouts.ts';
import { evBudget, type EvBudget } from '../spreads/ev-budget.ts';
import { toId } from '../ids.ts';
import { judgeDefenderItems } from './item-damage-defender.ts';
import {
  abilityName, defenderOf, defenderOptions, extremes, hitDex, holderOptions, judgeable, mayHave, MISS_MARGIN, missBeyond, offenseStat, rolls, shown, variantsOf,
  type AbilityVariant, type CalcOptions, type GenDex, type Spread,
} from './item-damage-shared.ts';

/**
 * The damage judge (round 67, T130, spec decision 18). An item candidate
 * falls when, against the defender as the panel builds it, no allowed spread
 * of the holder and no ability it may have lets the calculator reach the hit
 * the log shows, or stay under it. Allowed means legal: the stat the move
 * reads from no EVs, IV 0 and a lowering nature up to the format's cap, IV 31
 * and a raising nature (ruling R1: pair consistency, the way
 * corroborateChoiceItem judges a Choice item against the built defender).
 * The defender's item and ability count as built only where the log showed
 * them; a guessed one is ranged with no item and with the species' other
 * abilities (ruling R18: a guessed Assault Vest ruled out 649664's Keldeo's
 * Choice Scarf). A hit counts only when some candidate, or no item, explains
 * it; any doubt drops the hit (ruling R3). The app reaches this module only
 * through the inference's dynamic import, so the entry chunk stays free of the
 * calculator.
 */

interface HitContext {
  hit: LoggedHit;
  gen: CalcGeneration;
  /** The format's spread scale: Stat Points in a Champions game. */
  budget: EvBudget;
  abilities: AbilityVariant[];
  spreads: { strong: Spread; weak: Spread };
  defenders: CalcOptions[];
}

/**
 * By what factor the hit lies outside the hull the holder's allowed
 * configurations give with this item, after the slack: 1 when some
 * configuration explains it, above 1 by how far it misses (a hit too strong
 * reads observed / max, one too weak min / observed); null when the
 * calculator cannot judge.
 */
function missOf(ctx: HitContext, item: string): number | null {
  const { hit, gen, abilities, spreads, defenders } = ctx;
  const pairs = defenders.flatMap(defender => abilities.map(ability => ({ defender, ability })));
  const rolled = (spread: Spread) => () => pairs.map(({ defender, ability }) => rolls(gen, hit, holderOptions(spread, ability, item), defender));
  return missBeyond(hit, rolled(spreads.strong), rolled(spreads.weak));
}

/** The rolls of the holder's strong spreads without an item against one defender variant, as a key. */
function variantKey(ctx: Omit<HitContext, 'defenders'>, defender: CalcOptions): string {
  return ctx.abilities.map(ability => {
    const range = rolls(ctx.gen, ctx.hit, holderOptions(ctx.spreads.strong, ability, ''), defender);
    return range ? `${range.min}:${range.max}` : '-';
  }).join('|');
}

/**
 * The defender as built, with what the log has not shown ranged (ruling
 * R18): no item beside a guessed one, each ability the species may have
 * beside a guessed one. Variants that give the holder's strong spreads the
 * same rolls collapse into one, so the common case costs one configuration.
 */
function defenderVariants(dex: GenDex, info: RevealedPokemonInfo, ctx: Omit<HitContext, 'defenders'>): CalcOptions[] {
  const party = ctx.hit.defender;
  const built = defenderOptions(dex, info, party, ctx.budget);
  const itemShown = party.itemChanged || !!party.held || shown(info.item);
  const items = itemShown || !built.item ? [built.item] : [built.item, undefined];
  const ruled = info.ruledOut?.abilities ?? [];
  const possible = party.ability || shown(info.ability) ? []
    : mayHave(dex, party.species, '').filter(ability => !ruled.includes(toId(ability)));
  const abilities = possible.length > 0 ? possible : [built.ability];
  const distinct = new Map<string, CalcOptions>();
  for (const option of items.flatMap(item => abilities.map(ability => ({ ...built, item, ability })))) {
    const key = variantKey(ctx, option);
    if (!distinct.has(key)) distinct.set(key, option);
  }
  return [...distinct.values()];
}

function contextOf(attacker: RevealedPokemonInfo, hit: LoggedHit, teams: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }): HitContext | null {
  const dex = hitDex(hit);
  const info = defenderOf(dex, teams[hit.defender.side], hit.defender.species);
  if (!info || info.evs.source === 'unknown') return null;
  const known = attacker.ability.source === 'revealed' || attacker.ability.source === 'manual'
    ? attacker.ability.value : abilityName(dex, hit.attacker.ability);
  const ruled = attacker.ruledOut?.abilities ?? [];
  const abilities = mayHave(dex, hit.attacker.species, known).filter(ability => known || !ruled.includes(toId(ability)));
  const budget = evBudget(toId(hit.format));
  const base = {
    hit, gen: calcGenerationFor(hit.gen, calcModOf(hit.format)), budget,
    abilities: variantsOf(abilities.length > 0 ? abilities : [''], hit.attacker), spreads: extremes(dex, offenseStat(dex, hit.move), budget),
  };
  return { ...base, defenders: defenderVariants(dex, info, base) };
}

/**
 * Per candidate id (item names in, ids out), the widest factor by which a
 * counted hit misses its hull (1: every hit explained), and the same for no
 * item. A hit counts only when some candidate, or no item, explains it; the
 * rest drop out as unexplained (an unmodelled context, never evidence).
 */
export function itemMisses(
  attacker: RevealedPokemonInfo, candidates: string[], teams: { p1: OpponentTeamInfo; p2: OpponentTeamInfo },
): { misses: Map<string, number>; bare: number } {
  // Without a logged hit there are no rules to read the names by, and no verdict either way.
  const first = attacker.hits?.[0];
  if (!first) return { misses: new Map(), bare: 1 };
  const dex = hitDex(first);
  const ids = [...new Set(candidates.map(name => dex.items.get(name)).filter(item => item.exists).map(item => item.id as string))];
  const misses = new Map(ids.map(id => [id, 1]));
  let bare = 1;
  for (const hit of attacker.hits ?? []) {
    if (!judgeable(hit)) continue;
    const ctx = contextOf(attacker, hit, teams);
    if (!ctx) continue;
    const verdicts = ids.map(id => [id, missOf(ctx, hitDex(hit).items.get(id).name)] as const);
    const none = missOf(ctx, '');
    if (!verdicts.some(([, miss]) => miss === 1) && none !== 1) continue;
    for (const [id, miss] of verdicts) if (miss !== null && miss > misses.get(id)!) misses.set(id, miss);
    if (none !== null && none > bare) bare = none;
  }
  return { misses, bare };
}

/**
 * The candidates a logged hit of `holder` dealt (attacker role) or took (defender role, T169) refutes, as ids: a miss beyond
 * the margin. Hits that between them refute every candidate the log still
 * allows, and no item as well, contradict each other, and none of them
 * decides (an item the log already ruled out counts as refuted).
 */
export const judgeItemsByDamage: ItemDamageJudge = (holder, candidates, teams, role) => {
  if (role) return judgeDefenderItems(holder, candidates, teams, role);
  const { misses, bare } = itemMisses(holder, candidates, teams);
  const refuted = [...misses].filter(([, miss]) => miss > MISS_MARGIN).map(([id]) => id);
  const ruled = holder.ruledOut?.items ?? [];
  const contradictory = bare > MISS_MARGIN && [...misses.keys()].every(id => refuted.includes(id) || ruled.includes(id));
  return contradictory ? [] : refuted;
};
