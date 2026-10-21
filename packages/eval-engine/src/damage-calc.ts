import { Move, Field, calculate, type Pokemon } from '@smogon/calc';
import { Dex } from '@pkmn/sim';
import type { SimPokemonInfo, BranchMoveOption } from './branch-engine.ts';
import { toId, TERRAIN_BY_ID, WEATHER_BY_ID, calcGenerationFor, isScreen, protectKind, screenFlags, simGenNum } from '@fulllifegames/replay-core';
import { attackerAtUse, bodyFromInfo, calcPokemon, simDexOf, type CalcBody } from './calc/body.ts';
import { hitDraws } from './calc/hit-draws.ts';
import { calcMove, protectBlocks } from './calc/move.ts';
import { strengthMix, strongerPower } from './calc/fickle.ts';
import { stellarFirstUse } from './calc/stellar.ts';
import { simHitRange, type LiveHit } from './calc/sim-hit.ts';
import { teraClicked } from './calc/tera-click.ts';

type CalcMoveOptions = NonNullable<ConstructorParameters<typeof Move>[2]>;
type CalcAbility = CalcMoveOptions['ability'];
type CalcItem = CalcMoveOptions['item'];
type CalcMoveOverrides = NonNullable<CalcMoveOptions['overrides']>;

export interface DamageResult {
  moveName: string;
  minPercent: number;
  maxPercent: number;
  range: string;
  koChance: string;
  /**
   * A move whose hit count the simulator draws: each count with its chance
   * and its own range (round 67, T136 point 1), fewest hits first. Absent
   * for one hit or a fixed count.
   */
  hitShares?: { hits: number; chance: number; minPercent: number; maxPercent: number }[];
}

export interface DamageCalcContext {
  gameType?: 'Singles' | 'Doubles';
  /** Generation of the replay — the calc must match the sim's gen (B5). */
  gen?: number;
  /** Sim condition ids, mapped onto the calc field (e.g. 'raindance'). */
  weather?: string;
  terrain?: string;
  attackerSideConditions?: string[];
  defenderSideConditions?: string[];
  /**
   * Doubles, when the preview sees the field: the defender's living partner
   * (never the attacker; null when it stands alone) and whether the
   * attacker's partner lives. They decide how the move lands (moveLanding);
   * left out, the calc's own reading stands.
   */
  defenderPartner?: SimPokemonInfo | null;
  attackerPartnerAlive?: boolean;
  /** The move id the defender's partner picked this turn, when the preview knows it (T124). */
  defenderPartnerMove?: string;
  /**
   * The live battle of the branch with the two bodies of the hit (round 73, T202): the hits the calc cannot price are played on a
   * copy of it. Left out where the position has no live battle.
   */
  liveHit?: LiveHit;
}

/** The calc has no field that prices this hit: the simulator does (T202). */
class UnpricedByCalc extends Error {}

function toConditionId(value: string | undefined): string {
  return toId(value ?? '');
}

function calcGeneration(context: DamageCalcContext, mod?: string) {
  const genNumber = context.gen && context.gen >= 1 && context.gen <= 9 ? context.gen : 9;
  return calcGenerationFor(genNumber, mod);
}

function sideOptions(conditions: string[] | undefined) {
  return screenFlags((conditions ?? []).map(toConditionId));
}

/** The calc's field; `defenderProtected` raises the calc's own Protect on the defender's side. */
function calcField(context: DamageCalcContext, defenderProtected = false): Field {
  return new Field({
    gameType: context.gameType ?? 'Singles',
    weather: WEATHER_BY_ID[toConditionId(context.weather)],
    terrain: TERRAIN_BY_ID[toConditionId(context.terrain)],
    attackerSide: sideOptions(context.attackerSideConditions),
    defenderSide: { ...sideOptions(context.defenderSideConditions), isProtected: defenderProtected },
  });
}

type CalcGen = ReturnType<typeof calcGeneration>;

/**
 * The info's body for the calc: an armed Tera toggle reads as the
 * simulator's click makes it (round 67: Terapagos-Terastal clicks into
 * Terapagos-Stellar, an Ogerpon into its -Tera forme; calc/tera-click.ts). The click goes into the context's weather and
 * terrain, which Terapagos-Stellar's Teraform Zero clears (round 69, T152).
 */
const bodyFor = (gen: CalcGen, info: SimPokemonInfo, context: DamageCalcContext = {}) =>
  teraClicked(simGenNum(gen), bodyFromInfo(info), { weather: toConditionId(context.weather), terrain: toConditionId(context.terrain) });

/** A calc Pokémon from the branch's live info, through the engine's one builder (calc/body.ts). */
function calcPokemonFrom(gen: CalcGen, info: SimPokemonInfo, context: DamageCalcContext = {}): Pokemon {
  return calcPokemon(gen, bodyFor(gen, info, context));
}

/** Whether the move does damage to this Pokémon at all (the calc reads immunities, and Protect when it stands). */
function landsOn(gen: CalcGen, attacker: SimPokemonInfo, target: SimPokemonInfo, moveName: string, context: DamageCalcContext, isProtected: boolean): boolean {
  const result = calculate(gen, calcPokemonFrom(gen, attacker, context), calcPokemonFrom(gen, target, context), calcMove(gen, moveName, bodyFor(gen, attacker)), calcField(context, isProtected));
  return result.range()[1] > 0;
}

/**
 * Whether the partner's pick shields it before the move lands: a shield of the
 * Protect family (protectKind: Protect, Detect, Spiky Shield and their kin
 * carry an onTryHit; Endure does not), going first by priority. All from
 * the Dex; whether the move breaks through is the calc's call (isProtected),
 * unless the simulator takes the move's protect flag away before the check
 * (Unseen Fist on a contact move: protectBlocks, calc/protect.ts), when the
 * calc gets no isProtected at all (round 68, T186; calc 0.12 prices that hit
 * at a quarter, the simulator at full damage).
 */
function shieldedBy(gen: CalcGen, pick: string | undefined, moveName: string, attacker: CalcBody): boolean {
  if (!pick) return false;
  const dex = simDexOf(gen);
  const shield = dex.moves.get(pick);
  return protectKind(dex, shield) === 'shield' && shield.priority > dex.moves.get(moveName).priority && protectBlocks(gen, moveName, attacker);
}

/**
 * How the move lands in doubles, as the simulator decides it per use: a
 * spread move loses its spread factor when it hits only one Pokémon
 * (trySpreadMoveHit sets spreadHit for more than one target;
 * Battle.getMoveTargets counts the living foes, and for allAdjacent the
 * attacker's living partner too, immune or not), and a smart-target
 * multi-hit (Dragon Darts) lands one hit on the defender and one on its
 * partner, unless the partner is immune or protected (Pokemon.getSmartTargets,
 * then a failed hit step turns the second hit back onto the defender).
 */
function moveLanding(
  gen: CalcGen,
  attacker: SimPokemonInfo,
  moveOption: BranchMoveOption,
  context: DamageCalcContext,
): CalcMoveOverrides | undefined {
  if (context.gameType !== 'Doubles' || context.defenderPartner === undefined) return undefined;
  const partner = context.defenderPartner;
  const foes = partner ? 2 : 1;
  const hit = moveOption.targetType === 'allAdjacentFoes' ? foes
    : moveOption.targetType === 'allAdjacent' ? foes + (context.attackerPartnerAlive ? 1 : 0)
    : 0;
  const split = !!partner && !!simDexOf(gen).moves.get(moveOption.name).smartTarget &&
    landsOn(gen, attacker, partner, moveOption.name, context, shieldedBy(gen, context.defenderPartnerMove, moveOption.name, bodyFor(gen, attacker)));
  const overrides: CalcMoveOverrides = {
    ...(hit === 1 ? { target: 'normal' as const } : {}),
    ...(split ? { multihit: 1 } : {}),
  };
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function percentOfMaxHp(damage: number, maxhp: number): number {
  return maxhp > 0 ? Math.round(damage / maxhp * 1000) / 10 : 0;
}

/** One hit count the simulator can draw for a use of the move, with its chance. */
export interface HitCount {
  hits: number;
  chance: number;
}

/** Each value of the simulator's sampled array with its share, fewest hits first. */
function sharesOf(drawn: readonly number[]): HitCount[] {
  const counts = new Map<number, number>();
  for (const hits of drawn) counts.set(hits, (counts.get(hits) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a - b).map(([hits, count]) => ({ hits, chance: count / drawn.length }));
}

type GearHolder = Pick<SimPokemonInfo, 'ability' | 'item' | 'species'>;
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

/** One answer per gen, species, ability, item and move: the handlers read nothing else. */
const multihitMemo = new Map<string, number | number[] | undefined>();

/**
 * The move's hit count once the attacker's own ability and item have
 * reshaped it, as the simulator's ModifyMove event does before the hit loop:
 * their onModifyMove handlers from the Dex run on the simulator's own copy
 * of the move (Skill Link takes the top count, Battle Bond gives
 * Ash-Greninja's Water Shuriken three hits). A handler that asks the battle
 * for more than the preview holds leaves the copy as it is.
 */
function multihitAtUse(gen: number, attacker: GearHolder, moveName: string) {
  const key = `${gen}|${attacker.species}|${attacker.ability}|${attacker.item}|${moveName}`;
  if (!multihitMemo.has(key)) multihitMemo.set(key, askModifyMove(gen, attacker, moveName));
  return multihitMemo.get(key);
}

function askModifyMove(gen: number, attacker: GearHolder, moveName: string) {
  const dex = Dex.forGen(gen);
  const move = dex.getActiveMove(moveName);
  const pokemon = { species: dex.species.get(attacker.species), transformed: false };
  for (const effect of [dex.abilities.get(attacker.ability), dex.items.get(attacker.item)]) {
    const handler = (effect as { onModifyMove?: unknown }).onModifyMove;
    if (typeof handler !== 'function') continue;
    try {
      (handler as ModifyMoveHandler).call(undefined, move, pokemon, null);
    } catch {
      // The handler needs the battle itself; the move keeps its count.
    }
  }
  return move.multihit;
}

/**
 * The hit counts the simulator's hit loop draws for one use of the move
 * (calc/hit-draws.ts, held against the simulator's own draws by
 * test/damage-calc-hit-counts.spec.ts), or null when the Dex fixes one count
 * and the calc's own reading stands. A count the attacker's ability sets
 * (multihitAtUse) goes to the calc as such.
 */
export function hitCounts(gen: number, attacker: GearHolder, moveName: string): HitCount[] | null {
  const multihit = multihitAtUse(gen, attacker, moveName);
  if (!multihit) return null;
  const drawn = hitDraws(gen, multihit, toId(attacker.item) === 'loadeddice');
  if (drawn.length === 1 && multihit === Dex.forGen(gen).moves.get(moveName).multihit) return null;
  return sharesOf(drawn);
}

const defenderBehindScreen = (context: DamageCalcContext): boolean => (context.defenderSideConditions ?? []).map(toConditionId).some(isScreen);

/** The calc gives exact KO odds up to four hits; past that it only estimates, and the picker stays quiet. */
const MAX_KO_HITS = 4;

type CalcResult = ReturnType<typeof calculate>;
type PricedCount = { chance: number; result: CalcResult };

/** The calc's rounding of a KO chance in its texts (0.1 % to 99.9 %). */
const chancePercent = (chance: number) => Math.max(Math.min(Math.round(chance * 1000), 999), 1) / 10;

/**
 * The KO verdict over the hit counts the move can draw. Counts that agree
 * keep the calc's text. A count that can OHKO gives the exact OHKO chance:
 * each count's own chance, weighed by how often it is drawn. Past one use the
 * count is drawn again each time, which the calc does not price, so a
 * verdict holds only when the fewest hits guarantee it (every larger count
 * does at least as much); otherwise a KO in the fewest uses any count
 * reaches is possible.
 */
function koOverCounts(priced: PricedCount[]): { n: number; text: string } {
  const verdicts = priced.map(({ chance, result }) => ({ share: chance, ...result.kochance(false) }));
  if (verdicts.every(verdict => verdict.text === verdicts[0].text)) return verdicts[0];
  const ohko = verdicts.reduce((sum, verdict) => sum + (verdict.n === 1 ? verdict.share * (verdict.chance ?? 0) : 0), 0);
  if (ohko > 0) return { n: 1, text: ohko >= 1 ? 'guaranteed OHKO' : `${chancePercent(ohko)}% chance to OHKO` };
  if (verdicts[0].chance === 1) return verdicts[0];
  const n = Math.min(...verdicts.map(verdict => verdict.n).filter(hits => hits >= 1));
  return { n, text: `possible ${n}HKO` };
}

/**
 * The calc's own KO verdict against the defender's current HP
 * (Result.kochance: the hits' combined rolls, end-of-turn chip and
 * recovery included), so a damaged target a third-of-max hit finishes
 * reads as a KO.
 */
function koChanceOf(priced: PricedCount[], maxDamage: number): string {
  if (maxDamage <= 0) return '';
  const { n, text } = priced.length === 1 ? priced[0].result.kochance(false) : koOverCounts(priced);
  return n >= 1 && n <= MAX_KO_HITS ? text : '';
}

/** The single hit, or for a move that doubles on a chance (Fickle Beam, T154) its weaker and its stronger strength, each with its chance. */
function strengthPriced(priceAt: (hits?: number, firstUse?: boolean, power?: { basePower: number }) => CalcResult, firstUse: boolean, mix: ReturnType<typeof strengthMix>): PricedCount[] {
  const weak = priceAt(undefined, firstUse);
  if (!mix) return [{ chance: 1, result: weak }];
  return [{ chance: 1 - mix.chance, result: weak }, { chance: mix.chance, result: priceAt(undefined, firstUse, strongerPower(weak.move.bp, mix.factor)) }];
}

/** A Doubles hit on a foe that stands alone, with the foes-only spread target left on the move (moveLanding sets one foe for the moves whose Dex target spreads). */
function aloneSpread(context: DamageCalcContext, result: CalcResult): boolean {
  return context.gameType === 'Doubles' && context.defenderPartner === null && result.move.target === 'allAdjacentFoes';
}

/** The simulator's price of the hit on a copy of the live battle, as a result; the empty result where the position has no live battle. */
function priceOnCopy(context: DamageCalcContext, moveName: string): DamageResult {
  const range = context.liveHit ? simHitRange(context.liveHit, moveName) : null;
  if (!range) return emptyDamageResult(moveName);
  const minPct = percentOfMaxHp(range.min, range.maxhp);
  const maxPct = percentOfMaxHp(range.max, range.maxhp);
  const koChance = range.min >= range.hp ? 'guaranteed OHKO' : range.max >= range.hp ? 'possible OHKO' : '';
  return { moveName, minPercent: minPct, maxPercent: maxPct, range: `${minPct}% - ${maxPct}%`, koChance };
}

export function calcSingleDamageRange(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moveOption: BranchMoveOption,
  context: DamageCalcContext = {},
): DamageResult {
  try {
    const gen = calcGeneration(context, attacker.mod);
    const overrides = moveLanding(gen, attacker, moveOption, context);
    const atkBody = attackerAtUse(simGenNum(gen), bodyFor(gen, attacker, context), moveOption.name);
    const priceAt = (hits?: number, isStellarFirstUse = false, power?: { basePower: number }): CalcResult => {
      const atkPoke = calcPokemon(gen, atkBody);
      const defPoke = calcPokemonFrom(gen, defender, context);
      // The attacker's ability and item reach the move too: Skill Link sets five hits.
      const calcMoveFor = () => calcMove(gen, moveOption.name, atkBody, {
        ability: (attacker.ability || undefined) as CalcAbility,
        item: (attacker.item || undefined) as CalcItem,
        overrides: power ? { ...overrides, ...power } : overrides,
        isStellarFirstUse,
        ...(hits ? { hits } : {}),
      });
      const result = calculate(gen, atkPoke, defPoke, calcMoveFor(), calcField(context));
      // The calc forces a spread on a few moves (Tera Starstorm of Terapagos-Stellar, Expanding Force on Psychic Terrain): against a lone foe the simulator plays one target, which the Singles game type prices (T152). Behind a screen no game type does (T202): the simulator prices the hit.
      if (!aloneSpread(context, result)) return result;
      if (defenderBehindScreen(context)) throw new UnpricedByCalc();
      return calculate(gen, atkPoke, defPoke, calcMoveFor(), calcField({ ...context, gameType: 'Singles' }));
    };
    const firstUse = stellarFirstUse(atkBody, () => priceAt().move.type);
    // A multi-hit move deals the sum of its hits; the calc sums them itself (T96). A drawn hit
    // count spans the fewest hits' minimum to the most hits' maximum, every count priced (T124).
    const counts = overrides?.multihit ? null : hitCounts(simGenNum(gen), attacker, moveOption.name);
    const priced = counts ? counts.map(({ hits, chance }) => ({ chance, result: priceAt(hits, firstUse) })) : strengthPriced(priceAt, firstUse, strengthMix(simDexOf(gen), moveOption.name));
    const minDamage = Math.min(...priced.map(({ result }) => result.range()[0]));
    const maxDamage = Math.max(...priced.map(({ result }) => result.range()[1]));
    const maxhp = bodyFor(gen, defender).maxhp;
    const minPct = percentOfMaxHp(minDamage, maxhp);
    const maxPct = percentOfMaxHp(maxDamage, maxhp);

    return {
      moveName: moveOption.name,
      minPercent: minPct,
      maxPercent: maxPct,
      range: `${minPct}% - ${maxPct}%`,
      koChance: koChanceOf(priced, maxDamage),
      ...(counts && counts.length > 1 ? { hitShares: hitSharesOf(counts, priced, maxhp) } : {}),
    };
  } catch (error) {
    return error instanceof UnpricedByCalc ? priceOnCopy(context, moveOption.name) : emptyDamageResult(moveOption.name);
  }
}

/** Each drawn hit count with its chance and its own range (round 67, T136 point 1). */
function hitSharesOf(counts: HitCount[], priced: PricedCount[], maxhp: number): NonNullable<DamageResult['hitShares']> {
  return counts.map(({ hits, chance }, index) => {
    const [min, max] = priced[index].result.range();
    return { hits, chance, minPercent: percentOfMaxHp(min, maxhp), maxPercent: percentOfMaxHp(max, maxhp) };
  });
}

function emptyDamageResult(moveName: string): DamageResult {
  return {
    moveName,
    minPercent: 0,
    maxPercent: 0,
    range: '-',
    koChance: '',
  };
}
