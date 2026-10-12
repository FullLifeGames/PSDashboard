import { calculate, Field, Move, Pokemon } from '@smogon/calc';
import { buildCalcPokemon, calcKnowsMove } from '../calc-build.ts';
import type { CalcGeneration } from '../calc-gen.ts';
import { Dex } from '@pkmn/sim';
import type { HitParty, LoggedHit, OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo } from '../types.ts';
import { itemSetValue } from '../team-info.ts';
import { abilitiesAreFree } from './dex-legal.ts';
import type { EvBudget } from '../spreads/ev-budget.ts';
import { onBudgetScale } from '../spreads/ev-budget.ts';
import { natureOf } from '../spreads/ladder.ts';
import { toId } from '../ids.ts';

/**
 * What the two directions of the damage judge share (round 67, T130; round 69, T169): the constants of the hull test, the
 * hits fit to judge, the calculator Pokémon of a logged party and the rolls of one configuration. The attacker direction
 * (item-damage.ts) ranges the holder of an item that dealt a hit; the defender direction (item-damage-defender.ts) ranges
 * the holder of an item that took one.
 */

/** HP-bar reading noise: the slack of the spread fit and the Choice-lock check. */
export const OBSERVATION_SLACK = 0.02;
/**
 * A hit must miss a candidate's hull by more than the smallest damage item
 * factor (Muscle Band, Wise Glasses: x1.1): a smaller miss cannot tell an item
 * from the guessed spread of the defender as built (round 67, ruling R12).
 */
export const MISS_MARGIN = 1.1;
/** The calculator's spread targets: its spread factor applies to them in doubles. */
const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes']);
/** Handlers by which an ability changes another Pokémon's damage (Friend Guard, Power Spot, the auras, Ruin). */
const FIELD_DAMAGE_HOOK = /^on(Ally|Any|Foe)(BasePower|ModifyAtk|ModifyDef|ModifySpA|ModifySpD|ModifyDamage)$/;
/** Move handlers that set power, damage or type from state the record does not carry. */
const UNREADABLE_MOVE = ['basePowerCallback', 'damageCallback', 'damage', 'ohko', 'multihit', 'isZ', 'isMax', 'onModifyType', 'onModifyMove'];

export type GenDex = ReturnType<typeof Dex.forGen>;
export type CalcOptions = NonNullable<ConstructorParameters<typeof Pokemon>[2]>;
export type Stat = keyof PokemonEvs;
export interface Spread { evs: Partial<PokemonEvs>; ivs: Partial<PokemonEvs>; nature: string }
export type HitTeams = { p1: OpponentTeamInfo; p2: OpponentTeamInfo };

/** The abilities a Pokémon may have: the known one, else its species'. */
export function mayHave(dex: GenDex, species: string, known: string): string[] {
  if (known) return [known];
  return Object.values(dex.species.get(species).abilities ?? {}).filter((name): name is string => !!name);
}

const touchesOthers = (dex: GenDex, ability: string) =>
  Object.keys(dex.abilities.get(ability)).some(key => FIELD_DAMAGE_HOOK.test(key));
const suppressesWeather = (dex: GenDex, ability: string) =>
  !!(dex.abilities.get(ability) as { suppressWeather?: boolean }).suppressWeather;
/** A move whose damage the record lets the calculator recompute. */
export function readableMove(dex: GenDex, moveId: string): boolean {
  const move = dex.moves.get(moveId) as unknown as Record<string, unknown> & { exists: boolean; category: string };
  return move.exists && move.category !== 'Status' && UNREADABLE_MOVE.every(key => !move[key]);
}

/**
 * The hit is fit to judge: no doubt at the hit, abilities the Dex fixes (a
 * Champions game is judged on its Stat Points, ruling R10), a readable move, no Stellar first use, the
 * holder's own item in play, and nobody else on the field whose possible
 * ability changes the damage or hides the weather.
 */
export function judgeable(hit: LoggedHit): boolean {
  if (hit.doubt || hit.attacker.itemChanged || hit.attacker.tera === 'Stellar') return false;
  if (abilitiesAreFree(`|tier|${hit.format}`)) return false;
  const dex = Dex.forGen(hit.gen);
  if (!readableMove(dex, hit.move)) return false;
  // A Charge doubles the next Electric move, which the calculator does not model.
  if (hit.attacker.charged && dex.moves.get(hit.move).type === 'Electric') return false;
  if (hit.others.some(other => mayHave(dex, other.species, other.ability).some(ability => touchesOthers(dex, ability)))) return false;
  const parties = [hit.attacker, hit.defender, ...hit.others];
  return !hit.weather || !parties.some(party => mayHave(dex, party.species, party.ability).some(ability => suppressesWeather(dex, ability)));
}

/** The defender's entry on its own side: the forme as named, else the entry its base species or battle origin holds. */
export function defenderOf(team: OpponentTeamInfo, forme: string): RevealedPokemonInfo | undefined {
  const exact = team.pokemon.find(mon => toId(mon.species) === toId(forme));
  if (exact) return exact;
  const species = Dex.species.get(forme);
  const origins = [species.baseSpecies, ...([] as string[]).concat(species.battleOnly ?? [])].map(toId);
  return team.pokemon.find(mon => origins.includes(toId(mon.species)));
}

/** The stat the move's damage reads from its user; null when the user's stats do not matter (Foul Play). */
export function offenseStat(dex: GenDex, moveId: string): Stat | null {
  const move = dex.moves.get(moveId);
  if (move.overrideOffensivePokemon === 'target') return null;
  if (move.overrideOffensiveStat) return move.overrideOffensiveStat as Stat;
  return move.category === 'Physical' ? 'atk' : 'spa';
}

/** A calculator Pokémon at the hit's HP. */
export function calcPokemon(gen: CalcGeneration, party: HitParty, options: CalcOptions): Pokemon {
  const mon = buildCalcPokemon(gen, party.species, {
    ...options, level: party.level, boosts: party.boosts, status: (party.status || undefined) as CalcOptions['status'],
    teraType: party.tera as CalcOptions['teraType'], gender: (party.gender || undefined) as CalcOptions['gender'],
    alliesFainted: party.alliesFainted, boostedStat: (party.boostedStat || undefined) as CalcOptions['boostedStat'],
  });
  mon.originalCurHP = Math.max(1, Math.round(party.hp * mon.maxHP()));
  return mon;
}

/** The Dex name of an ability or item the client keeps as an id ('supremeoverlord'): the calculator matches names. */
export const abilityName = (dex: GenDex, id: string) => (id ? dex.abilities.get(id).name : '');
export const itemName = (dex: GenDex, id: string) => (id ? dex.items.get(id).name : '');

/** The defender as the panel builds it, with what the log shows it holding at the hit. */
export function defenderOptions(dex: GenDex, info: RevealedPokemonInfo, party: HitParty, budget: EvBudget): CalcOptions {
  const item = party.itemChanged ? itemName(dex, party.held) : itemName(dex, party.held) || itemSetValue(info.item.value);
  return {
    ability: abilityName(dex, party.ability) || info.ability.value || undefined, item: item || undefined,
    nature: (info.nature?.value || 'Hardy') as CalcOptions['nature'], evs: onBudgetScale(info.evs.value, budget), ivs: info.ivs?.value,
  };
}

/** The calculator's rolls for one configuration, as fractions of the defender's max HP; null when it cannot judge. */
export function rolls(gen: CalcGeneration, hit: LoggedHit, attacker: CalcOptions, defender: CalcOptions): { min: number; max: number } | null {
  try {
    const field = new Field({
      gameType: hit.doubles ? 'Doubles' : 'Singles', weather: (hit.weather || undefined) as never, terrain: (hit.terrain || undefined) as never,
      attackerSide: { isHelpingHand: hit.helpingHand },
      defenderSide: { isReflect: hit.screens.includes('reflect'), isLightScreen: hit.screens.includes('lightscreen'), isAuroraVeil: hit.screens.includes('auroraveil') },
    });
    // A spread move the log shows without [spread] hit one target: no spread factor. The calculator
    // rebuilds the move from its name and overrides, so the target goes in as an override.
    // A move the generation lacks (Pound in Champions' generation 0) builds as a 0-damage Status move: the hit cannot judge.
    if (!calcKnowsMove(gen, hit.move)) return null;
    const named = new Move(gen, hit.move);
    const move = hit.doubles && !hit.spread && SPREAD_TARGETS.has(named.target)
      ? new Move(gen, hit.move, { overrides: { target: 'normal' } })
      : named;
    const target = calcPokemon(gen, hit.defender, defender);
    const result = calculate(gen, calcPokemon(gen, hit.attacker, attacker), target, move, field);
    const damage = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
    const maxHp = target.maxHP();
    return damage.length === 0 || maxHp <= 0 ? null : { min: Math.min(...damage) / maxHp, max: Math.max(...damage) / maxHp };
  } catch {
    return null;
  }
}

export const shown = (field: { source: string }) => field.source === 'revealed' || field.source === 'manual';

/** The calculator's rolls of several configurations, as `rolls` gives them. */
export type Rolled = ({ min: number; max: number } | null)[];

/**
 * By what factor the hit lies outside the hull of the rolls the allowed configurations give, after the slack: 1 when some
 * configuration explains it, above 1 by how far it misses (a hit too strong reads observed / max, one too weak min / observed);
 * null when the calculator cannot judge. The weak configurations are rolled only when the strong ones do not decide.
 */
export function missBeyond(hit: LoggedHit, strong: () => Rolled, weak: () => Rolled): number | null {
  const high = strong();
  if (high.some(range => range === null)) return null;
  const max = Math.max(...high.map(range => range!.max));
  if (hit.observed - OBSERVATION_SLACK > max) return (hit.observed - OBSERVATION_SLACK) / max;
  if (hit.lowerBound) return 1;
  const low = weak();
  if (low.some(range => range === null)) return null;
  const min = Math.min(...low.map(range => range!.min));
  return hit.observed + OBSERVATION_SLACK < min ? min / (hit.observed + OBSERVATION_SLACK) : 1;
}

/** One ability the holder may have, with the state the calculator reads for it. */
export interface AbilityVariant {
  ability: string;
  abilityOn: boolean;
}

/** The holder in one configuration: a spread, an ability with its state, an item ('' for none). */
export const holderOptions = (spread: Spread, { ability, abilityOn }: AbilityVariant, item: string): CalcOptions => ({
  ability: ability || undefined, abilityOn, item: item || undefined, nature: spread.nature as CalcOptions['nature'],
  evs: spread.evs, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...spread.ivs },
});

/**
 * The abilities with their states: Flash Fire and Slow Start as the log shows
 * them; Stakeout both ways, because whether the target counts as new the
 * record cannot say (the simulator reads its active turns).
 */
export function variantsOf(abilities: string[], party: HitParty): AbilityVariant[] {
  return abilities.flatMap(ability => {
    const id = toId(ability);
    if (id === 'stakeout') return [{ ability, abilityOn: false }, { ability, abilityOn: true }];
    return [{ ability, abilityOn: (id === 'flashfire' && party.flashFire) || (id === 'slowstart' && party.slowStart) }];
  });
}

/**
 * The holder's strongest and weakest legal spreads for that stat: the format's per-stat cap (252 EVs, or 32 Stat Points in a
 * Champions game, which has no IVs to lower, so its weak spread keeps IV 31 as the calculator's generation 0 ignores them anyway).
 */
export function extremes(stat: Stat | null, budget: EvBudget): { strong: Spread; weak: Spread } {
  if (!stat) return { strong: { evs: {}, ivs: {}, nature: 'Hardy' }, weak: { evs: {}, ivs: {}, nature: 'Hardy' } };
  const other: Stat = stat === 'atk' ? 'spa' : 'atk';
  return {
    strong: { evs: { [stat]: budget.perStat }, ivs: {}, nature: natureOf(stat, other) },
    weak: { evs: {}, ivs: budget.statPoints ? {} : { [stat]: 0 }, nature: natureOf(other, stat) },
  };
}
