import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import type { SimPokemonInfo, BranchMoveOption } from '../hooks/useBranch';

const gen = Generations.get(9);
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
}

export function calcSingleDamageRange(
  attacker: SimPokemonInfo,
  defender: SimPokemonInfo,
  moveOption: BranchMoveOption,
  context: DamageCalcContext = {},
): DamageResult {
  try {
    const atkPoke = new Pokemon(gen, attacker.species, {
      level: attacker.level,
      ability: attacker.ability || undefined,
      item: attacker.item || undefined,
      nature: attacker.nature || undefined,
      evs: attacker.evs as CalcStats,
      ivs: attacker.ivs as CalcStats,
      gender: (attacker.gender || undefined) as CalcGender,
      teraType: (attacker.teraType || undefined) as CalcTeraType,
      boosts: attacker.boosts as CalcBoosts,
      curHP: attacker.hp,
      status: (attacker.status || undefined) as CalcStatus,
    } satisfies CalcPokemonOptions);

    const defPoke = new Pokemon(gen, defender.species, {
      level: defender.level,
      ability: defender.ability || undefined,
      item: defender.item || undefined,
      nature: defender.nature || undefined,
      evs: defender.evs as CalcStats,
      ivs: defender.ivs as CalcStats,
      gender: (defender.gender || undefined) as CalcGender,
      teraType: (defender.teraType || undefined) as CalcTeraType,
      boosts: defender.boosts as CalcBoosts,
      curHP: defender.hp,
      status: (defender.status || undefined) as CalcStatus,
    } satisfies CalcPokemonOptions);

    const result = calculate(
      gen,
      atkPoke,
      defPoke,
      new Move(gen, moveOption.name),
      new Field({ gameType: context.gameType ?? 'Singles' }),
    );
    const dmg = result.damage;
    const flat = Array.isArray(dmg) ? dmg.flat().map(Number) : [Number(dmg)];
    const minDmg = Math.min(...flat);
    const maxDmg = Math.max(...flat);
    const minPct = defender.maxhp > 0 ? Math.round(minDmg / defender.maxhp * 1000) / 10 : 0;
    const maxPct = defender.maxhp > 0 ? Math.round(maxDmg / defender.maxhp * 1000) / 10 : 0;

    let koChance = '';
    if (maxPct >= 100) {
      koChance = minPct >= 100 ? 'guaranteed OHKO' : `${estimateKoProb(dmg, defender.hp)}% OHKO`;
    } else if (maxPct >= 50) {
      koChance = 'possible 2HKO';
    } else if (maxPct >= 33) {
      koChance = 'possible 3HKO';
    }

    return {
      moveName: moveOption.name,
      minPercent: minPct,
      maxPercent: maxPct,
      range: `${minPct}% - ${maxPct}%`,
      koChance,
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
