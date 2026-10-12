import { Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import { TERRAIN_BY_ID, WEATHER_BY_ID, calcGenerationFor, simGenNum, type CalcGeneration } from '@fulllifegames/replay-core';
import { attackerAtUse, calcPokemon } from '../calc/body.ts';
import { calcMove } from '../calc/move.ts';
import { strongerPower, type StrengthMix } from '../calc/fickle.ts';
import { stellarFirstUse } from '../calc/stellar.ts';
import type { BodySnapshot, HitSnapshot } from './snapshot.ts';

/**
 * Round 56: the 16 damage values of one hit, normal and crit, from
 * @smogon/calc fed with the snapshot the dice took at the roll — a doubles
 * field with the partner effects the calc knows (ruin, Helping Hand,
 * Battery, Power Spot, Steely Spirit, Friend Guard, doubles screens). Three
 * call details keep the calc on the sim's number (docs/perf/probes/
 * 2026-09-23-r56/damage-check-anchor-v2.vt.ts: all 8450 anchor rolls, the
 * 6535 non-lethal ones to the HP; damage-check-v2.vt.ts: 96.8 % of the
 * non-lethal rolls on 83 bank positions):
 * `calculate` clones the move, so a spread move against one target goes in
 * through `overrides`; the bodies come from the engine's one builder, which
 * counts an entry boost once (calc/body.ts, round 67); Meteor Beam and
 * Electro Shot lose the charge boost the calc adds itself.
 *
 * Round 69 (T152): the calc also forces the spread target for Tera Starstorm
 * of Terapagos-Stellar and Expanding Force on Psychic Terrain (gen789.js), and
 * its Doubles field then takes the 0.75 spread factor off a hit that the
 * simulator did not spread because only one foe stood. That hit is priced with
 * the Singles game type, which enters the calc in the spread factor and the
 * screen factor only (a defender with a screen stays on the Doubles field,
 * the one hit the calc cannot price exactly).
 */

/** A hit's snapshot with the strength factor the move drew (Fickle Beam's 2, T154); absent for the move's own power. */
export type PricedHit = HitSnapshot & { strength?: number };

export interface KillTable {
  /** Index i = roll factor 85 + i %: random(16) = r reads index 15 − r. */
  normal: readonly number[];
  crit: readonly number[];
}

type CalcGen = CalcGeneration;

const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes']);
const CHARGE_BOOST_MOVES = new Set(['meteorbeam', 'electroshot']);

function calcBody(gen: CalcGen, body: BodySnapshot, spaOffset: number): CalcPokemon {
  return calcPokemon(gen, spaOffset ? { ...body, boosts: { ...body.boosts, spa: body.boosts.spa - spaOffset } } : body);
}

function calcField(snap: HitSnapshot, gameType: 'Doubles' | 'Singles' = 'Doubles'): Field {
  const on = (id: string) => snap.fieldAbilities.includes(id);
  return new Field({
    gameType,
    weather: WEATHER_BY_ID[snap.weather],
    terrain: TERRAIN_BY_ID[snap.terrain],
    isGravity: snap.rooms.includes('gravity'),
    isMagicRoom: snap.rooms.includes('magicroom'),
    isWonderRoom: snap.rooms.includes('wonderroom'),
    isSwordOfRuin: on('swordofruin'),
    isBeadsOfRuin: on('beadsofruin'),
    isTabletsOfRuin: on('tabletsofruin'),
    isVesselOfRuin: on('vesselofruin'),
    isFairyAura: on('fairyaura'),
    isDarkAura: on('darkaura'),
    isAuraBreak: on('aurabreak'),
    attackerSide: {
      isHelpingHand: snap.helpingHand,
      isBattery: snap.attackerPartner === 'battery',
      isPowerSpot: snap.attackerPartner === 'powerspot',
      isSteelySpirit: snap.attackerPartner === 'steelyspirit',
    },
    defenderSide: {
      isReflect: snap.screens.includes('reflect'),
      isLightScreen: snap.screens.includes('lightscreen'),
      isAuroraVeil: snap.screens.includes('auroraveil'),
      isFriendGuard: snap.defenderPartner === 'friendguard',
    },
  });
}

/** The charge boost the calc adds for Meteor Beam and Electro Shot (Simple doubles it, Contrary inverts it). */
function chargeOffset(snap: HitSnapshot): number {
  if (!CHARGE_BOOST_MOVES.has(snap.moveId)) return 0;
  if (snap.attacker.abilityId === 'simple') return 2;
  return snap.attacker.abilityId === 'contrary' ? -1 : 1;
}

function hitMove(gen: CalcGen, snap: PricedHit, isCrit: boolean, isStellarFirstUse = false): CalcMove {
  const plain = calcMove(gen, snap.moveName, snap.attacker, { isCrit, isStellarFirstUse });
  const strength = snap.strength ? strongerPower(plain.bp, snap.strength) : null;
  const drawn = strength ? calcMove(gen, snap.moveName, snap.attacker, { isCrit, isStellarFirstUse, overrides: strength }) : plain;
  if (snap.spreadHit || !SPREAD_TARGETS.has(drawn.target)) return drawn;
  return calcMove(gen, snap.moveName, snap.attacker, { isCrit, isStellarFirstUse, overrides: { ...strength, target: 'normal' } });
}

/** The hit's 16 values: the calc's Doubles field, or the Singles one where the calc forces a spread the simulator did not play. */
function hitRolls(gen: CalcGen, snap: PricedHit, attacker: CalcPokemon, defender: CalcPokemon, isCrit: boolean, firstUse: boolean): number[] | null {
  const result = calculate(gen, attacker, defender, hitMove(gen, snap, isCrit, firstUse), calcField(snap));
  const forced = !snap.spreadHit && SPREAD_TARGETS.has(result.move.target) && snap.screens.length === 0;
  return rollsOf(forced ? calculate(gen, attacker, defender, hitMove(gen, snap, isCrit, firstUse), calcField(snap, 'Singles')).damage : result.damage);
}

function rollsOf(damage: unknown): number[] | null {
  if (!Array.isArray(damage) || damage.length !== 16) return null;
  return damage.every(entry => typeof entry === 'number') ? (damage as number[]) : null;
}

/** The hit's 16 normal and 16 crit damage values, or null when the calc cannot price it (multi-hit shapes, unknown species). */
export function killTable(snap: PricedHit): KillTable | null {
  try {
    const gen = calcGenerationFor(snap.gen, snap.attacker.mod);
    const attacker = calcBody(gen, attackerAtUse(simGenNum(gen), snap.attacker, snap.moveName), chargeOffset(snap));
    const defender = calcBody(gen, snap.defender, 0);
    // A Stellar body's first use of a type hits harder (T152); the type at use is the calc's own.
    const first = stellarFirstUse(snap.attacker, () => calculate(gen, attacker, defender, hitMove(gen, snap, false), calcField(snap)).move.type);
    const normal = hitRolls(gen, snap, attacker, defender, false, first);
    const crit = hitRolls(gen, snap, attacker, defender, true, first);
    return normal && crit ? { normal, crit } : null;
  } catch {
    return null;
  }
}

/** The table's damage for a drawn roll. */
export function rollValue(table: KillTable, roll: number, crit: boolean): number {
  return (crit ? table.crit : table.normal)[15 - roll];
}

export function killCount(values: readonly number[], hp: number): number {
  return values.filter(value => value >= hp).length;
}

/** The crit-weighted share of a table's 16 rolls that reach `hp`. */
export function killShare(table: KillTable, hp: number, crit: number): number {
  return (1 - crit) * killCount(table.normal, hp) / 16 + crit * killCount(table.crit, hp) / 16;
}

/**
 * The kill share of a hit: its table's, or for a move that doubles on a chance (Fickle Beam, T154) the mix of the tables
 * at the weaker and the stronger strength. Null when a table cannot be priced.
 */
export function mixedKillShare(snap: HitSnapshot, hp: number, crit: number, mix: StrengthMix | null): number | null {
  const weak = killTable(snap);
  if (!weak) return null;
  if (!mix) return killShare(weak, hp, crit);
  const strong = killTable({ ...snap, strength: mix.factor });
  return strong ? (1 - mix.chance) * killShare(weak, hp, crit) + mix.chance * killShare(strong, hp, crit) : null;
}

/** killTable memoized per root by the whole snapshot: one calc per distinct bodies, move and field. */
export function memoKillTable(memo: Map<string, KillTable | null>, snap: PricedHit): KillTable | null {
  const key = JSON.stringify(snap);
  let table = memo.get(key);
  if (table === undefined) {
    table = killTable(snap);
    memo.set(key, table);
  }
  return table;
}
