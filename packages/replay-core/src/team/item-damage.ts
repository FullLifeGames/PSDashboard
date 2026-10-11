import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { Dex } from '@pkmn/sim';
import type { HitParty, LoggedHit, OpponentTeamInfo, PokemonEvs, RevealedPokemonInfo } from '../types.ts';
import { itemSetValue } from '../team-info.ts';
import { abilitiesAreFree } from './dex-legal.ts';
import type { ItemDamageJudge } from './damage-ruleouts.ts';
import { natureOf } from '../spreads/ladder.ts';
import { toId } from '../ids.ts';

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

/** HP-bar reading noise: the slack of the spread fit and the Choice-lock check. */
const OBSERVATION_SLACK = 0.02;
/**
 * A hit must miss a candidate's hull by more than the smallest damage item
 * factor (Muscle Band, Wise Glasses: x1.1): a smaller miss cannot tell an item
 * from the guessed spread of the defender as built (round 67, ruling R12).
 */
const MISS_MARGIN = 1.1;
const MAX_EVS = 252;
/** The calculator's spread targets: its spread factor applies to them in doubles. */
const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes']);
/** Handlers by which an ability changes another Pokémon's damage (Friend Guard, Power Spot, the auras, Ruin). */
const FIELD_DAMAGE_HOOK = /^on(Ally|Any|Foe)(BasePower|ModifyAtk|ModifyDef|ModifySpA|ModifySpD|ModifyDamage)$/;
/** Move handlers that set power, damage or type from state the record does not carry. */
const UNREADABLE_MOVE = ['basePowerCallback', 'damageCallback', 'damage', 'ohko', 'multihit', 'isZ', 'isMax', 'onModifyType', 'onModifyMove'];

type GenDex = ReturnType<typeof Dex.forGen>;
type CalcGen = ReturnType<typeof Generations.get>;
type CalcOptions = NonNullable<ConstructorParameters<typeof Pokemon>[2]>;
type Stat = keyof PokemonEvs;
interface Spread { evs: Partial<PokemonEvs>; ivs: Partial<PokemonEvs>; nature: string }

/** The abilities a Pokémon may have: the known one, else its species'. */
function mayHave(dex: GenDex, species: string, known: string): string[] {
  if (known) return [known];
  return Object.values(dex.species.get(species).abilities ?? {}).filter((name): name is string => !!name);
}

const touchesOthers = (dex: GenDex, ability: string) =>
  Object.keys(dex.abilities.get(ability)).some(key => FIELD_DAMAGE_HOOK.test(key));
const suppressesWeather = (dex: GenDex, ability: string) =>
  !!(dex.abilities.get(ability) as { suppressWeather?: boolean }).suppressWeather;

/** A move whose damage the record lets the calculator recompute. */
function readableMove(dex: GenDex, moveId: string): boolean {
  const move = dex.moves.get(moveId) as unknown as Record<string, unknown> & { exists: boolean; category: string };
  return move.exists && move.category !== 'Status' && UNREADABLE_MOVE.every(key => !move[key]);
}

/**
 * The hit is fit to judge: no doubt at the hit, abilities the Dex fixes, not
 * a Champions game (ruling R10), a readable move, no Stellar first use, the
 * holder's own item in play, and nobody else on the field whose possible
 * ability changes the damage or hides the weather.
 */
function judgeable(hit: LoggedHit): boolean {
  if (hit.doubt || hit.attacker.itemChanged || hit.attacker.tera === 'Stellar') return false;
  if (/champions/i.test(hit.format) || abilitiesAreFree(`|tier|${hit.format}`)) return false;
  const dex = Dex.forGen(hit.gen);
  if (!readableMove(dex, hit.move)) return false;
  // A Charge doubles the next Electric move, which the calculator does not model.
  if (hit.attacker.charged && dex.moves.get(hit.move).type === 'Electric') return false;
  if (hit.others.some(other => mayHave(dex, other.species, other.ability).some(ability => touchesOthers(dex, ability)))) return false;
  const parties = [hit.attacker, hit.defender, ...hit.others];
  return !hit.weather || !parties.some(party => mayHave(dex, party.species, party.ability).some(ability => suppressesWeather(dex, ability)));
}

/** The defender's entry on its own side: the forme as named, else the entry its base species or battle origin holds. */
function defenderOf(team: OpponentTeamInfo, forme: string): RevealedPokemonInfo | undefined {
  const exact = team.pokemon.find(mon => toId(mon.species) === toId(forme));
  if (exact) return exact;
  const species = Dex.species.get(forme);
  const origins = [species.baseSpecies, ...([] as string[]).concat(species.battleOnly ?? [])].map(toId);
  return team.pokemon.find(mon => origins.includes(toId(mon.species)));
}

/** The stat the move's damage reads from its user; null when the user's stats do not matter (Foul Play). */
function offenseStat(dex: GenDex, moveId: string): Stat | null {
  const move = dex.moves.get(moveId);
  if (move.overrideOffensivePokemon === 'target') return null;
  if (move.overrideOffensiveStat) return move.overrideOffensiveStat as Stat;
  return move.category === 'Physical' ? 'atk' : 'spa';
}

/** The holder's strongest and weakest legal spreads for that stat. */
function extremes(stat: Stat | null): { strong: Spread; weak: Spread } {
  if (!stat) return { strong: { evs: {}, ivs: {}, nature: 'Hardy' }, weak: { evs: {}, ivs: {}, nature: 'Hardy' } };
  const other: Stat = stat === 'atk' ? 'spa' : 'atk';
  return {
    strong: { evs: { [stat]: MAX_EVS }, ivs: {}, nature: natureOf(stat, other) },
    weak: { evs: {}, ivs: { [stat]: 0 }, nature: natureOf(other, stat) },
  };
}

/** A calculator Pokémon at the hit's HP. */
function calcPokemon(gen: CalcGen, party: HitParty, options: CalcOptions): Pokemon {
  const mon = new Pokemon(gen, party.species, {
    ...options, level: party.level, boosts: party.boosts, status: (party.status || undefined) as CalcOptions['status'],
    teraType: party.tera as CalcOptions['teraType'], gender: (party.gender || undefined) as CalcOptions['gender'],
    alliesFainted: party.alliesFainted, boostedStat: (party.boostedStat || undefined) as CalcOptions['boostedStat'],
  });
  mon.originalCurHP = Math.max(1, Math.round(party.hp * mon.maxHP()));
  return mon;
}

/** The Dex name of an ability or item the client keeps as an id ('supremeoverlord'): the calculator matches names. */
const abilityName = (dex: GenDex, id: string) => (id ? dex.abilities.get(id).name : '');
const itemName = (dex: GenDex, id: string) => (id ? dex.items.get(id).name : '');

/** The defender as the panel builds it, with what the log shows it holding at the hit. */
function defenderOptions(dex: GenDex, info: RevealedPokemonInfo, party: HitParty): CalcOptions {
  const item = party.itemChanged ? itemName(dex, party.held) : itemName(dex, party.held) || itemSetValue(info.item.value);
  return {
    ability: abilityName(dex, party.ability) || info.ability.value || undefined, item: item || undefined,
    nature: (info.nature?.value || 'Hardy') as CalcOptions['nature'], evs: info.evs.value, ivs: info.ivs?.value,
  };
}

/** The calculator's rolls for one configuration, as fractions of the defender's max HP; null when it cannot judge. */
function rolls(gen: CalcGen, hit: LoggedHit, attacker: CalcOptions, defender: CalcOptions): { min: number; max: number } | null {
  try {
    const field = new Field({
      gameType: hit.doubles ? 'Doubles' : 'Singles', weather: (hit.weather || undefined) as never, terrain: (hit.terrain || undefined) as never,
      attackerSide: { isHelpingHand: hit.helpingHand },
      defenderSide: { isReflect: hit.screens.includes('reflect'), isLightScreen: hit.screens.includes('lightscreen'), isAuroraVeil: hit.screens.includes('auroraveil') },
    });
    // A spread move the log shows without [spread] hit one target: no spread factor. The calculator
    // rebuilds the move from its name and overrides, so the target goes in as an override.
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

/** One ability the holder may have, with the state the calculator reads for it. */
interface AbilityVariant {
  ability: string;
  abilityOn: boolean;
}

interface HitContext {
  hit: LoggedHit;
  gen: CalcGen;
  abilities: AbilityVariant[];
  spreads: { strong: Spread; weak: Spread };
  defenders: CalcOptions[];
}

/** The holder in one configuration: a spread, an ability with its state, an item ('' for none). */
const holderOptions = (spread: Spread, { ability, abilityOn }: AbilityVariant, item: string): CalcOptions => ({
  ability: ability || undefined, abilityOn, item: item || undefined, nature: spread.nature as CalcOptions['nature'],
  evs: spread.evs, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...spread.ivs },
});

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
  const strong = pairs.map(({ defender, ability }) => rolls(gen, hit, holderOptions(spreads.strong, ability, item), defender));
  if (strong.some(range => range === null)) return null;
  const max = Math.max(...strong.map(range => range!.max));
  if (hit.observed - OBSERVATION_SLACK > max) return (hit.observed - OBSERVATION_SLACK) / max;
  if (hit.lowerBound) return 1;
  const weak = pairs.map(({ defender, ability }) => rolls(gen, hit, holderOptions(spreads.weak, ability, item), defender));
  if (weak.some(range => range === null)) return null;
  const min = Math.min(...weak.map(range => range!.min));
  return hit.observed + OBSERVATION_SLACK < min ? min / (hit.observed + OBSERVATION_SLACK) : 1;
}

/**
 * The abilities with their states: Flash Fire and Slow Start as the log shows
 * them; Stakeout both ways, because whether the target counts as new the
 * record cannot say (the simulator reads its active turns).
 */
function variantsOf(abilities: string[], party: HitParty): AbilityVariant[] {
  return abilities.flatMap(ability => {
    const id = toId(ability);
    if (id === 'stakeout') return [{ ability, abilityOn: false }, { ability, abilityOn: true }];
    return [{ ability, abilityOn: (id === 'flashfire' && party.flashFire) || (id === 'slowstart' && party.slowStart) }];
  });
}

const shown = (field: { source: string }) => field.source === 'revealed' || field.source === 'manual';

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
  const built = defenderOptions(dex, info, party);
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
  const info = defenderOf(teams[hit.defender.side], hit.defender.species);
  if (!info || info.evs.source === 'unknown') return null;
  const dex = Dex.forGen(hit.gen);
  const known = attacker.ability.source === 'revealed' || attacker.ability.source === 'manual'
    ? attacker.ability.value : abilityName(dex, hit.attacker.ability);
  const ruled = attacker.ruledOut?.abilities ?? [];
  const abilities = mayHave(dex, hit.attacker.species, known).filter(ability => known || !ruled.includes(toId(ability)));
  const base = {
    hit, gen: Generations.get(Math.min(9, Math.max(1, hit.gen)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9),
    abilities: variantsOf(abilities.length > 0 ? abilities : [''], hit.attacker), spreads: extremes(offenseStat(dex, hit.move)),
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
  const ids = [...new Set(candidates.map(name => Dex.items.get(name)).filter(item => item.exists).map(item => item.id as string))];
  const misses = new Map(ids.map(id => [id, 1]));
  let bare = 1;
  for (const hit of attacker.hits ?? []) {
    if (!judgeable(hit)) continue;
    const ctx = contextOf(attacker, hit, teams);
    if (!ctx) continue;
    const verdicts = ids.map(id => [id, missOf(ctx, Dex.items.get(id).name)] as const);
    const none = missOf(ctx, '');
    if (!verdicts.some(([, miss]) => miss === 1) && none !== 1) continue;
    for (const [id, miss] of verdicts) if (miss !== null && miss > misses.get(id)!) misses.set(id, miss);
    if (none !== null && none > bare) bare = none;
  }
  return { misses, bare };
}

/**
 * The candidates a logged hit of `attacker` refutes, as ids: a miss beyond
 * the margin. Hits that between them refute every candidate the log still
 * allows, and no item as well, contradict each other, and none of them
 * decides (an item the log already ruled out counts as refuted).
 */
export const judgeItemsByDamage: ItemDamageJudge = (attacker, candidates, teams) => {
  const { misses, bare } = itemMisses(attacker, candidates, teams);
  const refuted = [...misses].filter(([, miss]) => miss > MISS_MARGIN).map(([id]) => id);
  const ruled = attacker.ruledOut?.items ?? [];
  const contradictory = bare > MISS_MARGIN && [...misses.keys()].every(id => refuted.includes(id) || ruled.includes(id));
  return contradictory ? [] : refuted;
};
