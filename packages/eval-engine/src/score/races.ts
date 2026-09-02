import type { Battle, Pokemon } from '@pkmn/sim';
import { usableSlots } from './threat';

/**
 * KO-race clocks for one pair: heal PP as survival, the healer's action
 * economy, and PP budgets, all fed by live sim state.
 */

/** The wall's finite fuel: the best per-turn heal rate and the total HP fraction the heal PP restore. */
export interface HealProfile {
  rate: number;
  absorb: number;
}

/**
 * Fallback per-turn heal fraction for heal-flagged moves whose amount lives
 * in a callback instead of a dex ratio (the Moonlight family's weather
 * scaling, Rest's full-heal-but-sleep, Strength Sap's stat dependence):
 * ~50% is the grounded proxy. Moves with a direct dex ratio price exactly —
 * heal rates differ per move (Recover 1/2, Life Dew 1/4, …).
 */
const HEAL_FRACTION_DEFAULT = 0.5;

/**
 * Per-turn fraction a status burns off its holder (gen7+ residuals; toxic
 * priced at its early ramp). Magic Guard blanks residuals; Poison Heal turns
 * poison into upkeep — priced as merely no residual (the passive regen, like
 * item regen, stays out: second-order next to the race sign).
 */
const STATUS_RESIDUALS: Record<string, number> = { brn: 1 / 16, psn: 1 / 8, tox: 1 / 8 };

export function statusResidual(pokemon: Pokemon): number {
  if (pokemon.ability === 'magicguard' || pokemon.ability === 'poisonheal') return 0;
  return STATUS_RESIDUALS[pokemon.status] ?? 0;
}

/**
 * The wall's finite fuel from usable heal moves: the best per-turn heal
 * rate, and the total HP fraction the remaining heal PP can restore
 * (Σ pp × per-move rate).
 */
export function healProfile(pokemon: Pokemon, battle: Battle): HealProfile {
  let rate = 0;
  let absorb = 0;
  for (const slot of usableSlots(pokemon)) {
    const move = battle.dex.moves.get(slot.id);
    if (!move.flags['heal']) continue;
    const fraction = move.heal ? move.heal[0] / move.heal[1] : HEAL_FRACTION_DEFAULT;
    rate = Math.max(rate, fraction);
    absorb += (slot.pp ?? 8) * fraction;
  }
  return { rate, absorb };
}

/**
 * Total usable PP — a coarse ceiling on how many turns of pressure the mon
 * can still produce (heal turns included; the Struggle a drained mon could
 * still click stays out, see usableSlots).
 */
export function ppBudget(pokemon: Pokemon): number {
  let pp = 0;
  for (const slot of usableSlots(pokemon)) pp += slot.pp ?? 8;
  return pp;
}

/** One side of a 1v1 race, in HP fractions per turn. */
export interface RaceSide {
  /** Starting HP fraction (the matchup term passes hazard-adjusted entry HP). */
  hp: number;
  /** Best per-turn damage fraction onto the opponent (boost-adjusted). */
  frac: number;
  /** Per-turn status residual burning THIS side. */
  residual: number;
  /** Best per-turn heal fraction among usable heal moves (0 = no healer). */
  healRate: number;
  /** Total HP fraction the remaining heal PP can restore (Σ pp × rate). */
  healAbsorb: number;
  /** Total usable PP: the ceiling on turns of pressure this side can produce. */
  ppBudget: number;
}

export interface RaceClocks {
  /** Turns side A needs to KO side B (Infinity = never lands). */
  turnsA: number;
  turnsB: number;
  /** Offense after the wall's action economy (see below). */
  effFracA: number;
  effFracB: number;
}

/**
 * KO-race clocks for one pair, replacing the old "a healer walls anything
 * short of a 2HKO" pauschal (573756 t134–139: that rule priced a burned,
 * 3-Recover-PP Toxapex as unkillable AND let it heal and chip in the same
 * turn). Three deliberately coarse rules, all fed by live sim state:
 *
 * - Heal PP absorbs as survival: the remaining heal PP restore healAbsorb
 *   bars in total, so a defender soaks hp + healAbsorb before it falls —
 *   pure delay whether or not the wall arithmetic holds. Past the heal
 *   rate the held PP realize only at healRate/incoming efficiency (the
 *   healer heals at a net loss and dies with PP in the tank), so HP
 *   already on the body outprices PP in the tank — healing now beats
 *   holding (round 12).
 * - Action economy: a healer under pressure spends pressure/healRate of its
 *   turns healing and attacks only on the spare ones; under crumbling
 *   pressure (≥ its best heal rate, e.g. a burn tipping a borderline hit
 *   over the sustain) it is pinned — priced as never attacking, since it
 *   loses the pair either way.
 * - The PP budget caps every clock: a win that needs more turns than the
 *   attacker has PP never lands (a full-PP wall still walls — the slow
 *   attacker runs dry first).
 *
 * Residuals alone can finish a race (stall wars end by status), but a side
 * with no damaging move at all never wins one.
 */
export function raceClocks(a: RaceSide, b: RaceSide): RaceClocks {
  const spare = (side: RaceSide, incoming: number): number =>
    side.healRate > 0 && incoming > 0 ? Math.max(0, 1 - incoming / side.healRate) : 1;
  const incomingA = b.frac + a.residual;
  const incomingB = a.frac + b.residual;
  const effFracA = a.frac * spare(a, incomingA);
  const effFracB = b.frac * spare(b, incomingB);
  const clock = (attacker: RaceSide, effFrac: number, defender: RaceSide, incoming: number): number => {
    if (attacker.frac <= 0) return Infinity;
    const pressure = effFrac + defender.residual;
    if (pressure <= 0) return Infinity;
    // Held heal PP realize only at the pin efficiency (round 12): past the
    // heal rate the healer heals at a net loss and dies with PP in the
    // tank, so a bar held in PP is worth healRate/incoming of a bar on the
    // body — which is what makes healing NOW beat holding (655336 t26:
    // Slack Off must price over a free-turn Protect even in a lost race;
    // before this, hp + absorb was conserved by the heal click and a heal
    // turn priced at ~0).
    const absorb = defender.healRate > 0 && incoming > defender.healRate
      ? defender.healAbsorb * (defender.healRate / incoming)
      : defender.healAbsorb;
    // The epsilon keeps float noise (0.1 − 0.45/0.5 ≠ exactly 0.02) from
    // pushing an exact division over the next whole turn.
    const turns = Math.ceil((defender.hp + absorb) / pressure - 1e-9);
    return turns > attacker.ppBudget ? Infinity : turns;
  };
  return {
    turnsA: clock(a, effFracA, b, incomingB),
    turnsB: clock(b, effFracB, a, incomingA),
    effFracA,
    effFracB,
  };
}

/** Assembles one Pokémon's race side from live battle state. */
export function raceSide(
  pokemon: Pokemon,
  hp: number,
  frac: number,
  battle: Battle,
): RaceSide {
  const heal = healProfile(pokemon, battle);
  return {
    hp,
    frac,
    residual: statusResidual(pokemon),
    healRate: heal.rate,
    healAbsorb: heal.absorb,
    ppBudget: ppBudget(pokemon),
  };
}
