import { Generations, Move as CalcMove, Pokemon as CalcPokemon, Field, calculate } from '@smogon/calc';
import { TERRAIN_BY_ID, WEATHER_BY_ID } from '@fulllifegames/replay-core';
import { attackerAtUse, calcPokemon } from '../calc/body.ts';
import { calcMove } from '../calc/move.ts';
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
 */

export interface KillTable {
  /** Index i = roll factor 85 + i %: random(16) = r reads index 15 − r. */
  normal: readonly number[];
  crit: readonly number[];
}

type CalcGen = ReturnType<typeof Generations.get>;

const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes']);
const CHARGE_BOOST_MOVES = new Set(['meteorbeam', 'electroshot']);

function calcBody(gen: CalcGen, body: BodySnapshot, spaOffset: number): CalcPokemon {
  return calcPokemon(gen, spaOffset ? { ...body, boosts: { ...body.boosts, spa: body.boosts.spa - spaOffset } } : body);
}

function calcField(snap: HitSnapshot): Field {
  const on = (id: string) => snap.fieldAbilities.includes(id);
  return new Field({
    gameType: 'Doubles',
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

function hitMove(gen: CalcGen, snap: HitSnapshot, isCrit: boolean): CalcMove {
  const plain = calcMove(gen, snap.moveName, snap.attacker, { isCrit });
  if (snap.spreadHit || !SPREAD_TARGETS.has(plain.target)) return plain;
  return calcMove(gen, snap.moveName, snap.attacker, { isCrit, overrides: { target: 'normal' } });
}

function rollsOf(damage: unknown): number[] | null {
  if (!Array.isArray(damage) || damage.length !== 16) return null;
  return damage.every(entry => typeof entry === 'number') ? (damage as number[]) : null;
}

/** The hit's 16 normal and 16 crit damage values, or null when the calc cannot price it (multi-hit shapes, unknown species). */
export function killTable(snap: HitSnapshot): KillTable | null {
  try {
    const gen = Generations.get(snap.gen as 3 | 4 | 5 | 6 | 7 | 8 | 9);
    const attacker = calcBody(gen, attackerAtUse(gen.num, snap.attacker, snap.moveName), chargeOffset(snap));
    const defender = calcBody(gen, snap.defender, 0);
    const field = calcField(snap);
    const normal = rollsOf(calculate(gen, attacker, defender, hitMove(gen, snap, false), field).damage);
    const crit = rollsOf(calculate(gen, attacker, defender, hitMove(gen, snap, true), field).damage);
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

/** killTable memoized per root by the whole snapshot: one calc per distinct bodies, move and field. */
export function memoKillTable(memo: Map<string, KillTable | null>, snap: HitSnapshot): KillTable | null {
  const key = JSON.stringify(snap);
  let table = memo.get(key);
  if (table === undefined) {
    table = killTable(snap);
    memo.set(key, table);
  }
  return table;
}
