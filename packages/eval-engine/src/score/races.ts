import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { isChampionsSimFormat } from '../forward/sim-mods.ts';
import { twinBattle, twinFormat } from '../sim-ask/index.ts';
import { usableSlots } from './threat.ts';

export interface HealProfile {
  rate: number;
  absorb: number;
}

// The proxy rate when the simulator cannot be asked (Champions mod not yet registered, twin battle fails to build).
const HEAL_FRACTION_DEFAULT = 0.5;

// A whole cycle of the slowest healer: Rest sleeps three turns after the click, Wish takes two.
const HEAL_CYCLE = 12;

const HEAL_FOE_TOLERANCE = 0.005;

const twinBodies = new WeakMap<object, TwinBodies>();

interface TwinBodies { healer: string; weak: string; strong: string; idle: string }

const REACH_FIELDS = ['heal', 'volatileStatus', 'sideCondition', 'slotCondition', 'status', 'weather', 'terrain', 'pseudoWeather'] as const;

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

interface HealField { format: string; weather: string; item: string; terrain: string }

// The healer is set back to a quarter HP and the foe to full HP every turn, the foe clicking its idle move.
// Only the heals of the move itself count (a Wish's heal carries the move's id); a terrain's upkeep heal does not.
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

// Heal Pulse (the foe in singles), Healing Wish, Wish and Rest read what a repeated click gives over the cycle.
// Asked once per format, move, weather, item and terrain; races-heal-sim.spec.ts plays every heal move of the Dex.
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
      // A heal that follows the foe (Strength Sap takes its Attack) is no rate of the healer alone: the proxy stays.
      rate = Math.abs(low - high) > HEAL_FOE_TOLERANCE ? HEAL_FRACTION_DEFAULT : low;
    } catch {
      rate = HEAL_FRACTION_DEFAULT;
    }
    playedRates.set(key, rate);
  }
  return rate;
}

// Burn is 1/8 in gens 2 to 6, else 1/16; poison 1/16 in gen 1, else 1/8; toxic at its early ramp.
// Magic Guard blanks residuals, Poison Heal turns poison into upkeep (none); races-residual.spec.ts holds gens 1 to 9.
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

export function healProfile(pokemon: Pokemon, battle: Battle): HealProfile {
  let rate = 0;
  let absorb = 0;
  for (const slot of usableSlots(pokemon)) {
    const move = battle.dex.moves.get(slot.id);
    // Drain moves carry the heal flag too (Heal Block stops them) but heal as part of an attack: no turn spent healing.
    if (!move.flags['heal'] || move.drain) continue;
    const fraction = move.heal ? move.heal[0] / move.heal[1] : playedRate(pokemon, battle, slot.id);
    rate = Math.max(rate, fraction);
    absorb += (slot.pp ?? 8) * fraction;
  }
  return { rate, absorb };
}

/** Total usable PP, a coarse ceiling on the turns of pressure; the Struggle of a drained mon stays out. */
export function ppBudget(pokemon: Pokemon): number {
  let pp = 0;
  for (const slot of usableSlots(pokemon)) pp += slot.pp ?? 8;
  return pp;
}

export interface RaceSide {
  /** Starting HP fraction (the matchup term passes hazard-adjusted entry HP). */
  hp: number;
  /** Best per-turn damage fraction onto the opponent (boost-adjusted). */
  frac: number;
  residual: number;
  healRate: number;
  /** Total HP fraction the remaining heal PP can restore (Σ pp × rate). */
  healAbsorb: number;
  ppBudget: number;
}

export interface RaceClocks {
  /** Turns side A needs to KO side B (Infinity = never lands). */
  turnsA: number;
  turnsB: number;
  effFracA: number;
  effFracB: number;
}

/** KO-race clocks for one pair: heal PP absorb as survival, a pinned healer attacks or never, PP caps every clock. */
export function raceClocks(a: RaceSide, b: RaceSide): RaceClocks {
  const incomingA = b.frac + a.residual;
  const incomingB = a.frac + b.residual;
  let effFracA = a.frac * spare(a, incomingA);
  let effFracB = b.frac * spare(b, incomingB);
  const attackA = pinned(a, incomingA) && attackWins(a, b, effFracB, incomingA, incomingB);
  const attackB = pinned(b, incomingB) && attackWins(b, a, effFracA, incomingB, incomingA);
  if (attackA) effFracA = a.frac;
  if (attackB) effFracB = b.frac;
  return {
    turnsA: clock(a, effFracA, b, incomingB, !attackB),
    turnsB: clock(b, effFracB, a, incomingA, !attackA),
    effFracA,
    effFracB,
  };
}

function spare(side: RaceSide, incoming: number): number {
  return side.healRate > 0 && incoming > 0 ? Math.max(0, 1 - incoming / side.healRate) : 1;
}

const pinned = (side: RaceSide, incoming: number): boolean => side.healRate > 0 && incoming >= side.healRate;

// A tie is not a loss: the caller breaks it by speed.
function attackWins(side: RaceSide, other: RaceSide, otherEffFrac: number, incomingSide: number, incomingOther: number): boolean {
  const own = clock(side, side.frac, other, incomingOther, true);
  return own !== Infinity && own <= clock(other, otherEffFrac, side, incomingSide, false);
}

// `heals`: whether the defender spends turns on its heal moves (a defender that attacks instead heals none).
function clock(attacker: RaceSide, effFrac: number, defender: RaceSide, incoming: number, heals: boolean): number {
  if (attacker.frac <= 0) return Infinity;
  const pressure = effFrac + defender.residual;
  if (pressure <= 0) return Infinity;
  // Held heal PP realize only at healRate/incoming past the heal rate, so healing now beats holding (Slack Off).
  let absorb = 0;
  if (heals) {
    absorb = defender.healRate > 0 && incoming > defender.healRate
      ? defender.healAbsorb * (defender.healRate / incoming)
      : defender.healAbsorb;
  }
  // The epsilon keeps float noise (0.1 - 0.45/0.5 is not exactly 0.02) from pushing a division over the next turn.
  const held = Math.ceil((defender.hp + absorb) / pressure - 1e-9);
  const turns = heals ? Math.min(held, healedSequence(defender, pressure, incoming)) : held;
  return turns > attacker.ppBudget ? Infinity : turns;
}

// As the simulator plays it: hit, heal, hit, ...; the KO lands at the first n with n * pressure >= hp + (n - 1) * rate.
// The held-PP price in `clock` stays where a short tank empties first; Infinity where the hits never out-run a heal.
function healedSequence(defender: RaceSide, pressure: number, incoming: number): number {
  const rate = defender.healRate;
  if (rate <= 0 || incoming <= rate || pressure <= rate) return Infinity;
  const hits = Math.max(1, Math.ceil((defender.hp - rate) / (pressure - rate) - 1e-9));
  return (hits - 1) * rate <= defender.healAbsorb + 1e-9 ? hits : Infinity;
}

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
