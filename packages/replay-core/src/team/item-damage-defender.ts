import { calcGenerationFor, calcModOf, type CalcGeneration } from '../calc-gen.ts';
import type { LoggedHit, RevealedPokemonInfo } from '../types.ts';
import type { DefenderRole } from './damage-ruleouts.ts';
import { natureOf } from '../spreads/ladder.ts';
import { evBudget, onBudgetScale, type EvBudget } from '../spreads/ev-budget.ts';
import { toId } from '../ids.ts';
import {
  abilityName, defenderOf, defenderOptions, extremes, holderOptions, itemName, judgeable, mayHave, MISS_MARGIN, missBeyond, offenseStat, rolls, shown, variantsOf,
  hitDex, type AbilityVariant, type CalcOptions, type GenDex, type HitTeams, type Spread, type Stat,
} from './item-damage-shared.ts';

// The softest body: no EVs, IV 0 and a lowering nature, the item on, every ability the species may have.
// The calculator takes the Assault Vest for special hits only, the Eviolite for both defenses (an unevolved species).
const DEFENDER_ITEMS = ['assaultvest', 'eviolite'];

// null when the holder's own stats feed the move (Foul Play): the hit cannot be judged.
function defenseStat(dex: GenDex, moveId: string): Stat | null {
  const move = dex.moves.get(moveId);
  if (move.overrideOffensivePokemon === 'target') return null;
  if (move.overrideDefensiveStat) return move.overrideDefensiveStat as Stat;
  return move.category === 'Physical' ? 'def' : 'spd';
}

function bodyExtremes(dex: GenDex, stat: Stat, budget: EvBudget): { soft: Spread; hard: Spread } {
  return {
    hard: { evs: { hp: budget.perStat, [stat]: budget.perStat }, ivs: {}, nature: natureOf(dex, stat, 'spe') },
    soft: { evs: {}, ivs: budget.statPoints ? {} : { hp: 0, [stat]: 0 }, nature: natureOf(dex, 'spe', stat) },
  };
}

interface TakenHit {
  attacker: RevealedPokemonInfo;
  hit: LoggedHit;
}

function takenHits(holder: RevealedPokemonInfo, role: DefenderRole, teams: HitTeams): TakenHit[] {
  const dealers = teams[role.side === 'p1' ? 'p2' : 'p1'].pokemon;
  return dealers.flatMap(attacker => (attacker.hits ?? [])
    .filter(hit => hit.defender.side === role.side && toId(defenderOf(hitDex(hit), teams[role.side], hit.defender.species)?.species ?? '') === toId(holder.species))
    .map(hit => ({ attacker, hit })));
}

interface DefenderContext {
  hit: LoggedHit;
  gen: CalcGeneration;
  holders: AbilityVariant[];
  spreads: { soft: Spread; hard: Spread };
  attackers: CalcOptions[];
}

function holderAbilities(dex: GenDex, holder: RevealedPokemonInfo, hit: LoggedHit): AbilityVariant[] {
  const known = abilityName(dex, hit.defender.ability) || (shown(holder.ability) ? holder.ability.value : '');
  const ruled = holder.ruledOut?.abilities ?? [];
  const abilities = mayHave(dex, hit.defender.species, known).filter(ability => known || !ruled.includes(toId(ability)));
  return variantsOf(abilities.length > 0 ? abilities : [''], hit.defender);
}

function attackerKey(ctx: Omit<DefenderContext, 'attackers'>, attacker: CalcOptions): string {
  const rolled = (spread: Spread) => rolls(ctx.gen, ctx.hit, attacker, holderOptions(spread, ctx.holders[0], ''));
  return [rolled(ctx.spreads.soft), rolled(ctx.spreads.hard)].map(range => (range ? `${range.min}:${range.max}` : '-')).join('|');
}

function attackerSpreads(dex: GenDex, attacker: RevealedPokemonInfo, stat: Stat | null, budget: EvBudget): Spread[] {
  if (['revealed', 'manual', 'sheet'].includes(attacker.evs.source)) {
    return [{ evs: onBudgetScale(attacker.evs.value, budget), ivs: attacker.ivs?.value ?? {}, nature: attacker.nature?.value || 'Hardy' }];
  }
  const { strong, weak } = extremes(dex, stat, budget);
  return [strong, weak];
}

function attackerItemRange(
  dex: GenDex, attacker: RevealedPokemonInfo, hit: LoggedHit, built: CalcOptions, attackerItems: DefenderRole['attackerItems'],
): (string | undefined)[] {
  if (hit.attacker.itemChanged || hit.attacker.held || shown(attacker.item)) return [built.item];
  const ruled = attacker.ruledOut?.items ?? [];
  const named = attackerItems(attacker).map(name => itemName(dex, toId(name))).filter(name => name && !ruled.includes(toId(name)));
  return [...new Set([built.item, undefined, ...named])];
}

function attackerAbilities(dex: GenDex, attacker: RevealedPokemonInfo, hit: LoggedHit, built: CalcOptions): AbilityVariant[] {
  const ruled = attacker.ruledOut?.abilities ?? [];
  const possible = hit.attacker.ability || shown(attacker.ability) ? [] : mayHave(dex, hit.attacker.species, '').filter(ability => !ruled.includes(toId(ability)));
  return variantsOf(possible.length > 0 ? possible : [built.ability ?? ''], hit.attacker);
}

function attackerVariants(
  dex: GenDex, attacker: RevealedPokemonInfo, ctx: Omit<DefenderContext, 'attackers'>, attackerItems: DefenderRole['attackerItems'],
): CalcOptions[] {
  const budget = evBudget(toId(ctx.hit.format));
  const built = defenderOptions(dex, attacker, ctx.hit.attacker, budget);
  const items = attackerItemRange(dex, attacker, ctx.hit, built, attackerItems);
  const abilities = attackerAbilities(dex, attacker, ctx.hit, built);
  const distinct = new Map<string, CalcOptions>();
  for (const spread of attackerSpreads(dex, attacker, offenseStat(dex, ctx.hit.move), budget)) {
    for (const option of items.flatMap(item => abilities.map(ability => holderOptions(spread, ability, item ?? '')))) {
      const key = attackerKey(ctx, option);
      if (!distinct.has(key)) distinct.set(key, option);
    }
  }
  return [...distinct.values()];
}

function contextOf({ attacker, hit }: TakenHit, holder: RevealedPokemonInfo, role: DefenderRole): DefenderContext | null {
  const dex = hitDex(hit);
  const stat = defenseStat(dex, hit.move);
  if (!stat || hit.defender.itemChanged || hit.defender.held) return null;
  const base = {
    hit, gen: calcGenerationFor(hit.gen, calcModOf(hit.format)), holders: holderAbilities(dex, holder, hit),
    spreads: bodyExtremes(dex, stat, evBudget(toId(hit.format))),
  };
  return { ...base, attackers: attackerVariants(dex, attacker, base, role.attackerItems) };
}

function missOf(ctx: DefenderContext, item: string): number | null {
  const rolled = (spread: Spread) => () => ctx.attackers.flatMap(attacker => ctx.holders.map(variant => rolls(ctx.gen, ctx.hit, attacker, holderOptions(spread, variant, item))));
  return missBeyond(ctx.hit, rolled(ctx.spreads.soft), rolled(ctx.spreads.hard));
}

const modelled = (ctx: DefenderContext, id: string, dex: GenDex) =>
  !!(ctx.gen.items as unknown as { get(id: string): unknown }).get(id) && (id !== 'eviolite' || !!dex.species.get(ctx.hit.defender.species).nfe);

/** The widest miss per candidate, and for no item, over the counted hits (some candidate or no item explains them). */
export function widestMisses(holder: RevealedPokemonInfo, ids: string[], teams: HitTeams, role: DefenderRole): { misses: Map<string, number>; bare: number; counted: number } {
  const misses = new Map(ids.map(id => [id, 1]));
  let bare = 1;
  let counted = 0;
  for (const taken of takenHits(holder, role, teams)) {
    const ctx = judgeable(taken.hit) ? contextOf(taken, holder, role) : null;
    if (!ctx) continue;
    const dex = hitDex(taken.hit);
    const verdicts = ids.filter(id => modelled(ctx, id, dex)).map(id => [id, missOf(ctx, dex.items.get(id).name)] as const);
    const none = missOf(ctx, '');
    if (!verdicts.some(([, miss]) => miss === 1) && none !== 1) continue;
    counted++;
    for (const [id, miss] of verdicts) if (miss !== null && miss > misses.get(id)!) misses.set(id, miss);
    if (none !== null && none > bare) bare = none;
  }
  return { misses, bare, counted };
}

/** The candidates the hits `holder` took refute, as ids; hits that contradict each other decide nothing. */
export function judgeDefenderItems(holder: RevealedPokemonInfo, candidates: string[], teams: HitTeams, role: DefenderRole): string[] {
  // With no hit taken there are no rules to read the item names by, and no verdict either way.
  const first = takenHits(holder, role, teams)[0];
  if (!first) return [];
  const dex = hitDex(first.hit);
  const ids = [...new Set(candidates.map(name => toId(dex.items.get(name).name)))].filter(id => DEFENDER_ITEMS.includes(id));
  if (ids.length === 0) return [];
  const { misses, bare } = widestMisses(holder, ids, teams, role);
  const refuted = [...misses].filter(([, miss]) => miss > MISS_MARGIN).map(([id]) => id);
  const ruled = holder.ruledOut?.items ?? [];
  const contradictory = bare > MISS_MARGIN && [...misses.keys()].every(id => refuted.includes(id) || ruled.includes(id));
  return contradictory ? [] : refuted;
}
