import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
import { FixedDice, playOnCopy } from '../sim-ask/index.ts';

/**
 * Round 73 (T202, design gate 3a): the simulator's own price of one hit, for the hits the calculator cannot price. The calculator
 * forces the spread target for a few moves (Expanding Force in Psychic Terrain, Tera Starstorm of Terapagos-Stellar); against a lone
 * foe behind a screen the simulator plays one target and neither game type of the calculator holds its screen factor. The preview
 * plays the move on a copy of the live battle (sim-ask: `playOnCopy`, `FixedDice`) at the highest and the lowest damage roll and
 * reads the damage the simulator's own damage step returns. The live battle is read and never written.
 */

/** A body of the live battle: the side's index (0 is p1) and its active slot. */
export interface BattleSlot {
  side: 0 | 1;
  slot: number;
}

export interface LiveHit {
  /** The live battle of the branch (`getBattle()` in the app). */
  battle: Battle;
  attacker: BattleSlot;
  defender: BattleSlot;
  /** The Terastallization the picker has armed for this turn, played as the click makes it before the hit. */
  armed?: { attacker?: boolean; defender?: boolean };
}

/** The damage in HP of the highest and of the lowest roll, no crit, with the defender's HP at the hit. */
export interface SimHitRange {
  min: number;
  max: number;
  hp: number;
  maxhp: number;
}

/** random(16) answers 0 for the highest roll (100 percent) and 15 for the lowest (85 percent). */
const HIGHEST_ROLL = 0;
const LOWEST_ROLL = 0.999;

/** Clicks the Terastallization on a body of the copy, as the turn's first action does it. */
function clickTera(copy: Battle, body: Pokemon): void {
  const actions = copy.actions as { terastallize?: (pokemon: Pokemon) => void };
  if (!body.terastallized && typeof actions.terastallize === 'function') actions.terastallize(body);
}

/** One played use: the damage the simulator's damage step returned for the defender, or null when the move never reached it. */
function damageAt(hit: LiveHit, moveId: string, quantile: number): { damage: number; hp: number; maxhp: number } | null {
  // No crit and no miss: a crit is a chance draw and the preview shows the roll range of the plain hit.
  return playOnCopy(hit.battle, new FixedDice({ quantile, chance: false }), copy => {
    const attacker = copy.sides[hit.attacker.side].active[hit.attacker.slot];
    const defender = copy.sides[hit.defender.side].active[hit.defender.slot];
    if (!attacker || !defender) return null;
    if (hit.armed?.attacker) clickTera(copy, attacker);
    if (hit.armed?.defender) clickTera(copy, defender);
    const move: ActiveMove = copy.dex.getActiveMove(moveId);
    move.accuracy = true;
    move.willCrit = false;
    let damage: number | null = null;
    const getDamage = copy.actions.getDamage.bind(copy.actions);
    copy.actions.getDamage = ((source, target, ...rest) => {
      const dealt = getDamage(source, target, ...rest);
      if (damage === null && target === defender && typeof dealt === 'number') damage = dealt;
      return dealt;
    }) as typeof copy.actions.getDamage;
    const { hp, maxhp } = defender;
    copy.actions.useMove(move, attacker, { target: defender });
    return damage === null ? null : { damage, hp, maxhp };
  });
}

/**
 * The simulator's damage range of a single-hit move from the attacker into the defender on a copy of the live battle, or null when
 * the move never reaches the defender (an immunity, a failed move) or the battle cannot be copied.
 */
export function simHitRange(hit: LiveHit, moveName: string): SimHitRange | null {
  try {
    const id = moveName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const high = damageAt(hit, id, HIGHEST_ROLL);
    const low = damageAt(hit, id, LOWEST_ROLL);
    if (!high || !low) return null;
    return { min: Math.min(low.damage, high.damage), max: Math.max(low.damage, high.damage), hp: high.hp, maxhp: high.maxhp };
  } catch {
    return null;
  }
}
