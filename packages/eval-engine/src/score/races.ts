import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { isChampionsSimFormat } from '../forward/sim-mods.ts';
import { twinBattle, twinFormat } from '../sim-ask/index.ts';
import { usableSlots } from './threat.ts';

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
 * Fallback per-turn heal fraction for a heal-flagged move when the simulator cannot be asked (the Champions mod is
 * not registered yet, or the twin battle fails to build). Round 76 (T258): a move whose heal lives in a callback
 * instead of a Dex ratio (Shore Up, the Moonlight family, Rest, Wish, Jungle Healing, Heal Pulse) is read from the
 * simulator itself; moves with a direct Dex ratio price exactly (Recover 1/2, Life Dew 1/4, ...).
 */
const HEAL_FRACTION_DEFAULT = 0.5;

/** Turns a played heal move is clicked on the twin: a whole cycle of the slowest healer (Rest sleeps three turns after the click, a wake-up turn is lost), and of Wish (two). */
const HEAL_CYCLE = 12;

/** A foe whose heal-by-Attack differs between a weak and a strong Attack follows the foe (Strength Sap). */
const HEAL_FOE_TOLERANCE = 0.005;

/** The twin's bodies from the battle's own Dex, never by name: the sturdiest species for the healer, the weakest and the strongest Attack for the foes. */
const twinBodies = new WeakMap<object, TwinBodies>();

interface TwinBodies { healer: string; weak: string; strong: string; idle: string }

/** The Dex fields through which a status move reaches beyond its own boosts. */
const REACH_FIELDS = ['heal', 'volatileStatus', 'sideCondition', 'slotCondition', 'status', 'weather', 'terrain', 'pseudoWeather'] as const;

/** A move the foe can click without touching the healer or the heal: a status move that raises its own Defense and nothing else. */
function isIdleMove(move: ReturnType<Battle['dex']['moves']['all']>[number], gen: number): boolean {
  if (!move.exists || move.isNonstandard || move.gen > gen || move.isMax || move.isZ) return false;
  if (move.category !== 'Status' || move.target !== 'self' || Object.keys(move.boosts ?? {}).join() !== 'def') return false;
  return !move.flags['heal'] && REACH_FIELDS.every(field => !move[field]);
}

function bodiesOf(dex: Battle['dex']): TwinBodies {
  let bodies = twinBodies.get(dex);
  if (!bodies) {
    const all = dex.species.all().filter(species => species.exists && !species.isNonstandard && !species.forme && species.gen <= dex.gen);
    const by = (stat: 'hp' | 'atk', sign: 1 | -1) => all.reduce((best, species) => (sign * (species.baseStats[stat] - best.baseStats[stat]) > 0 ? species : best)).name;
    const idle = dex.moves.all().find(move => isIdleMove(move, dex.gen));
    if (!idle) throw new Error('the twin has no idle move');
    twinBodies.set(dex, bodies = { healer: by('hp', 1), weak: by('atk', -1), strong: by('atk', 1), idle: idle.id });
  }
  return bodies;
}

const twinSet = (species: string, moves: string[], item: string): PokemonSet => ({
  name: 'Twin', species, item, ability: '', moves, nature: '', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

/** The field a played heal runs under: the live weather and terrain, and the item of the healer (a Utility Umbrella blanks sun and rain). */
interface HealField { format: string; weather: string; item: string; terrain: string }

/**
 * The HP share the healer's own clicks restore per turn on a twin battle: the healer back at a quarter of its HP and
 * the foe at full HP every turn, over HEAL_CYCLE turns, the foe clicking its idle move. Only the heals of the move
 * itself count (a Wish's heal carries the move's id); a terrain's upkeep heal does not.
 */
function cycleGain(dex: Battle['dex'], field: HealField, moveId: string, foeSpecies: string): number {
  const twin = twinBattle(field.format, {
    p1: { name: 'Twin', team: [twinSet(bodiesOf(dex).healer, [moveId], field.item)] },
    p2: { name: 'Foe', team: [twinSet(foeSpecies, [bodiesOf(dex).idle], '')] },
  });
  const foe = twin.sides[1].active[0];
  if (field.weather) {
    twin.field.setWeather(field.weather, foe);
    twin.field.weatherState.duration = 0;
  }
  if (field.terrain) {
    twin.field.setTerrain(field.terrain, foe);
    twin.field.terrainState.duration = 0;
  }
  const user = twin.sides[0].active[0];
  for (const slot of user.moveSlots) slot.pp = slot.maxpp = 99;
  let total = 0;
  const heal = user.heal.bind(user);
  user.heal = (amount, source, effect) => {
    const healed = heal(amount, source, effect);
    if (effect?.id === moveId && typeof healed === 'number') total += healed;
    return healed;
  };
  for (let turn = 0; turn < HEAL_CYCLE && !twin.ended; turn++) {
    user.sethp(Math.floor(user.maxhp / 4));
    foe.sethp(foe.maxhp);
    twin.makeChoices('move 1', 'move 1');
  }
  return total / (HEAL_CYCLE * user.maxhp);
}

const playedRates = new Map<string, number>();

/**
 * Round 76 (T258): the heal per turn of a move without a Dex ratio, as the simulator plays it. The click runs on a twin
 * battle of the live battle's mode under its weather, terrain and the healer's item (a Utility Umbrella blanks sun and
 * rain); the HP the healer's own clicks restore per turn is the rate. Moves that heal the target (Heal Pulse, Floral
 * Healing: in singles the foe), the next body (Healing Wish) or later (Wish) and moves that sleep (Rest) read what a
 * repeated click gives over the cycle. Asked once per format, move, weather, item and terrain; test/races-heal-sim.spec.ts plays every heal move of the Dex
 * against it under every weather and terrain.
 */
function playedRate(pokemon: Pokemon, battle: Battle, moveId: string): number {
  const format = twinFormat(battle.gen, isChampionsSimFormat(battle.format.id));
  if (!format) return HEAL_FRACTION_DEFAULT;
  const field: HealField = { format, weather: battle.field.effectiveWeather(), item: pokemon.item, terrain: battle.field.terrain };
  const key = `${field.format}|${moveId}|${field.weather}|${field.item}|${field.terrain}`;
  let rate = playedRates.get(key);
  if (rate === undefined) {
    try {
      const { weak, strong } = bodiesOf(battle.dex);
      const [low, high] = [weak, strong].map(foe => cycleGain(battle.dex, field, moveId, foe));
      // A heal that follows the foe (Strength Sap takes the foe's Attack) is no rate of the healer alone: the proxy stays.
      rate = Math.abs(low - high) > HEAL_FOE_TOLERANCE ? HEAL_FRACTION_DEFAULT : low;
    } catch {
      rate = HEAL_FRACTION_DEFAULT;
    }
    playedRates.set(key, rate);
  }
  return rate;
}

/**
 * Per-turn fraction a status burns off its holder, as the sim's conditions
 * take it: burn 1/8 in gens 2 to 6, else 1/16; poison 1/16 in gen 1, else
 * 1/8; toxic priced at its early ramp (races-residual.spec.ts checks the
 * table against the sim, gens 1 to 9). Magic Guard blanks residuals; Poison
 * Heal turns poison into upkeep, priced as merely no residual (the passive
 * regen, like item regen, stays out: second-order next to the race sign).
 */
function residualFraction(status: string, gen: number): number {
  if (status === 'brn') return gen >= 2 && gen <= 6 ? 1 / 8 : 1 / 16;
  if (status === 'psn') return gen === 1 ? 1 / 16 : 1 / 8;
  if (status === 'tox') return 1 / 8;
  return 0;
}

export function statusResidual(pokemon: Pokemon): number {
  if (pokemon.ability === 'magicguard' || pokemon.ability === 'poisonheal') return 0;
  return residualFraction(pokemon.status, pokemon.battle.gen);
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
    // A drain move (Horn Leech, Giga Drain, Draining Kiss) carries the heal flag too, because Heal Block stops it, but
    // it heals a share of the damage it deals as part of an attack: no turn is spent healing (T220, the Dex's `drain`).
    if (!move.flags['heal'] || move.drain) continue;
    const fraction = move.heal ? move.heal[0] / move.heal[1] : playedRate(pokemon, battle, slot.id);
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
  /** Round 76 (T259): the same clocks before they are rounded up to whole turns (Infinity where the turns are). */
  exactA: number;
  exactB: number;
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
 *   over the sustain) it is pinned, priced as never attacking when it
 *   loses the pair either way. Since 13.10.2026 it is pinned only then:
 *   a pinned healer whose attack, spending no turn on a heal, KOs the
 *   other side no later than the other side KOs it attacks every turn
 *   (a 5% Cobalion in front of a full-HP Shore Up Palossand died to its
 *   Earth Power, and the race read the Palossand as a wall that never swings).
 * - The PP budget caps every clock: a win that needs more turns than the
 *   attacker has PP never lands (a full-PP wall still walls — the slow
 *   attacker runs dry first).
 *
 * Residuals alone can finish a race (stall wars end by status), but a side
 * with no damaging move at all never wins one.
 */
export function raceClocks(a: RaceSide, b: RaceSide): RaceClocks {
  const incomingA = b.frac + a.residual;
  const incomingB = a.frac + b.residual;
  let effFracA = a.frac * spare(a, incomingA);
  let effFracB = b.frac * spare(b, incomingB);
  // Each pinned side tries its attack against the other side's state above; a side that attacks heals nothing.
  const attackA = pinned(a, incomingA) && attackWins(a, b, effFracB, incomingA, incomingB);
  const attackB = pinned(b, incomingB) && attackWins(b, a, effFracA, incomingB, incomingA);
  if (attackA) effFracA = a.frac;
  if (attackB) effFracB = b.frac;
  const [clockA, clockB] = [clockOf(a, effFracA, b, incomingB, !attackB), clockOf(b, effFracB, a, incomingA, !attackA)];
  return {
    turnsA: clockA.turns,
    turnsB: clockB.turns,
    exactA: clockA.exact,
    exactB: clockB.exact,
    effFracA,
    effFracB,
  };
}

/** The share of its turns a healer can spend attacking: the rest heals the incoming damage away. */
function spare(side: RaceSide, incoming: number): number {
  return side.healRate > 0 && incoming > 0 ? Math.max(0, 1 - incoming / side.healRate) : 1;
}

/** A healer the incoming damage out-runs: no spare turn (spare is 0). */
const pinned = (side: RaceSide, incoming: number): boolean => side.healRate > 0 && incoming >= side.healRate;

/**
 * Whether a pinned side loses nothing by attacking: its clock on the other side (the other side's heals still
 * count) is finite and no longer than the other side's clock on it without the heals it would spend turns on.
 * A tie is not a loss: the caller breaks it by speed.
 */
function attackWins(side: RaceSide, other: RaceSide, otherEffFrac: number, incomingSide: number, incomingOther: number): boolean {
  const own = clock(side, side.frac, other, incomingOther, true);
  return own !== Infinity && own <= clock(other, otherEffFrac, side, incomingSide, false);
}

/**
 * Turns `attacker` needs to KO `defender` at `effFrac` per turn while the defender takes `incoming` per turn;
 * `heals` is whether the defender spends turns on its heal moves (a defender that attacks instead heals none).
 */
function clock(attacker: RaceSide, effFrac: number, defender: RaceSide, incoming: number, heals: boolean): number {
  return clockOf(attacker, effFrac, defender, incoming, heals).turns;
}

/** A clock in whole turns and before the rounding up (T259: the ramp of the bench gate reads the second). */
interface Clock { turns: number; exact: number }

const NEVER: Clock = { turns: Infinity, exact: Infinity };

function clockOf(attacker: RaceSide, effFrac: number, defender: RaceSide, incoming: number, heals: boolean): Clock {
  if (attacker.frac <= 0) return NEVER;
  const pressure = effFrac + defender.residual;
  if (pressure <= 0) return NEVER;
  // Held heal PP realize only at the pin efficiency (round 12): past the
  // heal rate the healer heals at a net loss and dies with PP in the
  // tank, so a bar held in PP is worth healRate/incoming of a bar on the
  // body — which is what makes healing NOW beat holding (655336 t26:
  // Slack Off must price over a free-turn Protect even in a lost race;
  // before this, hp + absorb was conserved by the heal click and a heal
  // turn priced at ~0).
  let absorb = 0;
  if (heals) {
    absorb = defender.healRate > 0 && incoming > defender.healRate
      ? defender.healAbsorb * (defender.healRate / incoming)
      : defender.healAbsorb;
  }
  // The epsilon keeps float noise (0.1 − 0.45/0.5 ≠ exactly 0.02) from
  // pushing an exact division over the next whole turn.
  const heldExact = (defender.hp + absorb) / pressure;
  const sequenceExact = heals ? healedSequence(defender, pressure, incoming) : Infinity;
  const exact = Math.min(heldExact, Math.max(1, sequenceExact));
  const turns = Math.min(Math.ceil(heldExact - 1e-9), heals ? Math.ceil(sequenceExact - 1e-9) : Infinity);
  return turns > attacker.ppBudget ? NEVER : { turns, exact };
}

/**
 * Round 76 (T258): the clock of a healer the hits out-run, as the simulator plays it: hit, heal, hit, heal, hit. n hits
 * take 1 + (n - 1) heals of the healer's rate, so the KO lands at the first n with n * pressure >= hp + (n - 1) * rate.
 * The held-PP price above stays the clock where the PP cannot bridge that many heals (a short tank empties first), and
 * wherever it is the shorter one: it counts the PP at the pin efficiency (round 12), so healing now still beats holding.
 * Infinity where the hits never out-run a heal. Returns the hits before the rounding up.
 */
function healedSequence(defender: RaceSide, pressure: number, incoming: number): number {
  const rate = defender.healRate;
  if (rate <= 0 || incoming <= rate || pressure <= rate) return Infinity;
  const exact = Math.max(1, (defender.hp - rate) / (pressure - rate));
  return (Math.ceil(exact - 1e-9) - 1) * rate <= defender.healAbsorb + 1e-9 ? exact : Infinity;
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
