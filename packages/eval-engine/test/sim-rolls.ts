import { createMatchupCache } from '../src/eval-function';
import { positionBattle, type SimPosition } from '../src/forward-model';
import { drawPair } from '../src/pair/draw';

/**
 * Round 69 (lane D) test helper: the simulator's own damage of one hit for
 * each of the 16 damage rolls, normal and crit, the oracle the calc paths of
 * T152 and T154 are held against. The turn is drawn under the recording dice
 * (pair/draw.ts) with the hit's accuracy, crit and roll answered by a script;
 * the damage is the target's HP the turn took, so give the target an HP no
 * roll can empty. Everything else the draw leaves to the seed.
 */

export interface SimDamages {
  /** Index i = the damage of random(16) = i (0 is the top roll). */
  normal: number[];
  crit: number[];
}

export interface HitKey {
  /** `${attackerSlot}:${moveId}>${targetSlot}`, e.g. `p1a:hydropump>p2a`. */
  script: string;
  target: { side: 0 | 1; slot: number };
}

export function simDamages(root: SimPosition, p1Choice: string, p2Choice: string, key: HitKey, seed = '1,2,3,4'): SimDamages {
  const damageOf = (roll: number, crit: boolean): number => {
    const scripts = new Map([[key.script, { hit: true, crit, roll }]]);
    const drawn = drawPair(root, p1Choice, p2Choice, seed as never, scripts, createMatchupCache());
    // The HP the hit met (a Tera click before it may have changed it), less the HP the target has after the turn.
    const hit = drawn.records.find(record => record.kind === 'roll' && record.key === key.script);
    if (!hit || hit.kind !== 'roll') throw new Error('the scripted hit never rolled');
    return hit.snapshot.defender.hp - positionBattle(drawn.child).sides[key.target.side].active[key.target.slot]!.hp;
  };
  const rolls = Array.from({ length: 16 }, (_, roll) => roll);
  return { normal: rolls.map(roll => damageOf(roll, false)), crit: rolls.map(roll => damageOf(roll, true)) };
}

/** How many of the rolls reach `hp`. */
export const killing = (damages: readonly number[], hp: number): number => damages.filter(damage => damage >= hp).length;
