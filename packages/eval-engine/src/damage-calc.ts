import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import { Dex } from '@pkmn/sim';
import type { SimPokemonInfo, BranchMoveOption } from './branch-engine.ts';
import { toId, TERRAIN_BY_ID, WEATHER_BY_ID } from '@fulllifegames/replay-core';

type CalcPokemonOptions = ConstructorParameters<typeof Pokemon>[2];
type CalcBoosts = NonNullable<CalcPokemonOptions>['boosts'];
type CalcStatus = NonNullable<CalcPokemonOptions>['status'];
type CalcStats = NonNullable<CalcPokemonOptions>['evs'];
type CalcGender = NonNullable<CalcPokemonOptions>['gender'];
type CalcTeraType = NonNullable<CalcPokemonOptions>['teraType'];
type CalcMoveOptions = NonNullable<ConstructorParameters<typeof Move>[2]>;
type CalcAbility = CalcMoveOptions['ability'];
type CalcItem = CalcMoveOptions['item'];
type CalcSpecies = CalcMoveOptions['species'];
type CalcMoveOverrides = NonNullable<CalcMoveOptions['overrides']>;

export interface DamageResult {
  moveName: string;
  minPercent: number;
  maxPercent: number;
  range: string;
  koChance: string;
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
}

function toConditionId(value: string | undefined): string {
  return toId(value ?? '');
}

function calcGeneration(context: DamageCalcContext) {
  const genNumber = context.gen && context.gen >= 1 && context.gen <= 9 ? context.gen : 9;
  return Generations.get(genNumber as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
}

function sideOptions(conditions: string[] | undefined) {
  const ids = new Set((conditions ?? []).map(toConditionId));
  return {
    isReflect: ids.has('reflect'),
    isLightScreen: ids.has('lightscreen'),
    isAuroraVeil: ids.has('auroraveil'),
  };
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

/** A calc Pokémon from the branch's live info: the same fields for attacker and defender. */
function calcPokemonFrom(gen: CalcGen, info: SimPokemonInfo): Pokemon {
  return new Pokemon(gen, info.species, {
    level: info.level,
    ability: info.ability || undefined,
    item: info.item || undefined,
    nature: info.nature || undefined,
    evs: info.evs as CalcStats,
    ivs: info.ivs as CalcStats,
    gender: (info.gender || undefined) as CalcGender,
    teraType: (info.teraType || undefined) as CalcTeraType,
    boosts: info.boosts as CalcBoosts,
    curHP: info.hp,
    status: (info.status || undefined) as CalcStatus,
  } satisfies CalcPokemonOptions);
}

/** Whether the move does damage to this Pokémon at all (the calc reads immunities, and Protect when it stands). */
function landsOn(gen: CalcGen, attacker: SimPokemonInfo, target: SimPokemonInfo, moveName: string, context: DamageCalcContext, isProtected: boolean): boolean {
  const result = calculate(gen, calcPokemonFrom(gen, attacker), calcPokemonFrom(gen, target), new Move(gen, moveName), calcField(context, isProtected));
  return result.range()[1] > 0;
}

/**
 * Whether the partner's pick shields it before the move lands: a stalling
 * move whose volatile stops moves (Protect, Detect, Spiky Shield and their
 * kin carry an onTryHit; Endure does not), going first by priority. All from
 * the Dex; whether the move breaks through is the calc's call (isProtected).
 */
function shieldedBy(gen: CalcGen, pick: string | undefined, moveName: string): boolean {
  if (!pick) return false;
  const dex = Dex.forGen(gen.num);
  const shield = dex.moves.get(pick);
  if (!shield.stallingMove || !shield.volatileStatus) return false;
  const stopsMoves = 'onTryHit' in dex.conditions.get(shield.volatileStatus);
  return stopsMoves && shield.priority > dex.moves.get(moveName).priority;
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
  const split = !!partner && !!Dex.forGen(gen.num).moves.get(moveOption.name).smartTarget &&
    landsOn(gen, attacker, partner, moveOption.name, context, shieldedBy(gen, context.defenderPartnerMove, moveOption.name));
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

const range = (low: number, high: number) => Array.from({ length: high - low + 1 }, (_, index) => low + index);

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
 * (battle-actions hitStepMoveHitLoop), or null when the Dex fixes one count
 * and the calc's own reading stands. A count the attacker's ability sets
 * (multihitAtUse) goes to the calc as such. The loop's draws live inline in
 * the simulator, with no handler to ask, so they are mirrored here as in
 * score/move-facts.ts, and test/damage-calc-hit-counts.spec.ts holds them
 * against the simulator's own draws: 2 to 5 hits sample
 * 2/2/2/2/2/2/2/3/3/3/3/3/3/3/4/4/4/5/5/5 from gen 5 on and 2/2/2/3/3/3/4/5
 * before; Loaded Dice turns a count under 4 into 4 or 5 and ten hits into
 * 4 to 10.
 */
export function hitCounts(gen: number, attacker: GearHolder, moveName: string): HitCount[] | null {
  const listed = Dex.forGen(gen).moves.get(moveName).multihit;
  const multihit = multihitAtUse(gen, attacker, moveName);
  const loadedDice = gen >= 5 && toId(attacker.item) === 'loadeddice';
  if (!multihit) return null;
  if (typeof multihit === 'number') {
    if (multihit === 10 && loadedDice) return sharesOf(range(4, 10));
    return multihit === listed ? null : [{ hits: multihit, chance: 1 }];
  }
  const [low, high] = multihit;
  if (low !== 2 || high !== 5) return sharesOf(range(low, high));
  const drawn = gen >= 5 ? [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5] : [2, 2, 2, 3, 3, 3, 4, 5];
  return sharesOf(loadedDice ? drawn.flatMap(hits => (hits < 4 ? [4, 5] : [hits, hits])) : drawn);
}

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

/**
 * The Stellar one-time boost (T124): a Stellar attacker's first use of each
 * type hits harder (the calc's isStellarFirstUse). The simulator lists the
 * types already spent (stellarBoostedTypes, empty before the Tera turn) by
 * the type at use, which the calc gives after its own type changes.
 */
function stellarFirstUse(attacker: SimPokemonInfo, typeAtUse: () => string): boolean {
  return attacker.teraType === 'Stellar' && !(attacker.stellarBoostedTypes ?? []).includes(typeAtUse());
}

export function calcSingleDamageRange(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moveOption: BranchMoveOption,
  context: DamageCalcContext = {},
): DamageResult {
  try {
    const gen = calcGeneration(context);
    const overrides = moveLanding(gen, attacker, moveOption, context);
    const priceAt = (hits?: number, isStellarFirstUse = false): CalcResult => calculate(
      gen,
      calcPokemonFrom(gen, attacker),
      calcPokemonFrom(gen, defender),
      // The attacker's ability and item reach the move too: Skill Link sets five hits.
      new Move(gen, moveOption.name, {
        ability: (attacker.ability || undefined) as CalcAbility,
        item: (attacker.item || undefined) as CalcItem,
        species: attacker.species as CalcSpecies,
        overrides,
        isStellarFirstUse,
        ...(hits ? { hits } : {}),
      }),
      calcField(context),
    );
    const firstUse = stellarFirstUse(attacker, () => priceAt().move.type);
    // A multi-hit move deals the sum of its hits; the calc sums them itself (T96). A drawn hit
    // count spans the fewest hits' minimum to the most hits' maximum, every count priced (T124).
    const counts = overrides?.multihit ? null : hitCounts(gen.num, attacker, moveOption.name);
    const priced = counts
      ? counts.map(({ hits, chance }) => ({ chance, result: priceAt(hits, firstUse) }))
      : [{ chance: 1, result: priceAt(undefined, firstUse) }];
    const minDamage = Math.min(...priced.map(({ result }) => result.range()[0]));
    const maxDamage = Math.max(...priced.map(({ result }) => result.range()[1]));
    const minPct = percentOfMaxHp(minDamage, defender.maxhp);
    const maxPct = percentOfMaxHp(maxDamage, defender.maxhp);

    return {
      moveName: moveOption.name,
      minPercent: minPct,
      maxPercent: maxPct,
      range: `${minPct}% - ${maxPct}%`,
      koChance: koChanceOf(priced, maxDamage),
    };
  } catch {
    return emptyDamageResult(moveOption.name);
  }
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
