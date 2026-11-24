import { Move, Field, calculate, type Pokemon } from '@smogon/calc';
import type { SimPokemonInfo, BranchMoveOption } from './branch-engine.ts';
import { toId, TERRAIN_BY_ID, WEATHER_BY_ID, calcGenerationFor, isScreen, protectKind, screenFlags, dexOfCalc, simGenNum, type RulesDex } from '@fulllifegames/replay-core';
import { attackerAtUse, bodyFromInfo, calcPokemon, type CalcBody } from './calc/body.ts';
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

/** The preview of one move into one defender: damage range in percent of max HP, KO verdict, hit shares, roll steps. */
export interface DamageResult {
  moveName: string;
  minPercent: number;
  maxPercent: number;
  range: string;
  koChance: string;
  /** Each drawn hit count with its chance and own range, fewest hits first; absent for one hit or a fixed count. */
  hitShares?: { hits: number; chance: number; minPercent: number; maxPercent: number }[];
  rolls?: DamageRolls;
}

/** The calculator's damage per roll step, lowest first (16 steps, 39 in Gens 1 and 2); a multi-hit move sums hits. */
export interface DamageRolls {
  damage: number[];
  hp: number;
  maxhp: number;
  hits: number;
}

/** The field and live position around a damage preview: game type, generation, weather, terrain, conditions, dice. */
export interface DamageCalcContext {
  gameType?: 'Singles' | 'Doubles';
  gen?: number;
  /** Sim condition ids, mapped onto the calc field (e.g. 'raindance'). */
  weather?: string;
  terrain?: string;
  attackerSideConditions?: string[];
  defenderSideConditions?: string[];
  /** Doubles: the defender's living partner (never the attacker; null when alone); left out, the calc reads its own. */
  defenderPartner?: SimPokemonInfo | null;
  attackerPartnerAlive?: boolean;
  defenderPartnerMove?: string;
  liveHit?: LiveHit;
  isCrit?: boolean;
  rolls?: boolean;
  /** The forced hit count; a move with a drawn count lists its rolls for it (else for the fewest hits). */
  hits?: number;
}

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

const bodyFor = (gen: CalcGen, info: SimPokemonInfo, context: DamageCalcContext = {}) =>
  teraClicked(simGenNum(gen), bodyFromInfo(info), { weather: toConditionId(context.weather), terrain: toConditionId(context.terrain) });

function calcPokemonFrom(gen: CalcGen, info: SimPokemonInfo, context: DamageCalcContext = {}): Pokemon {
  return calcPokemon(gen, bodyFor(gen, info, context));
}

function landsOn(gen: CalcGen, attacker: SimPokemonInfo, target: SimPokemonInfo, moveName: string, context: DamageCalcContext, isProtected: boolean): boolean {
  const result = calculate(gen, calcPokemonFrom(gen, attacker, context), calcPokemonFrom(gen, target, context), calcMove(gen, moveName, bodyFor(gen, attacker)), calcField(context, isProtected));
  return result.range()[1] > 0;
}

// Endure carries no onTryHit; whether the move breaks through is the calc's call (isProtected), except Unseen Fist.
function shieldedBy(gen: CalcGen, pick: string | undefined, moveName: string, attacker: CalcBody): boolean {
  if (!pick) return false;
  const dex = dexOfCalc(gen);
  const shield = dex.moves.get(pick);
  return protectKind(dex, shield) === 'shield' && shield.priority > dex.moves.get(moveName).priority && protectBlocks(gen, moveName, attacker);
}

// trySpreadMoveHit sets spreadHit for 2+ targets (getMoveTargets counts living foes, allAdjacent the partner too);
// a smart-target multi-hit (Dragon Darts) hits the partner too unless it is immune or protected (getSmartTargets).
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
  const split = !!partner && !!dexOfCalc(gen).moves.get(moveOption.name).smartTarget &&
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

export interface HitCount {
  hits: number;
  chance: number;
}

function sharesOf(drawn: readonly number[]): HitCount[] {
  const counts = new Map<number, number>();
  for (const hits of drawn) counts.set(hits, (counts.get(hits) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a - b).map(([hits, count]) => ({ hits, chance: count / drawn.length }));
}

type GearHolder = Pick<SimPokemonInfo, 'ability' | 'item' | 'species'>;
type ModifyMoveHandler = (this: unknown, move: unknown, pokemon: unknown, target: unknown) => void;

const multihitMemo = new Map<string, number | number[] | undefined>();

// onModifyMove of the attacker's ability and item runs on the simulator's copy of the move (Skill Link: top count).
function multihitAtUse(dex: RulesDex, attacker: GearHolder, moveName: string) {
  const key = `${dex.gen}|${dex.currentMod}|${attacker.species}|${attacker.ability}|${attacker.item}|${moveName}`;
  if (!multihitMemo.has(key)) multihitMemo.set(key, askModifyMove(dex, attacker, moveName));
  return multihitMemo.get(key);
}

function askModifyMove(dex: RulesDex, attacker: GearHolder, moveName: string) {
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

/** The hit counts the simulator's hit loop draws for the move (calc/hit-draws.ts); null when the Dex fixes a count. */
export function hitCounts(dex: RulesDex, attacker: GearHolder, moveName: string): HitCount[] | null {
  const multihit = multihitAtUse(dex, attacker, moveName);
  if (!multihit) return null;
  const drawn = hitDraws(dex.gen, multihit, toId(attacker.item) === 'loadeddice');
  if (drawn.length === 1 && multihit === dex.moves.get(moveName).multihit) return null;
  return sharesOf(drawn);
}

const defenderBehindScreen = (context: DamageCalcContext): boolean => (context.defenderSideConditions ?? []).map(toConditionId).some(isScreen);

// The calc gives exact KO odds up to four hits and only estimates past that.
const MAX_KO_HITS = 4;

type CalcResult = ReturnType<typeof calculate>;
type PricedCount = { chance: number; result: CalcResult };

const chancePercent = (chance: number) => Math.max(Math.min(Math.round(chance * 1000), 999), 1) / 10;

// Past one use the count is drawn again each time, which the calc does not price: the fewest hits must hold.
function koOverCounts(priced: PricedCount[]): { n: number; text: string } {
  const verdicts = priced.map(({ chance, result }) => ({ share: chance, ...result.kochance(false) }));
  if (verdicts.every(verdict => verdict.text === verdicts[0].text)) return verdicts[0];
  const ohko = verdicts.reduce((sum, verdict) => sum + (verdict.n === 1 ? verdict.share * (verdict.chance ?? 0) : 0), 0);
  if (ohko > 0) return { n: 1, text: ohko >= 1 ? 'guaranteed OHKO' : `${chancePercent(ohko)}% chance to OHKO` };
  if (verdicts[0].chance === 1) return verdicts[0];
  const n = Math.min(...verdicts.map(verdict => verdict.n).filter(hits => hits >= 1));
  return { n, text: `possible ${n}HKO` };
}

function koChanceOf(priced: PricedCount[], maxDamage: number): string {
  if (maxDamage <= 0) return '';
  const { n, text } = priced.length === 1 ? priced[0].result.kochance(false) : koOverCounts(priced);
  return n >= 1 && n <= MAX_KO_HITS ? text : '';
}

function strengthPriced(priceAt: (hits?: number, firstUse?: boolean, power?: { basePower: number }) => CalcResult, firstUse: boolean, mix: ReturnType<typeof strengthMix>): PricedCount[] {
  const weak = priceAt(undefined, firstUse);
  if (!mix) return [{ chance: 1, result: weak }];
  return [{ chance: 1 - mix.chance, result: weak }, { chance: mix.chance, result: priceAt(undefined, firstUse, strongerPower(weak.move.bp, mix.factor)) }];
}

function aloneSpread(context: DamageCalcContext, result: CalcResult): boolean {
  return context.gameType === 'Doubles' && context.defenderPartner === null && result.move.target === 'allAdjacentFoes';
}

function priceOnCopy(context: DamageCalcContext, moveName: string): DamageResult {
  const range = context.liveHit ? simHitRange(context.liveHit, moveName) : null;
  if (!range) return emptyDamageResult(moveName);
  const minPct = percentOfMaxHp(range.min, range.maxhp);
  const maxPct = percentOfMaxHp(range.max, range.maxhp);
  const koChance = range.min >= range.hp ? 'guaranteed OHKO' : range.max >= range.hp ? 'possible OHKO' : '';
  return { moveName, minPercent: minPct, maxPercent: maxPct, range: `${minPct}% - ${maxPct}%`, koChance };
}

/** The damage preview of one move into a defender: range, KO verdict, hit shares, roll steps; empty if unpriced. */
export function calcSingleDamageRange(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moveOption: BranchMoveOption,
  context: DamageCalcContext = {},
): DamageResult {
  try {
    const gen = calcGeneration(context, attacker.mod);
    const overrides = moveLanding(gen, attacker, moveOption, context);
    const atkBody = attackerAtUse(dexOfCalc(gen), bodyFor(gen, attacker, context), moveOption.name);
    const priceAt = (hits?: number, isStellarFirstUse = false, power?: { basePower: number }): CalcResult => {
      const atkPoke = calcPokemon(gen, atkBody);
      const defPoke = calcPokemonFrom(gen, defender, context);
      const calcMoveFor = () => calcMove(gen, moveOption.name, atkBody, {
        ability: (attacker.ability || undefined) as CalcAbility,
        item: (attacker.item || undefined) as CalcItem,
        overrides: power ? { ...overrides, ...power } : overrides,
        isStellarFirstUse,
        ...(hits ? { hits } : {}),
        ...(context.isCrit ? { isCrit: true } : {}),
      });
      const result = calculate(gen, atkPoke, defPoke, calcMoveFor(), calcField(context));
      // The calc forces a spread on Tera Starstorm and Expanding Force; the simulator plays one target vs a lone foe.
      if (!aloneSpread(context, result)) return result;
      if (defenderBehindScreen(context)) throw new UnpricedByCalc();
      return calculate(gen, atkPoke, defPoke, calcMoveFor(), calcField({ ...context, gameType: 'Singles' }));
    };
    const firstUse = stellarFirstUse(atkBody, () => priceAt().move.type);
    const counts = overrides?.multihit ? null : hitCounts(dexOfCalc(gen), attacker, moveOption.name);
    const priced = counts ? counts.map(({ hits, chance }) => ({ chance, result: priceAt(hits, firstUse) })) : strengthPriced(priceAt, firstUse, strengthMix(dexOfCalc(gen), moveOption.name));
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
      ...(context.rolls ? rollsOf(priced, counts, context.hits, { hp: defender.hp, maxhp }) : {}),
    };
  } catch (error) {
    return error instanceof UnpricedByCalc ? priceOnCopy(context, moveOption.name) : emptyDamageResult(moveOption.name);
  }
}

function rollsOf(priced: PricedCount[], counts: HitCount[] | null, hits: number | undefined, defender: { hp: number; maxhp: number }): { rolls: DamageRolls } | Record<string, never> {
  const index = Math.max(0, counts?.findIndex(count => count.hits === hits) ?? 0);
  const damage = priced[index]?.result.damage;
  if (!Array.isArray(damage) || damage.length === 0) return {};
  const perHit: number[][] = typeof damage[0] === 'number' ? [damage as number[]] : (damage as number[][]);
  const steps = perHit[0].length;
  if (steps !== 16 && steps !== 39) return {};
  const total = Array.from({ length: steps }, (_, step) => perHit.reduce((sum, hit) => sum + hit[step], 0));
  return { rolls: { damage: total, hp: defender.hp, maxhp: defender.maxhp, hits: counts ? counts[index].hits : perHit.length } };
}

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
