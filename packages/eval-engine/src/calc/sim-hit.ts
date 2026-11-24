import type { ActiveMove, Battle, Pokemon } from '@pkmn/sim';
import { FixedDice, playOnCopy } from '../sim-ask/index.ts';

/** Hits the calc cannot price: spread-target Expanding Force and Tera Starstorm, a lone foe behind a screen. */

export interface BattleSlot {
  side: 0 | 1;
  slot: number;
}

/** A hit to price: the live battle is read, never written. */
export interface LiveHit {
  battle: Battle;
  attacker: BattleSlot;
  defender: BattleSlot;
  armed?: { attacker?: boolean; defender?: boolean };
}

/** The damage in HP of the highest and the lowest roll, no crit, against the defender's HP at the hit. */
export interface SimHitRange {
  min: number;
  max: number;
  hp: number;
  maxhp: number;
}

// random(16) answers 0 for the highest roll and 15 for the lowest.
const HIGHEST_ROLL = 0;
const LOWEST_ROLL = 0.999;

function clickTera(copy: Battle, body: Pokemon): void {
  const actions = copy.actions as { terastallize?: (pokemon: Pokemon) => void };
  if (!body.terastallized && typeof actions.terastallize === 'function') actions.terastallize(body);
}

function damageAt(hit: LiveHit, moveId: string, quantile: number): { damage: number; hp: number; maxhp: number } | null {
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

/** The damage range of a single-hit move on a copy; null when it never reaches the defender or no copy exists. */
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
