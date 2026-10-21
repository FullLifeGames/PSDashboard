import { Field, Move } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import type { CalcGeneration } from '../calc-gen.ts';
import { ATTACKER_SIDE_FLAG_BY_ID, DEFENDER_SIDE_FLAG_BY_ID, FIELD_FLAG_BY_ID, TERRAIN_BY_ID, WEATHER_BY_ID } from '../calc-field.ts';
import { toId } from '../ids.ts';
import { screenFlags } from '../dex-facts/index.ts';
import type { DamageObservation } from '../types.ts';
import { originIn, type FormeDex } from './battle-forme.ts';

/** Client condition ids the shared calc map doesn't spell out. */
const WEATHER_ALIASES: Record<string, string> = {
  sand: 'sandstorm', rain: 'raindance', sun: 'sunnyday',
};

const weatherFor = (raw: string) => WEATHER_BY_ID[WEATHER_ALIASES[toId(raw)] ?? toId(raw)];

/** The client names a terrain by its short name ('Electric'), the calculator's table keys the condition ('electricterrain'). */
const terrainFor = (raw: string) => TERRAIN_BY_ID[`${toId(raw)}terrain`] ?? TERRAIN_BY_ID[toId(raw)];

/** The side of an observation's defender: the one the parser read, else the other side (observations of older caches, singles). */
export function defenderSideOf(obs: DamageObservation): 'p1' | 'p2' {
  return obs.defenderSide ?? (obs.attackerSide === 'p1' ? 'p2' : 'p1');
}

/** The calculator flags the field facts of an observation set, from one table of ids. */
const flagsOf = (facts: readonly string[], table: Record<string, string>) =>
  Object.fromEntries(facts.filter(id => id in table).map(id => [table[id], true]));

/**
 * The field one observed hit was played on: the game type, the weather, the terrain, the defender's screens (Reflect weighs
 * x2732/4096 in doubles) and the facts the log shows beside the two Pokémon (Helping Hand, Friend Guard, a Ruin ability, Gravity).
 */
export function fieldOf(obs: DamageObservation): Field {
  const facts = obs.fieldFacts ?? [];
  return new Field({
    gameType: obs.doubles ? 'Doubles' : 'Singles',
    weather: weatherFor(obs.weather),
    terrain: terrainFor(obs.terrain ?? ''),
    ...flagsOf(facts, FIELD_FLAG_BY_ID),
    attackerSide: flagsOf(facts, ATTACKER_SIDE_FLAG_BY_ID),
    defenderSide: {
      ...screenFlags(obs.screens),
      ...flagsOf(facts, DEFENDER_SIDE_FLAG_BY_ID),
    },
  });
}

/** The calculator's spread targets: its spread factor applies to them in doubles. */
export const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes']);

/**
 * A doubles hit the log shows on one target (no `[spread]` mark) whose calculator result still names a spread target (round 73,
 * T202). The calculator forces the spread target for a few moves (Expanding Force in Psychic Terrain, Tera Starstorm of
 * Terapagos-Stellar), and its Doubles field then cuts a hit that the simulator played on one target; behind a screen no field
 * prices it. The hit gives no damage reading. The detection reads the calculator's result, never a move name. Remove when the
 * calculator stops forcing the target against a lone foe.
 */
export const forcedSpread = (obs: { doubles?: boolean; spread?: boolean }, resultTarget: string): boolean =>
  !!obs.doubles && !obs.spread && SPREAD_TARGETS.has(resultTarget);

/**
 * The move of an observation as the calculator builds it, by its name (Weather Ball, Terrain Pulse, Techno Blast and Multi-Attack
 * key on the name, not on the id). The calculator cuts a move aimed at all adjacent targets to 0.75 on a
 * Doubles field; the simulator cuts exactly when the move line names `[spread]` (two targets at the start, even if one protects).
 * A doubles hit without the mark had one target and takes the full damage, so the move reads as a single-target move.
 */
export function moveOf(gen: CalcGeneration, moveName: string, obs: DamageObservation): Move {
  return obs.doubles && !obs.spread ? new Move(gen, moveName, { overrides: { target: 'normal' } }) : new Move(gen, moveName);
}

/**
 * An observation as the solver reads it (round 69, T190): each mon named by its set, with the battle forme the log showed when
 * that forme is not the set's own species (a Mega, Aegislash-Blade). The calculator builds the forme, the keys stay the base's.
 */
export interface ReadObservation extends DamageObservation {
  attackerForme?: string;
  defenderForme?: string;
}

/** The observation with a forme named as the set of the species it came from; unchanged when a set carries the species or no set carries its origin. */
export function readObservation(dex: FormeDex, sets: { p1: readonly PokemonSet[]; p2: readonly PokemonSet[] }, obs: DamageObservation): ReadObservation {
  const attacker = originIn(dex, sets[obs.attackerSide], obs.attackerSpecies);
  const defender = originIn(dex, sets[defenderSideOf(obs)], obs.defenderSpecies);
  if (!attacker && !defender) return obs;
  return {
    ...obs,
    ...(attacker ? { attackerSpecies: attacker, attackerForme: obs.attackerSpecies } : {}),
    ...(defender ? { defenderSpecies: defender, defenderForme: obs.defenderSpecies } : {}),
  };
}

/** What one side of a hit adds to its calculator Pokémon: the log's stages, status, forme, Tera type, HP, fallen, ability and the stat a Paradox ability raises. */
export interface HitSide {
  boosts?: Record<string, number>;
  status?: string;
  forme?: string;
  boostedStat?: string;
  tera?: string;
  /** HP as a fraction of the maximum before the hit; below 1 it sets the calculator's current HP. */
  hp?: number;
  fallen?: number;
  ability?: string;
  suppressed?: boolean;
  abilityOn?: boolean;
}

/** One side of a hit as the log shows it at the damage line. The defender's status is not read, and its ability is never "on". */
export function hitSideOf(obs: ReadObservation, role: 'attacker' | 'defender'): HitSide {
  if (role === 'defender') {
    return {
      boosts: obs.defenderBoosts, forme: obs.defenderForme, boostedStat: obs.defenderParadox?.stat, tera: obs.defenderTera, hp: obs.defenderHp,
      ability: obs.defenderAbility, suppressed: obs.defenderSuppressed,
    };
  }
  return {
    boosts: obs.attackerBoosts, status: obs.attackerStatus, forme: obs.attackerForme, boostedStat: obs.attackerParadox?.stat, tera: obs.attackerTera,
    hp: obs.attackerHp, fallen: obs.attackerFallen, ability: obs.attackerAbility, suppressed: obs.attackerSuppressed, abilityOn: obs.attackerAbilityOn,
  };
}
