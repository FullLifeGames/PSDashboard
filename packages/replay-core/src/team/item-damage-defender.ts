import { Dex } from '@pkmn/sim';
import { calcGenerationFor, calcModOf, type CalcGeneration } from '../calc-gen.ts';
import type { LoggedHit, RevealedPokemonInfo } from '../types.ts';
import type { DefenderRole } from './damage-ruleouts.ts';
import { natureOf } from '../spreads/ladder.ts';
import { evBudget, onBudgetScale, type EvBudget } from '../spreads/ev-budget.ts';
import { toId } from '../ids.ts';
import {
  abilityName, defenderOf, defenderOptions, extremes, holderOptions, itemName, judgeable, mayHave, MISS_MARGIN, missBeyond, offenseStat, rolls, shown, variantsOf,
  type AbilityVariant, type CalcOptions, type GenDex, type HitTeams, type Spread, type Stat,
} from './item-damage-shared.ts';

/**
 * The damage judge in the defender's direction (round 69, T169, spec decision 35). A Pokémon whose item is still open took hits;
 * an item that reduces damage falls when a hit is too strong for the softest body that could hold it: no EVs, IV 0 and a
 * lowering nature in HP and the defense the move reads, the item on, every ability the species may have. The judged items are
 * the Assault Vest (the calculator takes it for special hits only) and the Eviolite (both defenses, for a species that can still
 * evolve); an item the calculator's generation lacks (both in Pokémon Champions) is not judged. The attacker is as built, except
 * its unproven item and spread, which are guesses too: the mirror of ruling R18 ranges the item (the one the build gave it, no item
 * and every item the attacker may hold, so a guessed Choice Specs that cancels a Vest exactly refutes nothing) and the offensive
 * spread (its strongest and weakest legal one). Doubt, a spread move and an unreadable move drop the hit as in the attacker's
 * direction (ruling R3); a hit no candidate and no item explains is no evidence.
 */

const DEFENDER_ITEMS = ['assaultvest', 'eviolite'];

/** The stat of the holder the move's damage reads; null when the holder's own stats feed the move (Foul Play) and the hit cannot be judged. */
function defenseStat(dex: GenDex, moveId: string): Stat | null {
  const move = dex.moves.get(moveId);
  if (move.overrideOffensivePokemon === 'target') return null;
  if (move.overrideDefensiveStat) return move.overrideDefensiveStat as Stat;
  return move.category === 'Physical' ? 'def' : 'spd';
}

/** The softest and the hardest legal body for that defense: the format's per-stat cap in HP and the defense, and its opposite. */
function bodyExtremes(stat: Stat, budget: EvBudget): { soft: Spread; hard: Spread } {
  return {
    hard: { evs: { hp: budget.perStat, [stat]: budget.perStat }, ivs: {}, nature: natureOf(stat, 'spe') },
    soft: { evs: {}, ivs: budget.statPoints ? {} : { hp: 0, [stat]: 0 }, nature: natureOf('spe', stat) },
  };
}

interface TakenHit {
  attacker: RevealedPokemonInfo;
  hit: LoggedHit;
}

/** The hits the other side dealt into this holder, as its inference recorded them. */
function takenHits(holder: RevealedPokemonInfo, role: DefenderRole, teams: HitTeams): TakenHit[] {
  const dealers = teams[role.side === 'p1' ? 'p2' : 'p1'].pokemon;
  return dealers.flatMap(attacker => (attacker.hits ?? [])
    .filter(hit => hit.defender.side === role.side && toId(defenderOf(teams[role.side], hit.defender.species)?.species ?? '') === toId(holder.species))
    .map(hit => ({ attacker, hit })));
}

interface DefenderContext {
  hit: LoggedHit;
  gen: CalcGeneration;
  holders: AbilityVariant[];
  spreads: { soft: Spread; hard: Spread };
  attackers: CalcOptions[];
}

/** The holder's abilities with their states: the one the log or the user fixed, else each its species may have beside the ruled-out ones. */
function holderAbilities(dex: GenDex, holder: RevealedPokemonInfo, hit: LoggedHit): AbilityVariant[] {
  const known = abilityName(dex, hit.defender.ability) || (shown(holder.ability) ? holder.ability.value : '');
  const ruled = holder.ruledOut?.abilities ?? [];
  const abilities = mayHave(dex, hit.defender.species, known).filter(ability => known || !ruled.includes(toId(ability)));
  return variantsOf(abilities.length > 0 ? abilities : [''], hit.defender);
}

/** The rolls of one attacker configuration against the softest and the hardest body without an item, as a key. */
function attackerKey(ctx: Omit<DefenderContext, 'attackers'>, attacker: CalcOptions): string {
  const rolled = (spread: Spread) => rolls(ctx.gen, ctx.hit, attacker, holderOptions(spread, ctx.holders[0], ''));
  return [rolled(ctx.spreads.soft), rolled(ctx.spreads.hard)].map(range => (range ? `${range.min}:${range.max}` : '-')).join('|');
}

/** The attacker's offense: the spread a sheet or the user fixed, else its strongest and weakest legal spread for the stat the move reads. */
function attackerSpreads(attacker: RevealedPokemonInfo, stat: Stat | null, budget: EvBudget): Spread[] {
  if (['revealed', 'manual', 'sheet'].includes(attacker.evs.source)) {
    return [{ evs: onBudgetScale(attacker.evs.value, budget), ivs: attacker.ivs?.value ?? {}, nature: attacker.nature?.value || 'Hardy' }];
  }
  const { strong, weak } = extremes(stat, budget);
  return [strong, weak];
}

/** The attacker's items: the one the log fixed, else the one built, no item and every item it may hold beside the ruled-out ones. */
function attackerItemRange(
  dex: GenDex, attacker: RevealedPokemonInfo, hit: LoggedHit, built: CalcOptions, attackerItems: DefenderRole['attackerItems'],
): (string | undefined)[] {
  if (hit.attacker.itemChanged || hit.attacker.held || shown(attacker.item)) return [built.item];
  const ruled = attacker.ruledOut?.items ?? [];
  const named = attackerItems(attacker).map(name => itemName(dex, toId(name))).filter(name => name && !ruled.includes(toId(name)));
  return [...new Set([built.item, undefined, ...named])];
}

/** The attacker's abilities with their states: the one fixed, else each its species may have beside the ruled-out ones. */
function attackerAbilities(dex: GenDex, attacker: RevealedPokemonInfo, hit: LoggedHit, built: CalcOptions): AbilityVariant[] {
  const ruled = attacker.ruledOut?.abilities ?? [];
  const possible = hit.attacker.ability || shown(attacker.ability) ? [] : mayHave(dex, hit.attacker.species, '').filter(ability => !ruled.includes(toId(ability)));
  return variantsOf(possible.length > 0 ? possible : [built.ability ?? ''], hit.attacker);
}

/**
 * The attacker with what the log has not shown ranged (the mirror of ruling R18): its item, its offensive spread (its strongest
 * and its weakest legal one, since a built spread is a guess, as the Dragonite of 752624 that hit with Thunderbolt shows) and its
 * ability. Variants that roll alike against the extreme bodies collapse into one, so the common case costs a handful of configurations.
 */
function attackerVariants(
  dex: GenDex, attacker: RevealedPokemonInfo, ctx: Omit<DefenderContext, 'attackers'>, attackerItems: DefenderRole['attackerItems'],
): CalcOptions[] {
  const budget = evBudget(toId(ctx.hit.format));
  const built = defenderOptions(dex, attacker, ctx.hit.attacker, budget);
  const items = attackerItemRange(dex, attacker, ctx.hit, built, attackerItems);
  const abilities = attackerAbilities(dex, attacker, ctx.hit, built);
  const distinct = new Map<string, CalcOptions>();
  for (const spread of attackerSpreads(attacker, offenseStat(dex, ctx.hit.move), budget)) {
    for (const option of items.flatMap(item => abilities.map(ability => holderOptions(spread, ability, item ?? '')))) {
      const key = attackerKey(ctx, option);
      if (!distinct.has(key)) distinct.set(key, option);
    }
  }
  return [...distinct.values()];
}

function contextOf({ attacker, hit }: TakenHit, holder: RevealedPokemonInfo, role: DefenderRole): DefenderContext | null {
  const dex = Dex.forGen(hit.gen);
  const stat = defenseStat(dex, hit.move);
  if (!stat || hit.defender.itemChanged || hit.defender.held) return null;
  const base = {
    hit, gen: calcGenerationFor(hit.gen, calcModOf(hit.format)), holders: holderAbilities(dex, holder, hit),
    spreads: bodyExtremes(stat, evBudget(toId(hit.format))),
  };
  return { ...base, attackers: attackerVariants(dex, attacker, base, role.attackerItems) };
}

/** By what factor the hit lies outside the hull the holder's configurations give with this item ('' for none); 1 when some explains it. */
function missOf(ctx: DefenderContext, item: string): number | null {
  const rolled = (spread: Spread) => () => ctx.attackers.flatMap(attacker => ctx.holders.map(variant => rolls(ctx.gen, ctx.hit, attacker, holderOptions(spread, variant, item))));
  return missBeyond(ctx.hit, rolled(ctx.spreads.soft), rolled(ctx.spreads.hard));
}

/** Whether the item acts on this holder: the calculator's generation lists it, and an Eviolite needs a species that can evolve. */
const modelled = (ctx: DefenderContext, id: string, dex: GenDex) =>
  !!(ctx.gen.items as unknown as { get(id: string): unknown }).get(id) && (id !== 'eviolite' || !!dex.species.get(ctx.hit.defender.species).nfe);

/** The candidates the hits refute at their widest miss, and no item at its: what the counted hits (some candidate or no item explains them) leave of each. */
export function widestMisses(holder: RevealedPokemonInfo, ids: string[], teams: HitTeams, role: DefenderRole): { misses: Map<string, number>; bare: number; counted: number } {
  const misses = new Map(ids.map(id => [id, 1]));
  let bare = 1;
  let counted = 0;
  for (const taken of takenHits(holder, role, teams)) {
    const ctx = judgeable(taken.hit) ? contextOf(taken, holder, role) : null;
    if (!ctx) continue;
    const dex = Dex.forGen(taken.hit.gen);
    const verdicts = ids.filter(id => modelled(ctx, id, dex)).map(id => [id, missOf(ctx, Dex.items.get(id).name)] as const);
    const none = missOf(ctx, '');
    if (!verdicts.some(([, miss]) => miss === 1) && none !== 1) continue;
    counted++;
    for (const [id, miss] of verdicts) if (miss !== null && miss > misses.get(id)!) misses.set(id, miss);
    if (none !== null && none > bare) bare = none;
  }
  return { misses, bare, counted };
}

/**
 * The candidates the hits `holder` took refute, as ids: a miss beyond the margin. Hits that between them refute every candidate
 * the log still allows, and no item as well, contradict each other, and none of them decides.
 */
export function judgeDefenderItems(holder: RevealedPokemonInfo, candidates: string[], teams: HitTeams, role: DefenderRole): string[] {
  const ids = [...new Set(candidates.map(name => toId(Dex.items.get(name).name)))].filter(id => DEFENDER_ITEMS.includes(id));
  if (ids.length === 0) return [];
  const { misses, bare } = widestMisses(holder, ids, teams, role);
  const refuted = [...misses].filter(([, miss]) => miss > MISS_MARGIN).map(([id]) => id);
  const ruled = holder.ruledOut?.items ?? [];
  const contradictory = bare > MISS_MARGIN && [...misses.keys()].every(id => refuted.includes(id) || ruled.includes(id));
  return contradictory ? [] : refuted;
}
