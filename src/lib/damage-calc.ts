import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import type { SimPokemonInfo, BranchMoveOption } from '../hooks/useBranch';
import { toId } from './ids';
import { TERRAIN_BY_ID, WEATHER_BY_ID } from './calc-field';

type CalcPokemonOptions = ConstructorParameters<typeof Pokemon>[2];
type CalcBoosts = NonNullable<CalcPokemonOptions>['boosts'];
type CalcStatus = NonNullable<CalcPokemonOptions>['status'];
type CalcStats = NonNullable<CalcPokemonOptions>['evs'];
type CalcGender = NonNullable<CalcPokemonOptions>['gender'];
type CalcTeraType = NonNullable<CalcPokemonOptions>['teraType'];

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

function percentOfMaxHp(damage: number, maxhp: number): number {
  return maxhp > 0 ? Math.round(damage / maxhp * 1000) / 10 : 0;
}

function koChanceFor(minPct: number, maxPct: number, dmg: number | number[] | number[][], hp: number): string {
  if (maxPct >= 100) {
    return minPct >= 100 ? 'guaranteed OHKO' : `${estimateKoProb(dmg, hp)}% OHKO`;
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
      new Move(gen, moveOption.name),
      calcField(context),
    );
    const dmg = result.damage;
    const flat = Array.isArray(dmg) ? dmg.flat().map(Number) : [Number(dmg)];
    const minPct = percentOfMaxHp(Math.min(...flat), defender.maxhp);
    const maxPct = percentOfMaxHp(Math.max(...flat), defender.maxhp);

    return {
      moveName: moveOption.name,
      minPercent: minPct,
      maxPercent: maxPct,
      range: `${minPct}% - ${maxPct}%`,
      koChance: koChanceFor(minPct, maxPct, dmg, defender.hp),
    };
  } catch {
    return emptyDamageResult(moveOption.name);
  }
}

/**
 * Calculate damage ranges for all available moves of an attacker against a defender.
 */
export function calcDamageRanges(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moves: BranchMoveOption[],
  context: DamageCalcContext = {},
): DamageResult[] {
  return moves.map(move => calcSingleDamageRange(attacker, defender, move, context));
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

function estimateKoProb(dmg: number | number[] | number[][], targetHp: number): number {
  if (!Array.isArray(dmg)) return Number(dmg) >= targetHp ? 100 : 0;
  const flat = dmg.flat().map(Number);
  const koCount = flat.filter(d => d >= targetHp).length;
  return Math.round(koCount / flat.length * 100);
}
