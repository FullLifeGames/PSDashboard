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

function calcField(context: DamageCalcContext): Field {
  return new Field({
    gameType: context.gameType ?? 'Singles',
    weather: WEATHER_BY_ID[toConditionId(context.weather)],
    terrain: TERRAIN_BY_ID[toConditionId(context.terrain)],
    attackerSide: sideOptions(context.attackerSideConditions),
    defenderSide: sideOptions(context.defenderSideConditions),
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

/** Whether the move does damage to this Pokémon at all (the calc reads immunities). */
function landsOn(gen: CalcGen, attacker: SimPokemonInfo, target: SimPokemonInfo, moveName: string, context: DamageCalcContext): boolean {
  const result = calculate(gen, calcPokemonFrom(gen, attacker), calcPokemonFrom(gen, target), new Move(gen, moveName), calcField(context));
  return result.range()[1] > 0;
}

/**
 * How the move lands in doubles, as the simulator decides it per use: a
 * spread move loses its spread factor when it hits only one Pokémon
 * (trySpreadMoveHit sets spreadHit for more than one target;
 * Battle.getMoveTargets counts the living foes, and for allAdjacent the
 * attacker's living partner too, immune or not), and a smart-target
 * multi-hit (Dragon Darts) lands one hit on the defender and one on its
 * partner, unless the partner is immune (Pokemon.getSmartTargets, then the
 * immunity step turns the second hit back onto the defender).
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
  const overrides: CalcMoveOverrides = {};
  if (hit === 1) overrides.target = 'normal';
  if (partner && Dex.forGen(gen.num).moves.get(moveOption.name).smartTarget &&
    landsOn(gen, attacker, partner, moveOption.name, context)) {
    overrides.multihit = 1;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function percentOfMaxHp(damage: number, maxhp: number): number {
  return maxhp > 0 ? Math.round(damage / maxhp * 1000) / 10 : 0;
}

function koChanceFor(minPct: number, maxPct: number, hits: number[][], hp: number): string {
  if (maxPct >= 100) {
    return minPct >= 100 ? 'guaranteed OHKO' : `${estimateKoProb(hits, hp)}% OHKO`;
  }
  if (maxPct >= 50) return 'possible 2HKO';
  if (maxPct >= 33) return 'possible 3HKO';
  return '';
}

export function calcSingleDamageRange(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moveOption: BranchMoveOption,
  context: DamageCalcContext = {},
): DamageResult {
  try {
    const gen = calcGeneration(context);
    const atkPoke = calcPokemonFrom(gen, attacker);
    const defPoke = calcPokemonFrom(gen, defender);

    const result = calculate(
      gen,
      atkPoke,
      defPoke,
      // The attacker's ability and item reach the move too: Skill Link sets five hits.
      new Move(gen, moveOption.name, {
        ability: (attacker.ability || undefined) as CalcAbility,
        item: (attacker.item || undefined) as CalcItem,
        species: attacker.species as CalcSpecies,
        overrides: moveLanding(gen, attacker, moveOption, context),
      }),
      calcField(context),
    );
    // A multi-hit move deals the sum of its hits; the calc sums them itself (T96).
    const [minDamage, maxDamage] = result.range();
    const minPct = percentOfMaxHp(minDamage, defender.maxhp);
    const maxPct = percentOfMaxHp(maxDamage, defender.maxhp);

    return {
      moveName: moveOption.name,
      minPercent: minPct,
      maxPercent: maxPct,
      range: `${minPct}% - ${maxPct}%`,
      koChance: koChanceFor(minPct, maxPct, hitRolls(result.damage), defender.hp),
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

/**
 * The calc's damage as one row of equally likely rolls per hit: a number,
 * one hit's rolls, one number per hit (fewer than 16, as the calc's own
 * damageRange reads them: fixed-damage Parental Bond) or one row per hit.
 */
function hitRolls(damage: number | number[] | number[][]): number[][] {
  if (!Array.isArray(damage)) return [[Number(damage)]];
  if (damage.length > 0 && Array.isArray(damage[0])) return (damage as number[][]).map(row => row.map(Number));
  const rolls = (damage as number[]).map(Number);
  return rolls.length < 16 ? rolls.map(hit => [hit]) : [rolls];
}

/** The chance that the hits together reach `targetHp`: every hit rolls on its own. */
function estimateKoProb(hits: number[][], targetHp: number): number {
  let totals = new Map<number, number>([[0, 1]]);
  for (const rolls of hits) {
    const next = new Map<number, number>();
    for (const [sum, ways] of totals) {
      for (const roll of rolls) next.set(sum + roll, (next.get(sum + roll) ?? 0) + ways);
    }
    totals = next;
  }
  let all = 0;
  let knockouts = 0;
  for (const [sum, ways] of totals) {
    all += ways;
    if (sum >= targetHp) knockouts += ways;
  }
  return all > 0 ? Math.round(knockouts / all * 100) : 0;
}
